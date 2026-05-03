import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/postgres.js';
import { signToken } from '../middleware/auth.js';

const router = Router();
const credentials = z.object({ email: z.string().email(), password: z.string().min(8) });

router.post('/register', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_credentials' });

  const password = await bcrypt.hash(parsed.data.password, 12);
  const plan = await query("SELECT id FROM plans WHERE name = 'Free 1000' LIMIT 1");
  const result = await query(
    'INSERT INTO users (email, password, plan_id) VALUES ($1, $2, $3) RETURNING id, email, role',
    [parsed.data.email, password, plan.rows[0].id]
  ).catch((error) => {
    if (error.code === '23505') return null;
    throw error;
  });

  if (!result) return res.status(409).json({ error: 'email_already_registered' });
  const user = result.rows[0];
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_credentials' });

  const result = await query('SELECT id, email, password, role FROM users WHERE email = $1', [parsed.data.email]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password))) {
    return res.status(401).json({ error: 'invalid_login' });
  }

  res.json({ token: signToken(user), user: { id: user.id, email: user.email, role: user.role } });
});

export default router;
