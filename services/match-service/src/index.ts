import { config } from './config';
import { createInternalClient } from './ws/internalClient';
import { createMatch, findActiveMatchForUser, closeMatch } from './services/match.service';
import { MatchmakingQueue } from './matchmaking/MatchmakingQueue';
import { handleMatchResult } from './handlers/matchResult';

function main(): void {
  const wsClient = createInternalClient({
    url:            config.GATEWAY_WS_URL,
    secret:         config.INTERNAL_SERVICE_SECRET,
    serviceName:    'match-service',
    healthFilePath: '/tmp/healthy',
  });

  const queue = new MatchmakingQueue(
    (msg) => wsClient.send(msg),
    createMatch,
    findActiveMatchForUser,
  );

  wsClient.onMessage('match:join',        (msg) => { if (msg.userId !== undefined) void queue.handleJoin(msg.userId); });
  wsClient.onMessage('match:cancel',      (msg) => { if (msg.userId !== undefined) queue.handleCancel(msg.userId); });
  wsClient.onMessage('player:disconnect', (msg) => { if (msg.userId !== undefined) queue.handleDisconnect(msg.userId); });
  wsClient.onMessage('match:result',      (msg) => { void handleMatchResult(msg.payload, closeMatch); });

  process.on('SIGTERM', () => {
    wsClient.close();
    process.exit(0);
  });
}

main();
