import crypto from 'node:crypto';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createRawKey, hashKey } from './utils/keys.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.appOrigins } });

const plan = { id: 'free', includedRequests: 1000, overagePaise: 10, rateLimit: 60 };
const users = [];
const apis = [];
const keys = [];
const logs = [];
const rateBuckets = new Map();

app.use(cors({ origin: config.appOrigins }));
app.use(express.json());

io.on('connection', (socket) => {
  socket.on('dashboard:join', (userId) => socket.join(`user:${userId}`));
});

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sign(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: '12h' });
}

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'meterflow-demo' }));

app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) return res.status(400).json({ error: 'invalid_credentials' });
  if (users.some((user) => user.email === email)) return res.status(409).json({ error: 'email_already_registered' });
  const user = {
    id: id('usr'),
    email,
    password: await bcrypt.hash(password, 12),
    role: 'owner',
    createdAt: new Date()
  };
  users.push(user);
  res.status(201).json({ token: sign(user), user: { id: user.id, email: user.email, role: user.role } });
});

app.post('/auth/login', async (req, res) => {
  const user = users.find((candidate) => candidate.email === req.body.email);
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) {
    return res.status(401).json({ error: 'invalid_login' });
  }
  res.json({ token: sign(user), user: { id: user.id, email: user.email, role: user.role } });
});

app.get('/apis', requireAuth, (req, res) => {
  res.json({ apis: apis.filter((api) => api.userId === req.user.sub).map(publicApi) });
});

app.post('/apis', requireAuth, (req, res) => {
  const { name, baseUrl } = req.body;
  try {
    new URL(baseUrl);
  } catch {
    return res.status(400).json({ error: 'invalid_api_config' });
  }
  const api = { id: id('api'), userId: req.user.sub, name, baseUrl, createdAt: new Date() };
  apis.push(api);
  res.status(201).json({ api: publicApi(api) });
});

