import express from 'express';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { 
  createCheckoutSession, 
  createBillingPortalSession, 
  handleRazorpayWebhook,
  getSubscriptionStatus,
  cancelSubscription
} from '../services/razorpay.js';
import { config } from '../config.js';

const router = Router();

// Webhook endpoint (must be before requireAuth - Razorpay needs to verify webhook signature)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing x-razorpay-signature header' });
    }

    const result = await handleRazorpayWebhook(req.body, signature);
    res.json(result);
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// All other billing routes require authentication
router.use(requireAuth);

// Get current subscription status
router.get('/subscription', async (req, res) => {
  try {
    const status = await getSubscriptionStatus(req.user.sub);
    res.json(status);
  } catch (error) {
    console.error('Error getting subscription status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create checkout session for subscription upgrade
router.post('/checkout', async (req, res) => {
  try {
    const session = await createCheckoutSession(req.user.sub);
    res.json({ url: session.short_url || session.url, sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create billing portal session for managing subscription
router.post('/portal', async (req, res) => {
  try {
    const session = await createBillingPortalSession(req.user.sub);
    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating billing portal session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel subscription
router.post('/cancel', async (req, res) => {
  try {
    const subscription = await cancelSubscription(req.user.sub);
    res.json({ status: subscription.status });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Razorpay key for frontend
router.get('/config', (_req, res) => {
  res.json({
    keyId: config.razorpayKeyId,
    baseUrl: config.baseUrl
  });
});

export default router;