import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { Bus } from '../src/bus.js';
import { attachDashboardSocket } from '../src/server/dashboardSocket.js';
it('sends snapshots and live events, and rejects foreign browser origins', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const bus = new Bus();
  const snapshot = { status: { state: 'waiting' as const, message: 'Waiting' }, messages: [] };
  const close = attachDashboardSocket(server, bus, () => snapshot, port);
  let client: WebSocket | undefined;
  try {
    const forbidden = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://attacker.test' });
    const [error] = await once(forbidden, 'error');
    expect(error).toBeInstanceOf(Error);
    client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://localhost:${port}` });
    const [initial] = await once(client, 'message');
    expect(JSON.parse(initial.toString())).toEqual({ type: 'snapshot', payload: snapshot });
    const next = once(client, 'message');
    bus.emit('status', { state: 'connected', message: 'Receiving chat' });
    const [update] = await next;
    expect(JSON.parse(update.toString()).payload.state).toBe('connected');
  } finally {
    client?.terminate(); await close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
