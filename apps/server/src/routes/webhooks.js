import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/postgres.js';

const router = Router();

// Get webhook configuration for user
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT webhook_url FROM users WHERE id = $1`,
      [req.user.sub]
    );
    
    res.json({ 
      webhook_url: result.rows[0]?.webhook_url || null 
    });
  } catch (error) {
    console.error('Error getting webhook config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set webhook URL
router.post('/', requireAuth, async (req, res) => {
  try {
    const { webhook_url } = req.body;
    
    if (webhook_url) {
      // Validate URL format
      try {
        new URL(webhook_url);
      } catch {
        return res.status(400).json({ error: 'Invalid webhook URL format' });
      }
    }
    
    await query(
      `UPDATE users SET webhook_url = $1 WHERE id = $2`,
      [webhook_url || null, req.user.sub]
    );
    
    res.json({ success: true, webhook_url });
  } catch (error) {
    console.error('Error setting webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test webhook - sends a test event
router.post('/test', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT webhook_url FROM users WHERE id = $1`,
      [req.user.sub]
    );
    
    const webhookUrl = result.rows[0]?.webhook_url;
    
    if (!webhookUrl) {
      return res.status(400).json({ error: 'No webhook URL configured' });
    }
    
    const testPayload = {
      event: 'test',
      userId: req.user.sub,
      message: 'This is a test webhook from MeterFlow',
      timestamp: new Date().toISOString()
    };
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-MeterFlow-Event': 'test'
      },
      body: JSON.stringify(testPayload)
    });
    
    if (!response.ok) {
      return res.status(400).json({ 
        error: 'Webhook test failed',
        status: response.status,
        message: await response.text()
      });
    }
    
    res.json({ success: true, message: 'Webhook test successful' });
  } catch (error) {
    console.error('Error testing webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get webhook event logs
router.get('/events', requireAuth, async (req, res) => {
  try {
    // Create table if not exists
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
    
    const result = await query(
      `SELECT event, payload, status, response_status, created_at
       FROM webhook_events 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [req.user.sub]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting webhook events:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;