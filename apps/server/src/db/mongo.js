import mongoose from 'mongoose';
import { config } from '../config.js';

const usageLogSchema = new mongoose.Schema(
  {
    apiKeyHash: { type: String, required: true, index: true },
    apiId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    endpoint: { type: String, required: true },
    method: { type: String, required: true },
    statusCode: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    requestedAt: { type: Date, default: Date.now },
    ip: String,
    region: { type: String, default: 'local' }
  },
  { collection: 'usageLogs' }
);

usageLogSchema.index({ apiKeyHash: 1, requestedAt: -1 });
usageLogSchema.index({ userId: 1, requestedAt: -1 });
usageLogSchema.index({ requestedAt: 1 }, { expireAfterSeconds: 7776000 });

export const UsageLog = mongoose.model('UsageLog', usageLogSchema);

export async function initMongo() {
  await mongoose.connect(config.mongoUrl);
  await UsageLog.syncIndexes();
}
