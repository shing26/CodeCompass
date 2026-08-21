import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { EventBus } from './events';

export function attachWebSocket(
  server: Server,
  path: string,
  eventBus: EventBus
): WebSocketServer {
  const wss = new WebSocketServer({ server, path });
  wss.on('connection', (socket) => {
    const unsubscribe = eventBus.on((event) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    });
    socket.on('close', unsubscribe);
  });
  return wss;
}
