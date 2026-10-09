import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

// AES-256-GCM, stored as base64url(iv | tag | ciphertext).

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function decrypt(sealed: string, key: Buffer): string {
  const raw = Buffer.from(sealed, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/** Constant-time string comparison (hash first so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function shortId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')}`;
}
