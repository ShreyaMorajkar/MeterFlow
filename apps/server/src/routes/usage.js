import { Router } from 'express';
import { UsageLog } from '../db/mongo.js';
import { query } from '../db/postgres.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/summary', async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [logs, totals, planResult] = await Promise.all([
    UsageLog.find({ userId: req.user.sub }).sort({ requestedAt: -1 }).limit(25).lean(),
    UsageLog.aggregate([
      { $match: { userId: req.user.sub, requestedAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: 1 }, avgLatency: { $avg: '$latencyMs' }, errors: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } } } }
    ]),
    query(
      `SELECT p.included_requests AS "includedRequests", p.overage_paise AS "overagePaise",
              u.spend_alert_paise AS "spendAlertPaise", u.spend_hard_cap_paise AS "spendHardCapPaise"
       FROM users u JOIN plans p ON p.id = u.plan_id WHERE u.id = $1`,
      [req.user.sub]
    )
  ]);

  const usage = totals[0] || { total: 0, avgLatency: 0, errors: 0 };
  const plan = planResult.rows[0];
  const billable = Math.max(0, usage.total - plan.includedRequests);
  const amountPaise = billable * plan.overagePaise;

  res.json({
    totals: {
      requests: usage.total,
      avgLatencyMs: Math.round(usage.avgLatency || 0),
      errors: usage.errors,
      amountPaise,
      includedRequests: plan.includedRequests,
      spendAlertPaise: plan.spendAlertPaise,
      spendHardCapPaise: plan.spendHardCapPaise
    },
    logs
  });
});

export default router;
