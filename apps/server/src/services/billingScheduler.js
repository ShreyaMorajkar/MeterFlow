import { Queue, QueueEvents, Worker } from 'bullmq';
import { config } from '../config.js';
import { query } from '../db/postgres.js';

const redisUrl = new URL(config.redisUrl);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null
};

const queueName = 'billing-scheduler';

export const schedulerQueue = new Queue(queueName, { connection });
export const schedulerQueueEvents = new QueueEvents(queueName, { connection });

// Worker that processes scheduled billing jobs
export function startSchedulerWorker() {
  return new Worker(
    queueName,
    async (job) => {
      if (job.name === 'monthly-billing') {
        return await processMonthlyBilling(job.data);
      } else if (job.name === 'spend-alert') {
        return await processSpendAlert(job.data);
      } else if (job.name === 'spend-cap-check') {
        return await processSpendCapCheck(job.data);
      }
    },
    { connection }
  );
}

// Schedule monthly billing for all users at end of month
export async function scheduleMonthlyBilling() {
  const now = new Date();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const scheduledTime = new Date(lastDayOfMonth);
  scheduledTime.setHours(23, 59, 0, 0); // End of month

  // If we're past the end of month, schedule for next month
  if (now > scheduledTime) {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    scheduledTime.setTime(nextMonth);
    scheduledTime.setHours(23, 59, 0, 0);
  }

  // Get all users with active subscriptions
  const usersResult = await query(
    `SELECT id FROM users WHERE stripe_subscription_status = 'active'`
  );

  const jobs = [];
  for (const user of usersResult.rows) {
    const job = await schedulerQueue.add(
      'monthly-billing',
      { userId: user.id, month: now.toISOString().slice(0, 7) },
      {
        jobId: `monthly:${user.id}:${now.toISOString().slice(0, 7)}`,
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 }
      }
    );
    jobs.push(job);
  }

  return jobs;
}

// Schedule spend alert check for a user
export async function scheduleSpendAlert(userId, thresholdPaise) {
  return schedulerQueue.add(
    'spend-alert',
    { userId, thresholdPaise },
    {
      jobId: `alert:${userId}`,
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}

// Schedule spend cap check (runs more frequently)
export async function scheduleSpendCapCheck(userId) {
  return schedulerQueue.add(
    'spend-cap-check',
    { userId },
    {
      jobId: `cap-check:${userId}`,
      repeat: {
        pattern: '0 * * * *' // Every hour
      },
      removeOnComplete: 10,
      removeOnFail: 50
    }
  );
}

// Process monthly billing for a user
async function processMonthlyBilling(data) {
  const { userId, month } = data;
  console.log(`Processing monthly billing for user ${userId}, month ${month}`);

  // Import dynamically to avoid circular dependency
  const { calculateBillingPeriod } = await import('./billing.js');
  
  try {
    const result = await calculateBillingPeriod(userId);
    console.log(`Billing calculated for user ${userId}:`, result);
    return result;
  } catch (error) {
    console.error(`Error processing monthly billing for user ${userId}:`, error);
    throw error;
  }
}

// Process spend alert
async function processSpendAlert(data) {
  const { userId, thresholdPaise } = data;
  console.log(`Checking spend alert for user ${userId}, threshold: ${thresholdPaise}`);

  // Get current month spending
  const now = new Date();
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  // This would query usage logs - simplified for now
  const currentSpend = 0; // TODO: Calculate from usage logs

  if (currentSpend >= thresholdPaise) {
    // Trigger webhook notification
    await triggerSpendAlertWebhook(userId, currentSpend, thresholdPaise);
  }

  return { alerted: currentSpend >= thresholdPaise, currentSpend, thresholdPaise };
}

// Process spend cap check
async function processSpendCapCheck(data) {
  const { userId } = data;
  console.log(`Checking spend cap for user ${userId}`);

  // Get user's hard cap
  const userResult = await query(
    `SELECT spend_hard_cap_paise FROM users WHERE id = $1`,
    [userId]
  );

  const hardCap = userResult.rows[0]?.spend_hard_cap_paise;
  if (!hardCap || hardCap <= 0) {
    return { blocked: false, reason: 'no_cap' };
  }

  // Get current month spending
  const now = new Date();
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  // TODO: Calculate actual spend from billing_periods
  const currentSpend = 0;

  if (currentSpend >= hardCap) {
    // Block requests - this would be checked in gateway
    return { blocked: true, currentSpend, hardCap };
  }

  return { blocked: false, currentSpend, hardCap };
}

// Trigger spend alert webhook
async function triggerSpendAlertWebhook(userId, currentSpend, thresholdPaise) {
  const userResult = await query(
    `SELECT webhook_url FROM users WHERE id = $1`,
    [userId]
  );

  const webhookUrl = userResult.rows[0]?.webhook_url;
  if (!webhookUrl) {
    console.log(`No webhook configured for user ${userId}`);
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'spend_alert',
        userId,
        currentSpend,
        thresholdPaise,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      console.error(`Webhook failed for user ${userId}: ${response.status}`);
    }
  } catch (error) {
    console.error(`Error triggering webhook for user ${userId}:`, error);
  }
}

// Initialize scheduler with recurring jobs
export async function initScheduler() {
  // Schedule monthly billing check (runs on 28th of each month)
  await schedulerQueue.add(
    'monthly-billing',
    {},
    {
      jobId: 'monthly-scheduler',
      repeat: {
        pattern: '0 28 * *' // 28th of every month at midnight
      },
      removeOnComplete: 10,
      removeOnFail: 50
    }
  );

  console.log('Billing scheduler initialized');
}