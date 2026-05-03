import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '../../.env');

dotenv.config({ path: rootEnvPath });
dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  appOrigins: (process.env.APP_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  serveWeb: process.env.SERVE_WEB === 'true',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  databaseUrl: process.env.DATABASE_URL || 'postgres://meterflow:meterflow@localhost:5432/meterflow',
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/meterflow',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  upgradeUrl: process.env.UPGRADE_URL || 'http://localhost:5173/billing',
  keyGraceHours: 24,
  // Razorpay Configuration
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  razorpayAmountPaise: Number(process.env.RAZORPAY_AMOUNT_PAISE || 49900),
  razorpayCurrency: process.env.RAZORPAY_CURRENCY || 'INR',
  razorpayPaymentDescription: process.env.RAZORPAY_PAYMENT_DESCRIPTION || 'MeterFlow Pro upgrade',
  baseUrl: process.env.BASE_URL || 'http://localhost:4000'
};

function validateRequiredEnv() {
  const missing = [];

  if (config.nodeEnv === 'production') {
    if (!config.jwtSecret || config.jwtSecret === 'dev-secret-change-me') {
      missing.push('JWT_SECRET');
    }
    if (!config.databaseUrl) missing.push('DATABASE_URL');
    if (!config.mongoUrl) missing.push('MONGO_URL');
    if (!config.redisUrl) missing.push('REDIS_URL');
    if (!config.razorpayKeyId) missing.push('RAZORPAY_KEY_ID');
    if (!config.razorpayKeySecret) missing.push('RAZORPAY_KEY_SECRET');
    if (!config.razorpayWebhookSecret) missing.push('RAZORPAY_WEBHOOK_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
}

export function validateConfig() {
  validateRequiredEnv();
}

