import { buildApp }              from './app';
import { config }                from './config';
import { createInternalClient }  from './ws/internalClient';
import { recordMatchResult }     from './services/match.service';
import { handleMatchRecorded }   from './handlers/matchRecorded';

async function main() {
  // wsClient created before buildApp() so /health can read its live connection
  // state via getWsConnected — no healthFilePath here, since the HTTP
  // /health route now reports the WS connection itself instead of a
  // Docker-level file check.
  const wsClient = createInternalClient({
    url:         config.GATEWAY_WS_URL,
    secret:      config.INTERNAL_SERVICE_SECRET,
    serviceName: 'user-service',
  });

  const app = await buildApp({ getWsConnected: () => wsClient.isConnected() });

  wsClient.onMessage('user:matchRecorded', (msg) => {
    void handleMatchRecorded(msg.payload, recordMatchResult);
  });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  process.on('SIGTERM', () => {
    void (async () => {
      wsClient.close();
      await app.close();
      process.exit(0);
    })();
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