app.get('/keys', requireAuth, (req, res) => {
  const ownedApis = new Map(apis.filter((api) => api.userId === req.user.sub).map((api) => [api.id, api]));
  res.json({
    keys: keys
      .filter((key) => key.userId === req.user.sub)
      .map((key) => ({ ...publicKey(key), apiName: ownedApis.get(key.apiId)?.name || 'Unknown API' }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  });
});

app.post('/keys', requireAuth, (req, res) => {
  const api = apis.find((candidate) => candidate.id === req.body.apiId && candidate.userId === req.user.sub);
  if (!api) return res.status(404).json({ error: 'api_not_found' });
  const rawKey = createRawKey(req.body.environment || 'test');
  const key = {
    id: id('key'),
    apiId: api.id,
    userId: req.user.sub,
    keyHash: hashKey(rawKey),
    label: req.body.label || 'Default key',
    environment: req.body.environment || 'test',
    status: 'active',
    createdAt: new Date()
  };
  keys.push(key);
  res.status(201).json({ key: publicKey(key), rawKey });
});

app.post('/keys/:id/revoke', requireAuth, (req, res) => {
  const key = keys.find((candidate) => candidate.id === req.params.id && candidate.userId === req.user.sub);
  if (!key) return res.status(404).json({ error: 'key_not_found' });
  key.status = 'revoked';
  key.revokedAt = new Date();
  res.json({ ok: true });
});

app.post('/keys/:id/rotate', requireAuth, (req, res) => {
  const oldKey = keys.find((candidate) => candidate.id === req.params.id && candidate.userId === req.user.sub && candidate.status === 'active');
  if (!oldKey) return res.status(404).json({ error: 'active_key_not_found' });
  oldKey.status = 'rotating';
  oldKey.graceExpiresAt = new Date(Date.now() + config.keyGraceHours * 60 * 60 * 1000);
  const rawKey = createRawKey(oldKey.environment);
  const newKey = {
    id: id('key'),
    apiId: oldKey.apiId,
    userId: oldKey.userId,
    keyHash: hashKey(rawKey),
    label: `${oldKey.label} rotated`,
    environment: oldKey.environment,
    status: 'active',
    createdAt: new Date()
  };
  keys.push(newKey);
  res.status(201).json({ key: publicKey(newKey), rawKey, oldKeyGraceHours: config.keyGraceHours });
});

app.get('/usage/summary', requireAuth, (req, res) => {
  const userLogs = logs.filter((log) => log.userId === req.user.sub).sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  const total = userLogs.length;
  const avgLatency = total ? userLogs.reduce((sum, log) => sum + log.latencyMs, 0) / total : 0;
  const errors = userLogs.filter((log) => log.statusCode >= 400).length;
  const amountPaise = Math.max(0, total - plan.includedRequests) * plan.overagePaise;
  res.json({
    totals: {
      requests: total,
      avgLatencyMs: Math.round(avgLatency),
      errors,
      amountPaise,
      includedRequests: plan.includedRequests,
      spendAlertPaise: 500000,
      spendHardCapPaise: 1000000
    },
    logs: userLogs.slice(0, 25)
  });
});

app.post('/billing/calculate', requireAuth, (req, res) => {
  const totalReqs = logs.filter((log) => log.userId === req.user.sub).length;
  res.json({
    invoice: {
      id: id('inv'),
      totalReqs,
      amountPaise: Math.max(0, totalReqs - plan.includedRequests) * plan.overagePaise,
      status: 'invoiced',
      idempotencyKey: `billing:${req.user.sub}:${new Date().toISOString().slice(0, 7)}`
    }
  });
});

app.use('/gateway/:apiId', validateDemoKey, checkDemoRateLimit, captureDemoResponse, forwardDemoRequest);

function validateDemoKey(req, res, next) {
  const rawKey = req.get('x-api-key') || req.query.api_key;
  const keyHash = rawKey ? hashKey(rawKey) : '';
  const key = keys.find((candidate) => candidate.keyHash === keyHash && candidate.apiId === req.params.apiId && candidate.status !== 'revoked');
  const api = key ? apis.find((candidate) => candidate.id === key.apiId) : null;
  if (!key || !api) return res.status(401).json({ error: 'invalid_api_key' });
  req.meterflow = { keyHash, apiId: api.id, userId: key.userId, baseUrl: api.baseUrl, startedAt: Date.now() };
  next();
}

function checkDemoRateLimit(req, res, next) {
  const minute = Math.floor(Date.now() / 60000);
  const bucket = `${req.meterflow.keyHash}:${minute}`;
  const used = (rateBuckets.get(bucket) || 0) + 1;
  rateBuckets.set(bucket, used);
  if (used > plan.rateLimit) {
    return res.status(429).json({
      error: 'rate_limit_exceeded',
      message: `You've used ${used}/${plan.rateLimit} requests this minute`,
      limit: plan.rateLimit,
      used,
      reset_at: new Date(Date.now() + 60000).toISOString(),
      upgrade_url: config.upgradeUrl
    });
  }
  next();
}

function captureDemoResponse(req, res, next) {
  res.on('finish', () => {
    const log = {
      _id: id('log'),
      apiKeyHash: req.meterflow.keyHash,
      apiId: req.meterflow.apiId,
      userId: req.meterflow.userId,
      endpoint: req.originalUrl.replace(`/gateway/${req.params.apiId}`, '') || '/',
      method: req.method,
      statusCode: res.statusCode,
      latencyMs: Date.now() - req.meterflow.startedAt,
      requestedAt: new Date(),
      ip: req.ip,
      region: 'local'
    };
    logs.push(log);
    io.to(`user:${log.userId}`).emit('usage:logged', log);
  });
  next();
}

function forwardDemoRequest(req, res, next) {
  return createProxyMiddleware({
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
  })(req, res, next);
}

function publicApi(api) {
  const { userId, ...visible } = api;
  return visible;
}

function publicKey(key) {
  const { keyHash, userId, ...visible } = key;
  return visible;
}

server.listen(config.port, () => {
  console.log(`MeterFlow demo server listening on http://localhost:${config.port}`);
});
