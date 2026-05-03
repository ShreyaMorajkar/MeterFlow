import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from './config.js';
import { query } from './db/postgres.js';
import { redis } from './db/redis.js';
import { UsageLog } from './db/mongo.js';
import { emitUsage } from './socket.js';
import { hashKey } from './utils/keys.js';

const memoryLimits = new Map();
const memorySpend = new Map(); // Track spend for cap enforcement

async function lookupKey(keyHash) {
  const cacheKey = `key:${keyHash}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached);

  const result = await query(
    `SELECT k.key_hash AS "keyHash", k.api_id AS "apiId", k.user_id AS "userId",
            a.base_url AS "baseUrl", p.rate_limit_per_minute AS "rateLimit"
     FROM api_keys k
     JOIN api_configs a ON a.id = k.api_id
     JOIN users u ON u.id = k.user_id
     JOIN plans p ON p.id = u.plan_id
     WHERE k.key_hash = $1
       AND (k.status = 'active' OR (k.status = 'rotating' AND k.grace_expires_at > NOW()))`,
    [keyHash]
  );
  const row = result.rows[0];
  if (row) await redis.set(cacheKey, JSON.stringify(row), { EX: 300 }).catch(() => {});
  return row;
}

export async function validateApiKey(req, res, next) {
  const rawKey = req.get('x-api-key') || req.query.api_key;
  if (!rawKey) return res.status(401).json({ error: 'missing_api_key' });

  const keyHash = hashKey(rawKey);
  const key = await lookupKey(keyHash);
  if (!key || key.apiId !== req.params.apiId) return res.status(401).json({ error: 'invalid_api_key' });

  req.meterflow = {
    keyHash,
    apiId: key.apiId,
    userId: key.userId,
    baseUrl: key.baseUrl,
    rateLimit: key.rateLimit,
    startedAt: Date.now()
  };
  next();
}

export async function checkRateLimit(req, res, next) {
  const { keyHash, rateLimit } = req.meterflow;
  const windowSeconds = 60;
  const now = Date.now();
  const bucket = `rate:${keyHash}:${Math.floor(now / 1000)}`;

  try {
    const multi = redis.multi();
    multi.incr(bucket);
    multi.expire(bucket, windowSeconds);
    await multi.exec();

    const keys = [];
    for (let i = 0; i < windowSeconds; i += 1) keys.push(`rate:${keyHash}:${Math.floor((now - i * 1000) / 1000)}`);
    const counts = await redis.mGet(keys);
    const used = counts.reduce((sum, value) => sum + Number(value || 0), 0);
    if (used > rateLimit) return rateLimitResponse(res, rateLimit, used);
    req.meterflow.used = used;
    return next();
  } catch {
    const minute = Math.floor(now / 60000);
    const memoryKey = `${keyHash}:${minute}`;
    const used = (memoryLimits.get(memoryKey) || 0) + 1;
    memoryLimits.set(memoryKey, used);
    if (used > 10) return rateLimitResponse(res, 10, used);
    req.meterflow.used = used;
    return next();
  }
}

function rateLimitResponse(res, limit, used) {
  const resetAt = new Date(Date.now() + 60 * 1000).toISOString();
  return res.status(429).json({
    error: 'rate_limit_exceeded',
    message: `You've used ${used}/${limit} requests this minute`,
    limit,
    used,
    reset_at: resetAt,
    upgrade_url: config.upgradeUrl
  });
}

// Check spend cap for user - blocks requests when hard cap is reached
export async function checkSpendCap(req, res, next) {
  const { userId } = req.meterflow;
  
  try {
    // Get user's hard cap from database
    const result = await query(
      `SELECT spend_hard_cap_paise, stripe_subscription_status FROM users WHERE id = $1`,
      [userId]
    );
    
    const user = result.rows[0];
    if (!user) return next(); // Allow if user not found
    
    const hardCap = user.spend_hard_cap_paise;
    // If no hard cap set (0 or null), skip check
    if (!hardCap || hardCap <= 0) return next();
    
    // Get current month spending from billing_periods
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    
    const billingResult = await query(
      `SELECT COALESCE(SUM(amount_paise), 0) as current_spend 
       FROM billing_periods 
       WHERE user_id = $1 AND starts_at >= $2 AND status = 'invoiced'`,
      [userId, monthStart]
    );
    
    const currentSpend = Number(billingResult.rows[0]?.current_spend || 0);
    
    // Check if over hard cap
    if (currentSpend >= hardCap) {
      return res.status(402).json({
        error: 'spend_cap_exceeded',
        message: 'You have reached your monthly spending limit. Please upgrade your plan or contact support.',
        current_spend: currentSpend,
        hard_cap: hardCap,
        upgrade_url: config.upgradeUrl
      });
    }
    
    // Store spend info for later use
    req.meterflow.currentSpend = currentSpend;
    req.meterflow.hardCap = hardCap;
    
    return next();
  } catch (error) {
    console.error('[spend-cap-check]', error.message);
    // On error, allow request to proceed (fail-open)
    return next();
  }
}

export function logRequest(req, res, next) {
  req.meterflow.logPromise = UsageLog.create({
    apiKeyHash: req.meterflow.keyHash,
    apiId: req.meterflow.apiId,
    userId: req.meterflow.userId,
    endpoint: req.originalUrl.replace(`/gateway/${req.params.apiId}`, '') || '/',
    method: req.method,
    statusCode: 0,
    latencyMs: 0,
    ip: req.ip
  }).catch((error) => console.error('[usage-log:create]', error.message));
  next();
}

export function forwardToOrigin(req, res, next) {
  const proxy = createProxyMiddleware({
    target: req.meterflow.baseUrl,
    changeOrigin: true,
    pathRewrite: () => req.originalUrl.replace(`/gateway/${req.params.apiId}`, '') || '/',
    on: {
      proxyReq(proxyReq) {
        proxyReq.removeHeader('x-api-key');
      },
      error(error, _req, response) {
        response.status(502).json({ error: 'origin_unreachable', message: error.message });
      }
    }
  });
  return proxy(req, res, next);
}

export function captureResponse(req, res, next) {
  res.on('finish', async () => {
    const latencyMs = Date.now() - req.meterflow.startedAt;
    const log = await req.meterflow.logPromise;
    if (log) {
      log.statusCode = res.statusCode;
      log.latencyMs = latencyMs;
      await log.save().catch((error) => console.error('[usage-log:update]', error.message));
      emitUsage(req.meterflow.userId, {
        endpoint: log.endpoint,
        method: log.method,
        statusCode: log.statusCode,
        latencyMs,
        requestedAt: log.requestedAt
      });
    }
  });
  next();
}
