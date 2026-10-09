import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Bearer token the mobile app must send. */
  apiToken: string;
  /** 32-byte key used to encrypt GitHub tokens at rest. */
  secretKey: Buffer;
  maxParallel: number;
  claudeBin: string;
  /** Permission mode for unattended agents; nobody is there to click "allow". */
  permissionMode: string;
  defaultModel: string | null;
  githubApiUrl: string;
  githubWebUrl: string;
  /** Optional ntfy.sh topic URL for push notifications without a custom app build. */
  ntfyUrl: string | null;
  expoPushUrl: string;
}

/** Read a secret from env, else from `<dataDir>/<file>`, else generate and persist it. */
function persistentSecret(envValue: string | undefined, dataDir: string, file: string, make: () => string): string {
  if (envValue) return envValue;
  const path = join(dataDir, file);
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const value = make();
  writeFileSync(path, value + '\n', { mode: 0o600 });
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.WG_DATA_DIR ?? 'data');
  mkdirSync(dataDir, { recursive: true });

  const apiToken = persistentSecret(env.WG_TOKEN, dataDir, 'api-token', () => randomBytes(24).toString('base64url'));
  const secretHex = persistentSecret(env.WG_SECRET_KEY, dataDir, 'secret.key', () => randomBytes(32).toString('hex'));
  const secretKey = Buffer.from(secretHex, 'hex');
  if (secretKey.length !== 32) throw new Error('WG_SECRET_KEY must be 64 hex characters (32 bytes)');

  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    apiToken,
    secretKey,
    maxParallel: Math.max(1, Number(env.WG_MAX_PARALLEL ?? 3)),
    claudeBin: env.WG_CLAUDE_BIN ?? 'claude',
    permissionMode: env.WG_PERMISSION_MODE ?? 'bypassPermissions',
    defaultModel: env.WG_MODEL || null,
    githubApiUrl: (env.WG_GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, ''),
    githubWebUrl: (env.WG_GITHUB_WEB_URL ?? 'https://github.com').replace(/\/$/, ''),
    ntfyUrl: env.WG_NTFY_URL || null,
    expoPushUrl: env.WG_EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2/push/send',
  };
}
