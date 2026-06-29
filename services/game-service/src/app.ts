import http from 'node:http';

export interface ServerInstance {
  httpServer: http.Server;
}

export function buildServer(): ServerInstance {
  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // WS client connection to gateway-ws initialised here in the next PR.

  return { httpServer };
}
