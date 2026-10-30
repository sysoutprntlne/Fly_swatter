import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { Bus } from '../bus.js';
import type { ChatSnapshot } from '../types.js';
export function attachDashboardSocket(server: Server, bus: Bus, snapshot: () => ChatSnapshot, port: number) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const origins = new Set([...hosts].map(host => `http://${host}`).concat(['http://localhost:5173', 'http://127.0.0.1:5173']));
  const handleUpgrade = (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    if (req.url !== '/ws' || !hosts.has(req.headers.host ?? '') || !origins.has(req.headers.origin ?? '')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, client => wss.emit('connection', client));
  };
  server.on('upgrade', handleUpgrade);
  const send = (client: WebSocket, data: unknown) => {
    if (client.bufferedAmount > 1_000_000) { client.terminate(); return; }
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
  };
  const broadcast = (type: string, payload: unknown) => { for (const client of wss.clients) send(client, { type, payload }); };
  wss.on('connection', client => {
    client.on('error', () => client.terminate());
    send(client, { type: 'snapshot', payload: snapshot() });
  });
  const unsubscribers = [bus.on('chat.message', message => broadcast('chat.message', message)), bus.on('status', status => broadcast('status', status)), bus.on('chat.reset', () => broadcast('chat.reset', null)),
    bus.on('raid', raid => broadcast('raid', raid)), bus.on('demo.state', state => broadcast('demo.state', state)), bus.on('demo.cleared', () => broadcast('demo.cleared', null)),
    bus.on('classification', flagged => { if (flagged.classification.category !== 'benign') broadcast('classification', flagged); }),
    bus.on('cluster.updated', clusters => broadcast('cluster.updated', clusters)), bus.on('risk.updated', risk => broadcast('risk.updated', risk)),
    bus.on('action.taken', record => broadcast('action.taken', record)), bus.on('mode', mode => broadcast('mode', mode)), bus.on('settings', settings => broadcast('settings', settings)),
    bus.on('ai.status', status => broadcast('ai.status', status)), bus.on('pipeline.reset', snapshot => broadcast('pipeline.reset', snapshot)),
    bus.on('review', review => broadcast('review', review))];
  const heartbeat = setInterval(() => broadcast('heartbeat', null), 15_000); heartbeat.unref();
  return async () => {
    clearInterval(heartbeat); for (const unsubscribe of unsubscribers) unsubscribe();
    server.off('upgrade', handleUpgrade);
    for (const client of wss.clients) client.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  };
}
