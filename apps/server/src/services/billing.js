import { UsageLog } from '../db/mongo.js';
import { query } from '../db/postgres.js';
import { notifyBillingCreated, checkAndAlertSpend } from './webhookService.js';

export async function calculateBillingPeriod(userId, now = new Date()) {
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const idempotencyKey = `billing:${userId}:${startsAt.toISOString().slice(0, 7)}`;

  const planResult = await query(
    `SELECT p.included_requests AS "includedRequests", p.overage_paise AS "overagePaise"
     FROM users u JOIN plans p ON p.id = u.plan_id WHERE u.id = $1`,
    [userId]
  );
  const plan = planResult.rows[0];
  const totalReqs = await UsageLog.countDocuments({ userId, requestedAt: { $gte: startsAt, $lt: endsAt } });
  const billable = Math.max(0, totalReqs - plan.includedRequests);
  const amountPaise = billable * plan.overagePaise;

  const result = await query(
    `INSERT INTO billing_periods (user_id, starts_at, ends_at, total_reqs, amount_paise, status, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, 'invoiced', $6)
     ON CONFLICT (idempotency_key)
     DO UPDATE SET total_reqs = EXCLUDED.total_reqs, amount_paise = EXCLUDED.amount_paise
     RETURNING id, starts_at AS "startsAt", ends_at AS "endsAt", total_reqs AS "totalReqs",
               amount_paise AS "amountPaise", status, idempotency_key AS "idempotencyKey"`,
    [userId, startsAt, endsAt, totalReqs, amountPaise, idempotencyKey]
  );

  // Send webhook notification for billing created
  const billingData = result.rows[0];
  await notifyBillingCreated(userId, {
    total_requests: totalReqs,
    billable_requests: billable,
    amount_paise: amountPaise,
    period: startsAt.toISOString().slice(0, 7)
  });

  // Check and alert for spend thresholds
  await checkAndAlertSpend(userId);

  return billingData;
}
