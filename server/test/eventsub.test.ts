import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { EventSub } from '../src/twitch/eventsub.js';
import { Bus } from '../src/bus.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const frame = (type: string, payload: unknown, id = 'event-1') => JSON.stringify({ metadata: { message_id: id, message_type: type, message_timestamp: new Date().toISOString(), subscription_type: type === 'notification' ? 'channel.chat.message' : undefined }, payload });
const welcome = (id: string, seconds = 10) => frame('session_welcome', { session: { id, keepalive_timeout_seconds: seconds } });
const payload = (id = 'chat-1', owner = 'owner') => ({ subscription: { type: 'channel.chat.message', condition: { broadcaster_user_id: owner, user_id: owner } }, event: { broadcaster_user_id: owner, message_id: id, chatter_user_id: 'viewer', chatter_user_login: 'viewer', chatter_user_name: 'Viewer', message: { text: 'hello stream' }, badges: [{ set_id: 'subscriber' }], reply: { parent_message_id: 'parent' } } });
async function fixture() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sockets: WebSocket[] = [];
  server.on('connection', socket => { sockets.push(socket); });
  const subscribe = vi.fn(async () => {});
  const bus = new Bus();
  const receiver = new EventSub({ endpoint: url, reconnectAllowed: target => target.origin === new URL(url).origin, bus, getSession: () => ({ broadcasterId: 'owner', accessToken: 'secret' }), subscribe });
  cleanup.push(async () => { receiver.stop(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); });
  receiver.start();
  await expect.poll(() => sockets.length).toBe(1);
  return { server, sockets, subscribe, bus, receiver, url };
}
describe('EventSub real WebSocket transport with fake Twitch', () => {
  it('subscribes on welcome, maps messages, and deduplicates event and chat IDs', async () => {
    const f = await fixture(); const message = vi.fn(); f.bus.on('chat.message', message);
    f.sockets[0]!.send(welcome('session-1'));
    await expect.poll(() => f.subscribe.mock.calls.length).toBe(1);
    f.sockets[0]!.send(frame('notification', payload()));
    f.sockets[0]!.send(frame('notification', payload()));
    f.sockets[0]!.send(frame('notification', payload(), 'different-event-id'));
    await expect.poll(() => f.receiver.snapshot().messages.length).toBe(1);
    expect(message).toHaveBeenCalledTimes(1);
    expect(f.receiver.snapshot().messages[0]).toMatchObject({ id: 'chat-1', text: 'hello stream', isSubscriber: true, replyToMessageId: 'parent', source: 'twitch' });
    expect(f.receiver.snapshot().status.state).toBe('connected');
  });
  it('drops malformed and foreign-channel events without breaking later messages', async () => {
    const f = await fixture(); const socket = f.sockets[0]!;
    socket.send(welcome('session-1'));
    await expect.poll(() => f.receiver.snapshot().status.state).toBe('connected');
    socket.send('{broken');
    socket.send(frame('notification', { event: 'invalid' }));
    socket.send(frame('notification', payload('foreign', 'someone-else')));
    const shared = payload('shared');
    socket.send(frame('notification', { ...shared, event: { ...shared.event, source_broadcaster_user_id: 'other' } }));
    socket.send(frame('notification', payload('valid')));
    await expect.poll(() => f.receiver.snapshot().messages.map(m => m.id)).toEqual(['valid']);
  });
  it('keeps the old socket until reconnect welcome and does not resubscribe', async () => {
    const f = await fixture(); const old = f.sockets[0]!;
    old.send(welcome('session-1'));
    await expect.poll(() => f.subscribe.mock.calls.length).toBe(1);
    old.send(frame('session_reconnect', { session: { reconnect_url: `${f.url}/reconnect` } }));
    await expect.poll(() => f.sockets.length).toBe(2);
    expect(old.readyState).toBe(WebSocket.OPEN);
    f.sockets[1]!.send(welcome('session-2'));
    await expect.poll(() => old.readyState).toBe(WebSocket.CLOSED);
    expect(f.subscribe).toHaveBeenCalledTimes(1);
    f.sockets[1]!.send(frame('notification', payload()));
    await expect.poll(() => f.receiver.snapshot().messages.length).toBe(1);
  });
  it('reconnects and resubscribes after an ordinary connection loss', async () => {
    const f = await fixture(); f.sockets[0]!.send(welcome('session-1'));
    await expect.poll(() => f.subscribe.mock.calls.length).toBe(1);
    f.sockets[0]!.terminate();
    await expect.poll(() => f.sockets.length, { timeout: 4000 }).toBe(2);
    f.sockets[1]!.send(welcome('session-2'));
    await expect.poll(() => f.subscribe.mock.calls.length).toBe(2);
  });
  it('reconnects when subscribing fails after an earlier reconnect', async () => {
    const f = await fixture(); f.sockets[0]!.send(welcome('session-1'));
    await expect.poll(() => f.subscribe.mock.calls.length).toBe(1);
    f.sockets[0]!.terminate();
    await expect.poll(() => f.sockets.length, { timeout: 4000 }).toBe(2);
    expect(f.receiver.snapshot().status.state).toBe('reconnecting');
    f.subscribe.mockRejectedValueOnce(new Error('Twitch subscription failed (HTTP 503)'));
    f.sockets[1]!.send(welcome('session-2'));
    await expect.poll(() => f.sockets[1]!.readyState).toBe(WebSocket.CLOSED);
    await expect.poll(() => f.sockets.length, { timeout: 5000 }).toBe(3);
    f.sockets[2]!.send(welcome('session-3'));
    await expect.poll(() => f.receiver.snapshot().status.state).toBe('connected');
    expect(f.subscribe).toHaveBeenCalledTimes(3);
  }, 10_000);
  it('reconnects when keepalive messages stop', async () => {
    const f = await fixture(); f.sockets[0]!.send(welcome('session-1', 1));
    await expect.poll(() => f.sockets.length, { timeout: 5500 }).toBe(2);
  }, 7000);
  it('surfaces revocation and stops accepting events', async () => {
    const f = await fixture(); f.sockets[0]!.send(welcome('session-1'));
    await expect.poll(() => f.subscribe.mock.calls.length).toBe(1);
    f.sockets[0]!.send(frame('revocation', { subscription: { status: 'authorization_revoked' } }));
    await expect.poll(() => f.receiver.snapshot().status.state).toBe('revoked');
    expect(f.receiver.snapshot().messages).toEqual([]);
  });
  it('bounds the in-memory message buffer', async () => {
    const f = await fixture(); f.sockets[0]!.send(welcome('session-1'));
    await expect.poll(() => f.subscribe.mock.calls.length).toBe(1);
    for (let i = 0; i < 2005; i++) f.sockets[0]!.send(frame('notification', payload(`chat-${i}`), `event-${i}`));
    await expect.poll(() => f.receiver.snapshot().messages.at(-1)?.id).toBe('chat-2004');
    expect(f.receiver.snapshot().messages).toHaveLength(2000);
    expect(f.receiver.snapshot().messages[0]?.id).toBe('chat-5');
  });
});
