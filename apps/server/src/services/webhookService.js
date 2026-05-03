import { query } from '../db/postgres.js';

// Webhook event types
export const WebhookEvent = {
  SPEND_ALERT: 'spend_alert',
  SPEND_CAP_REACHED: 'spend_cap_reached',
  BILLING_CREATED: 'billing_created',
  PAYMENT_SUCCEEDED: 'payment_succeeded',
  PAYMENT_FAILED: 'payment_failed',
  API_KEY_ROTATED: 'api_key_rotated',
  API_KEY_REVOKED: 'api_key_revoked',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded'
};

// Send webhook to user's configured endpoint
export async function sendWebhook(userId, event, payload) {
  try {
    const userResult = await query(
      `SELECT webhook_url FROM users WHERE id = $1`,
      [userId]
    );
    
    const webhookUrl = userResult.rows[0]?.webhook_url;
    if (!webhookUrl) {
      console.log(`No webhook configured for user ${userId}`);
      return null;
    }
    
    const fullPayload = {
      event,
      userId,
      timestamp: new Date().toISOString(),
      data: payload
    };
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-MeterFlow-Event': event,
        'X-MeterFlow-Timestamp': new Date().toISOString()
      },
      body: JSON.stringify(fullPayload),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    // Log the webhook event
    await logWebhookEvent(userId, event, payload, response.status, await response.text().catch(() => null));
    
    if (!response.ok) {
      console.error(`Webhook failed for user ${userId}: ${response.status}`);
      return { success: false, status: response.status };
    }
    
    return { success: true, status: response.status };
  } catch (error) {
    console.error(`Error sending webhook for user ${userId}:`, error.message);
    // Log failed webhook
    await logWebhookEvent(userId, event, payload, 0, error.message);
    return { success: false, error: error.message };
  }
}

// Log webhook event to database
async function logWebhookEvent(userId, event, payload, responseStatus, responseBody) {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        event TEXT NOT NULL,
        payload JSONB,
        status TEXT DEFAULT 'pending',
        response_status INT,
        response_body TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await query(
      `INSERT INTO webhook_events (user_id, event, payload, status, response_status, response_body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, event, JSON.stringify(payload), responseStatus < 400 ? 'success' : 'failed', responseStatus, responseBody]
    );
  } catch (error) {
    console.error('Error logging webhook event:', error.message);
  }
}

// Check spend thresholds and send alerts
export async function checkAndAlertSpend(userId) {
  try {
    const userResult = await query(
      `SELECT spend_alert_paise, spend_hard_cap_paise FROM users WHERE id = $1`,
      [userId]
    );
    
    const user = userResult.rows[0];
    if (!user) return;
    
    const alertThreshold = user.spend_alert_paise || 500000;
    const hardCap = user.spend_hard_cap_paise || 1000000;
    
    // Get current month spending
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    
    const billingResult = await query(
      `SELECT COALESCE(SUM(amount_paise), 0) as current_spend 
       FROM billing_periods 
       WHERE user_id = $1 AND starts_at >= $2 AND status = 'invoiced'`,
      [userId, monthStart]
    );
    
    const currentSpend = Number(billingResult.rows[0]?.current_spend || 0);
    
    // Check if we've hit the alert threshold (but not previously alerted this month)
    const alertKey = `alert:${userId}:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    
    if (currentSpend >= alertThreshold) {
      await sendWebhook(userId, WebhookEvent.SPEND_ALERT, {
        current_spend: currentSpend,
        threshold: alertThreshold,
        percentage: Math.round((currentSpend / alertThreshold) * 100)
      });
    }
    
    // Check if we've hit the hard cap
    if (currentSpend >= hardCap) {
      await sendWebhook(userId, WebhookEvent.SPEND_CAP_REACHED, {
        current_spend: currentSpend,
        hard_cap: hardCap
      });
    }
    
    return { currentSpend, alertThreshold, hardCap };
  } catch (error) {
    console.error(`Error checking spend alerts for user ${userId}:`, error.message);
  }
}

// Send billing notification
export async function notifyBillingCreated(userId, billingData) {
  return sendWebhook(userId, WebhookEvent.BILLING_CREATED, billingData);
}

// Send payment notification
export async function notifyPaymentStatus(userId, status, amount) {
  const event = status === 'succeeded' ? WebhookEvent.PAYMENT_SUCCEEDED : WebhookEvent.PAYMENT_FAILED;
  return sendWebhook(userId, event, { amount, status });
}