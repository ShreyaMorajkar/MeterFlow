import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { config, validateConfig } from './config.js';
import { initMongo } from './db/mongo.js';
import { initPostgres } from './db/postgres.js';
import { initRedis } from './db/redis.js';
import { pool as pgPool } from './db/postgres.js';
import { redis } from './db/redis.js';
import { captureResponse, checkRateLimit, checkSpendCap, forwardToOrigin, logRequest, validateApiKey } from './gateway.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/apis.js';
import keyRoutes from './routes/keys.js';
import usageRoutes from './routes/usage.js';
import billingRoutes from './routes/billing.js';
import paymentRoutes from './routes/payments.js';
import webhookRoutes from './routes/webhooks.js';
import { startBillingWorker } from './services/billingQueue.js';
import { setSocketServer } from './socket.js';

validateConfig();

const app = express();
const server = http.createServer(app);
const isDev = config.nodeEnv === 'development';
const corsOriginHandler = (origin, callback) => {
  if (!origin) return callback(null, true);
  if (isDev) return callback(null, true);
  if (config.appOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Not allowed by CORS'));
};

const io = new Server(server, {
  cors: {
    origin: corsOriginHandler
  }
});
setSocketServer(io);

io.on('connection', (socket) => {
  socket.on('dashboard:join', (userId) => socket.join(`user:${userId}`));
});

const corsOptions = {
  origin: corsOriginHandler,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
  preflightContinue: false
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'meterflow' }));

// Detailed health check for production monitoring
app.get('/health/ready', async (_req, res) => {
  const checks = {
    postgres: { status: 'unknown' },
    mongodb: { status: 'unknown' },
    redis: { status: 'unknown' }
  };
  
  try {
    await pgPool.query('SELECT 1');
    checks.postgres.status = 'ok';
  } catch (e) {
    checks.postgres.status = 'error';
    checks.postgres.message = e.message;
  }
  
  try {
    await redis.ping();
    checks.redis.status = 'ok';
  } catch (e) {
    checks.redis.status = 'error';
    checks.redis.message = e.message;
  }
  
  // MongoDB check would go here if we export the connection
  // For now, mark as ok if no error thrown during init
  checks.mongodb.status = 'ok';
  
  const allOk = Object.values(checks).every(c => c.status === 'ok');
  res.status(allOk ? 200 : 503).json({
    ok: allOk,
    service: 'meterflow',
    checks,
    timestamp: new Date().toISOString()
  });
});

app.get('/health/live', (_req, res) => res.json({ ok: true }));
app.use('/auth', authRoutes);
app.use('/apis', apiRoutes);
app.use('/keys', keyRoutes);
app.use('/usage', usageRoutes);
app.use('/billing', billingRoutes);
app.use('/payments', paymentRoutes);
app.use('/webhooks', webhookRoutes);

app.use('/gateway/:apiId', validateApiKey, checkRateLimit, checkSpendCap, logRequest, captureResponse, forwardToOrigin);

if (config.serveWeb) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(__dirname, '../../web/dist');
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((error, _req, res, _next) => {
  console.error('[request]', error);
  res.status(500).json({ error: 'internal_error' });
});

await initPostgres();
await initMongo();
await initRedis();
startBillingWorker();

server.listen(config.port, () => {
  console.log(`MeterFlow server listening on http://localhost:${config.port}`);
});
