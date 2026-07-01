import { config } from './config';
import { createInternalClient } from './ws/internalClient';
import { GameSessionManager } from './session/GameSessionManager';

function main(): void {
  const wsClient = createInternalClient({
    url:            config.GATEWAY_WS_URL,
    secret:         config.INTERNAL_SERVICE_SECRET,
    serviceName:    'game-service',
    healthFilePath: '/tmp/healthy',
  });

  const manager = new GameSessionManager((msg) => wsClient.send(msg));
  wsClient.onMessage('game:assign', (msg) => manager.handleAssign(msg));
  wsClient.onMessage('game:input',  (msg) => manager.handleInput(msg));

  process.on('SIGTERM', () => {
    wsClient.close();
    process.exit(0);
  });
}

main();
