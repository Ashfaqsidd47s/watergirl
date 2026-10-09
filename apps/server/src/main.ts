import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const { server, runner } = buildApp({ config, logger: true });

runner.recover();
await server.listen({ port: config.port, host: config.host });

console.log(`
  💧 Water Girl is listening on http://${config.host}:${config.port}
     Data:      ${config.dataDir}
     App token: ${process.env.WG_TOKEN ? '(from WG_TOKEN)' : config.apiToken}
     Agents:    up to ${config.maxParallel} at once
`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
