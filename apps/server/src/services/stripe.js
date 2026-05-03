import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/postgres.js';

const razorpay = config.razorpayKeyId && config.razorpayKeySecret
  ? new Razorpay({ key_id: config.razorpayKeyId, key_secret: config.razorpayKeySecret })
  : null;

function assertRazorpayConfigured() {
  if (!razorpay) {
    throw new Error('Razorpay keys are not configured');
  }
  if (!config.razorpayWebhookSecret) {
    throw new Error('Razorpay webhook secret is not configured');
  }
}

// Create Razorpay customer for user
export async function createRazorpayCustomer(userId, email) {
  if (!razorpay) {
    throw new Error('Razorpay is not configured');
  }

  const customer = await razorpay.customers.create({
    name: email,
    email,
    contact: ''
  });

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
  await query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [customer.id, userId]);

  return customer;
}

// Get or create Razorpay customer
export async function getOrCreateRazorpayCustomer(userId) {
  const userResult = await query(
    `SELECT email, stripe_customer_id FROM users WHERE id = $1`,
    [userId]
  );

  if (!userResult.rows[0]) {
    throw new Error('User not found');
  }

  const { email, stripe_customer_id } = userResult.rows[0];

  if (stripe_customer_id) {
    try {
      return await razorpay.customers.fetch(stripe_customer_id);
    } catch (error) {
      return await createRazorpayCustomer(userId, email);
    }
  }

  return await createRazorpayCustomer(userId, email);
}

// Create checkout session for subscription
export async function createCheckoutSession(userId) {
  assertRazorpayConfigured();

  const userResult = await query(`SELECT email FROM users WHERE id = $1`, [userId]);
  const user = userResult.rows[0];

  await getOrCreateRazorpayCustomer(userId);

  const session = await razorpay.paymentLink.create({
    amount: config.razorpayAmountPaise,
    currency: config.razorpayCurrency,
    accept_partial: false,
    description: config.razorpayPaymentDescription,
    customer: {
      name: user.email,
      email: user.email
    },
    notify: {
      email: true,
      sms: false
    },
    callback_url: `${config.baseUrl}/billing`,
    callback_method: 'get',
    reference_id: userId,
    notes: {
      userId
    }
  });

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_plan_id TEXT`);
  await query(`UPDATE users SET stripe_subscription_id = $1 WHERE id = $2`, [session.id, userId]);

  return session;
}

// Create billing portal session
export async function createBillingPortalSession(_userId) {
  throw new Error('Razorpay billing portal is not supported');
}

// Handle Razorpay webhook
export async function handleRazorpayWebhook(payload, signature) {
  assertRazorpayConfigured();

  const expectedSignature = crypto
    .createHmac('sha256', config.razorpayWebhookSecret)
    .update(payload)
    .digest('hex');

  if (signature !== expectedSignature) {
    throw new Error('Razorpay webhook signature verification failed');
  }

  const event = JSON.parse(payload.toString('utf8'));
  const eventType = event.event;
  const paymentLink = event.payload?.payment_link?.entity;
  const userId = paymentLink?.reference_id;

  if (!userId) {
    console.log('Razorpay webhook received without reference_id');
    return { received: true };
  }

  switch (eventType) {
    case 'payment_link.paid':
    case 'payment_link.fulfilled':
      await query(
        `UPDATE users SET stripe_subscription_status = $1, stripe_plan_id = $2 WHERE id = $3`,
        ['active', paymentLink.id, userId]
      );
      break;
    case 'payment_link.expired':
      await query(`UPDATE users SET stripe_subscription_status = $1 WHERE id = $2`, ['canceled', userId]);
      break;
    default:
      console.log(`Unhandled Razorpay event type: ${eventType}`);
  }

  return { received: true };
}

// Get subscription status for user
export async function getSubscriptionStatus(userId) {
  const userResult = await query(
    `SELECT stripe_subscription_id, stripe_subscription_status, stripe_plan_id 
     FROM users WHERE id = $1`,
    [userId]
  );

  if (!userResult.rows[0]?.stripe_subscription_id) {
    return { status: 'free', plan: 'Free 1000' };
  }

  const { stripe_subscription_status, stripe_plan_id } = userResult.rows[0];

  return {
    status: stripe_subscription_status || 'inactive',
    planId: stripe_plan_id,
    planDetails: null
  };
}

// Cancel subscription
export async function cancelSubscription(userId) {
  const userResult = await query(
    `SELECT stripe_subscription_id FROM users WHERE id = $1`,
    [userId]
  );

  const subscriptionId = userResult.rows[0]?.stripe_subscription_id;

  if (!subscriptionId) {
    throw new Error('No active subscription found');
  }

  await query(
    `UPDATE users SET stripe_subscription_status = $1 WHERE id = $2`,
    ['canceled', userId]
  );

  return { status: 'canceled' };
}