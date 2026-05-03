import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/postgres.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const apiSchema = z.object({
  name: z.string().min(2),
  baseUrl: z.string().url()
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await query(
    'SELECT id, name, base_url AS "baseUrl", created_at AS "createdAt" FROM api_configs WHERE user_id = $1 ORDER BY created_at DESC',
    [req.user.sub]
  );
  res.json({ apis: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = apiSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_api_config' });

  const result = await query(
    'INSERT INTO api_configs (user_id, name, base_url) VALUES ($1, $2, $3) RETURNING id, name, base_url AS "baseUrl", created_at AS "createdAt"',
    [req.user.sub, parsed.data.name, parsed.data.baseUrl]
  );
  res.status(201).json({ api: result.rows[0] });
});

export default router;
