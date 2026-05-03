import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';

const base62 = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 32);

export function createRawKey(environment = 'test') {
  return `mf_${environment}_${base62()}`;
}

export function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}
