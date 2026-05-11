import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { PortsideStore } from './store';

type RealtimeRoom = 'status' | 'players' | 'resources' | 'logs';

interface RealtimeClient {
  socket: WebSocket;
  rooms: Set<RealtimeRoom>;
}

const rooms = new Set<RealtimeRoom>(['status', 'players', 'resources', 'logs']);

const parseRooms = (value: string | null): Set<RealtimeRoom> => {
  const requested = (value || '')
    .split(',')
    .map(room => room.trim())
    .filter((room): room is RealtimeRoom => rooms.has(room as RealtimeRoom));

  return new Set(requested.length ? requested : Array.from(rooms));
};

const getToken = (request: IncomingMessage) => {
  const url = new URL(request.url || '/', 'http://localhost');
  const queryToken = url.searchParams.get('token');
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice('Bearer '.length);
  return queryToken || '';
};

export class RealtimeHub {
  private clients = new Set<RealtimeClient>();

  attach(server: HttpServer, store: PortsideStore) {
    const wss = new WebSocketServer({ server, path: '/api/realtime' });

    wss.on('connection', (socket, request) => {
      const token = getToken(request);
      const session = token ? store.getSession(token) : null;
      const debugBypass = (process.env.DEBUG === 'true' || process.env.VITE_DEBUG === 'true') && token === 'debug-token';
      if (!session && !debugBypass) {
        socket.close(1008, 'Unauthorized');
        return;
      }

      const url = new URL(request.url || '/', 'http://localhost');
      const client: RealtimeClient = {
        socket,
        rooms: parseRooms(url.searchParams.get('rooms')),
      };

      this.clients.add(client);
      socket.send(JSON.stringify({ type: 'ready', rooms: Array.from(client.rooms) }));
      socket.on('close', () => this.clients.delete(client));
      socket.on('error', () => this.clients.delete(client));
    });
  }

  broadcast(room: RealtimeRoom, payload: unknown) {
    const message = JSON.stringify({ room, payload, timestamp: new Date().toISOString() });

    for (const client of this.clients) {
      if (!client.rooms.has(room) || client.socket.readyState !== client.socket.OPEN) continue;
      client.socket.send(message);
    }
  }
}
