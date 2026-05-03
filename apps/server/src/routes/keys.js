import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/postgres.js';
import { redis } from '../db/redis.js';
import { requireAuth } from '../middleware/auth.js';
import { createRawKey, hashKey } from '../utils/keys.js';

const router = Router();
const keySchema = z.object({
  apiId: z.string().uuid(),
  label: z.string().min(2).default('Default key'),
  environment: z.enum(['test', 'live']).default('test')
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await query(
    `SELECT k.id, k.api_id AS "apiId", a.name AS "apiName", k.label, k.environment, k.status,
            k.created_at AS "createdAt", k.grace_expires_at AS "graceExpiresAt"
     FROM api_keys k
     JOIN api_configs a ON a.id = k.api_id
     WHERE k.user_id = $1
     ORDER BY k.created_at DESC`,
    [req.user.sub]
  );
  res.json({ keys: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = keySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_key_request' });

  const ownsApi = await query('SELECT id FROM api_configs WHERE id = $1 AND user_id = $2', [parsed.data.apiId, req.user.sub]);
  if (!ownsApi.rowCount) return res.status(404).json({ error: 'api_not_found' });

  const rawKey = createRawKey(parsed.data.environment);
  const keyHash = hashKey(rawKey);
  const result = await query(
    `INSERT INTO api_keys (api_id, user_id, key_hash, label, environment)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, api_id AS "apiId", label, environment, status, created_at AS "createdAt"`,
    [parsed.data.apiId, req.user.sub, keyHash, parsed.data.label, parsed.data.environment]
  );

  res.status(201).json({ key: result.rows[0], rawKey });
});

router.post('/:id/revoke', async (req, res) => {
  const result = await query(
    `UPDATE api_keys SET status = 'revoked', revoked_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING key_hash`,
    [req.params.id, req.user.sub]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'key_not_found' });
  await redis.del(`key:${result.rows[0].key_hash}`);
  res.json({ ok: true });
});

router.post('/:id/rotate', async (req, res) => {
  const oldKey = await query(
    `UPDATE api_keys
     SET status = 'rotating', grace_expires_at = NOW() + ($3 || ' hours')::interval
     WHERE id = $1 AND user_id = $2 AND status = 'active'
     RETURNING api_id, label, environment, key_hash`,
    [req.params.id, req.user.sub, config.keyGraceHours]
  );
  if (!oldKey.rowCount) return res.status(404).json({ error: 'active_key_not_found' });

  const rawKey = createRawKey(oldKey.rows[0].environment);
  const keyHash = hashKey(rawKey);
  const created = await query(
    `INSERT INTO api_keys (api_id, user_id, key_hash, label, environment)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, api_id AS "apiId", label, environment, status, created_at AS "createdAt"`,
    [oldKey.rows[0].api_id, req.user.sub, keyHash, `${oldKey.rows[0].label} rotated`, oldKey.rows[0].environment]
  );
  await redis.del(`key:${oldKey.rows[0].key_hash}`);
  res.status(201).json({ key: created.rows[0], rawKey, oldKeyGraceHours: config.keyGraceHours });
});

export default router;
