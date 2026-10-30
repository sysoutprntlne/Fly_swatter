import { expect, it, vi } from 'vitest';
import { Helix } from '../src/twitch/helix.js';
const session = { accessToken: 'secret', broadcasterId: 'own-channel' };
it('subscribes only to the token owner’s channel using a user token', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 202 }));
  const auth = { getChatSession: () => session, refresh: vi.fn(async () => {}) };
  await new Helix('client', auth, request).subscribeChat('session-id', new AbortController().signal);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe('https://api.twitch.tv/helix/eventsub/subscriptions');
  expect(JSON.parse(init!.body as string)).toEqual({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: 'own-channel', user_id: 'own-channel' }, transport: { method: 'websocket', session_id: 'session-id' } });
});
it('refreshes once on 401', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(new Response('{}', { status: 202 }));
  const auth = { getChatSession: () => session, refresh: vi.fn(async () => {}) };
  await new Helix('client', auth, request).subscribeChat('id', new AbortController().signal);
  expect(auth.refresh).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(2);
});
it('waits until rate-limit reset and retries only once', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}', { status: 429, headers: { 'Ratelimit-Reset': '2' } }));
  const wait = vi.fn(async () => {});
  const auth = { getChatSession: () => session, refresh: vi.fn(async () => {}) };
  await expect(new Helix('client', auth, request, () => 1000, wait).subscribeChat('id', new AbortController().signal)).rejects.toThrow('429');
  expect(wait).toHaveBeenCalledWith(1100); expect(request).toHaveBeenCalledTimes(2);
});
it('makes no request without chat permission', async () => {
  const request = vi.fn<typeof fetch>();
  await expect(new Helix('client', { getChatSession: () => undefined, refresh: vi.fn() }, request).subscribeChat('id', new AbortController().signal)).rejects.toThrow('authorization required');
  expect(request).not.toHaveBeenCalled();
});
