import type { Config } from './config.ts';
import type { Store } from './db.ts';

export interface Notice {
  title: string;
  body: string;
  taskId?: string;
}

export type Notifier = (n: Notice) => Promise<void>;

/**
 * Sends to every registered Expo push token (the mobile app) and, if set,
 * an ntfy.sh topic — handy before you have a development build of the app.
 */
export function createNotifier(config: Config, store: Store, log: (msg: string) => void): Notifier {
  return async (n) => {
    const jobs: Promise<unknown>[] = [];

    const tokens = store.listPushTokens();
    if (tokens.length) {
      jobs.push(
        fetch(config.expoPushUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(
            tokens.map((to) => ({ to, title: n.title, body: n.body, sound: 'default', data: { taskId: n.taskId } })),
          ),
        }).then(async (res) => {
          const json = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
          json?.data?.forEach((ticket, i) => {
            if (ticket.details?.error === 'DeviceNotRegistered') store.removePushToken(tokens[i]);
          });
        }),
      );
    }

    if (config.ntfyUrl) {
      // ntfy's JSON publish: POST to the server root with the topic in the body.
      const url = new URL(config.ntfyUrl);
      jobs.push(
        fetch(url.origin, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: url.pathname.replace(/^\//, ''), title: n.title, message: n.body }),
        }),
      );
    }

    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === 'rejected') log(`notify failed: ${r.reason}`);
  };
}
