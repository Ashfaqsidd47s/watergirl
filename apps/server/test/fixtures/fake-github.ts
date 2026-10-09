import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_TOKEN = 'ghp_test';

interface Pull {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  merged: boolean;
  state: 'open' | 'closed';
}

/** Just enough of the GitHub REST API for Water Girl's flows. */
export async function startFakeGithub() {
  const pulls: Pull[] = [];
  const deletedBranches: string[] = [];

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (status: number, body?: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body === undefined ? '' : JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) return send(401, { message: 'Bad credentials' });
      const url = new URL(req.url!, 'http://x');
      const p = url.pathname;
      const body = raw ? JSON.parse(raw) : {};
      let m: RegExpMatchArray | null;

      if (req.method === 'GET' && p === '/user') return send(200, { login: 'ash', id: 42, avatar_url: null });
      if (req.method === 'GET' && p === '/user/repos') {
        return send(200, [{ name: 'nucleus', full_name: 'ash/nucleus', owner: { login: 'ash' }, default_branch: 'main', private: true }]);
      }
      if ((m = p.match(/^\/repos\/([^/]+)\/([^/]+)$/)) && req.method === 'GET') {
        return send(200, { name: m[2], full_name: `${m[1]}/${m[2]}`, owner: { login: m[1] }, default_branch: 'main', private: true });
      }
      if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/pulls$/))) {
        if (req.method === 'GET') {
          const head = url.searchParams.get('head')?.split(':')[1];
          return send(200, pulls.filter((x) => x.state === 'open' && x.head === head).map(toJson));
        }
        const pr: Pull = { number: pulls.length + 1, head: body.head, base: body.base, title: body.title, body: body.body, merged: false, state: 'open' };
        pulls.push(pr);
        return send(201, toJson(pr));
      }
      if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/)) && req.method === 'GET') {
        const pr = pulls.find((x) => x.number === Number(m![1]));
        return pr ? send(200, toJson(pr)) : send(404, { message: 'Not Found' });
      }
      if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/merge$/)) && req.method === 'PUT') {
        const pr = pulls.find((x) => x.number === Number(m![1]));
        if (!pr) return send(404, { message: 'Not Found' });
        pr.merged = true;
        pr.state = 'closed';
        return send(200, { merged: true, message: 'Pull Request successfully merged' });
      }
      if (p.match(/\/commits\/[^/]+\/check-runs$/)) {
        return send(200, { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }] });
      }
      if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/refs\/heads\/(.+)$/)) && req.method === 'DELETE') {
        deletedBranches.push(decodeURIComponent(m[1]));
        return send(204);
      }
      send(404, { message: `fake github: no route for ${req.method} ${p}` });
    });
  });

  function toJson(pr: Pull) {
    return {
      number: pr.number,
      html_url: `https://github.com/ash/nucleus/pull/${pr.number}`,
      state: pr.state,
      merged: pr.merged,
      mergeable: true,
      mergeable_state: 'clean',
      head: { sha: 'abc123', ref: pr.head },
    };
  }

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    pulls,
    deletedBranches,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
