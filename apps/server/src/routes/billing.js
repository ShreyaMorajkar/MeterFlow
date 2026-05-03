import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { billingQueueEvents, enqueueBillingCalculation } from '../services/billingQueue.js';

const router = Router();
router.use(requireAuth);

router.post('/calculate', async (req, res) => {
  const job = await enqueueBillingCalculation(req.user.sub);
  const invoice = await job.waitUntilFinished(billingQueueEvents, 15000);
  res.json({ invoice });
});

export default router;
