import { config } from './config';
import { createInternalClient } from './ws/internalClient';
import { BotSessionManager } from './bot/BotSessionManager';

function main(): void {
  const wsClient = createInternalClient({
    url:            config.GATEWAY_WS_URL,
    secret:         config.INTERNAL_SERVICE_SECRET,
    serviceName:    'ai-bot-service',
    healthFilePath: '/tmp/healthy',
  });

  const manager = new BotSessionManager((msg) => wsClient.send(msg));
  wsClient.onMessage('ai-bot:sessionStart', (msg) => manager.handleSessionStart(msg));
  wsClient.onMessage('ai-bot:state',        (msg) => manager.handleState(msg));
  wsClient.onMessage('ai-bot:sessionEnd',   (msg) => manager.handleSessionEnd(msg));

  process.on('SIGTERM', () => {
    wsClient.close();
    process.exit(0);
  });
}

main();
