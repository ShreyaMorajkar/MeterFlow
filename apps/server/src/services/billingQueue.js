import { Queue, QueueEvents, Worker } from 'bullmq';
import { config } from '../config.js';
import { calculateBillingPeriod } from './billing.js';

const redisUrl = new URL(config.redisUrl);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null
};

const queueName = 'billing-calculate';

export const billingQueue = new Queue(queueName, { connection });
export const billingQueueEvents = new QueueEvents(queueName, { connection });

export function startBillingWorker() {
  return new Worker(
    queueName,
    async (job) => calculateBillingPeriod(job.data.userId),
    { connection }
  );
}

export async function enqueueBillingCalculation(userId) {
  const now = new Date();
  const period = now.toISOString().slice(0, 7);
  return billingQueue.add(
    'calculate',
    { userId },
    {
      jobId: `billing:${userId}:${period}`,
      removeOnComplete: 100,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    }
  );
}
