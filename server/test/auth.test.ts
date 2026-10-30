import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TwitchAuth, FileTokenStore, type TokenStore } from '../src/twitch/auth.js';
import { parseConfig } from '../src/config.js';
import { createApp } from '../src/server/http.js';
const config = parseConfig({ LOG_LEVEL: 'silent', TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'test-client-secret' });
const stored = { access_token: 'old-access', refresh_token: 'old-refresh', expiresIn: 3600, obtainedAt: 0 };
const token = { access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'bearer' };
const identity = { client_id: 'client', user_id: 'own-user', login: 'own-broadcaster', scopes: [], expires_in: 3600 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function memoryStore(value: typeof stored | undefined = undefined) {
  let current = value;
  return { load: vi.fn(async () => current), save: vi.fn(async (tokens: typeof stored) => { current = tokens; }), clear: vi.fn(async () => { current = undefined; }) } satisfies TokenStore;
}
afterEach(() => vi.useRealTimers());
describe('Twitch OAuth', () => {
  it('uses unique, expiring, single-use states and no arbitrary channel parameter', () => {
    let now = 0;
    const auth = new TwitchAuth(config, memoryStore(), vi.fn(), () => now);
    const first = auth.beginLogin();
    expect(new URL(first.url).searchParams.get('response_type')).toBe('code');
    expect(first.url).not.toContain('test-client-secret');
    expect(auth.beginLogin().state).not.toBe(first.state);
    expect(auth.consumeState(first.state)).toBe(true);
    expect(auth.consumeState(first.state)).toBe(false);
    const expired = auth.beginLogin(); now = 600_001;
    expect(auth.consumeState(expired.state)).toBe(false);
  });
  it('exchanges a code, validates identity and persists tokens without exposing them', async () => {
    const store = memoryStore();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(identity));
    const auth = new TwitchAuth(config, store, request, () => 123);
    await auth.exchange('test-code');
    expect(auth.status()).toMatchObject({ connected: true, broadcasterId: 'own-user', login: 'own-broadcaster' });
    expect(JSON.stringify(auth.status())).not.toContain('access');
    expect(store.save).toHaveBeenCalledWith({ access_token: 'new-access', refresh_token: 'rotated-refresh', obtainedAt: 123, expiresIn: 3600 });
    expect((request.mock.calls[0]?.[1]?.body as URLSearchParams).get('redirect_uri')).toBe(config.TWITCH_REDIRECT_URI);
  });
  it('validates stored credentials on restart and hourly', async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>().mockImplementation(async () => json(identity));
    const auth = new TwitchAuth(config, memoryStore(stored), request);
    await auth.start();
    expect(auth.status().connected).toBe(true);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(request).toHaveBeenCalledTimes(2);
    auth.stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('reacts to 401 by refreshing and persisting the rotated token', async () => {
    const store = memoryStore(stored);
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(identity));
    const auth = new TwitchAuth(config, store, request);
    await auth.start(); auth.stop();
    expect(auth.status().connected).toBe(true);
    expect(store.save.mock.calls[0]?.[0].refresh_token).toBe('rotated-refresh');
    expect((request.mock.calls[1]?.[1]?.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
  });
  it('deduplicates concurrent refreshes', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/token') ? json(token) : json(identity));
    const auth = new TwitchAuth(config, memoryStore(stored), request);
    await auth.start();
    await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()]);
    auth.stop();
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
  });
  it('disables the session and clears stored credentials when refresh fails', async () => {
    const store = memoryStore(stored);
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ message: 'upstream-sensitive-data' }, 400));
    const auth = new TwitchAuth(config, store, request);
    await auth.start(); auth.stop();
    expect(auth.status()).toMatchObject({ connected: false, message: 'Re-login required' });
    expect(store.clear).toHaveBeenCalled();
    expect(JSON.stringify(auth.status())).not.toContain('upstream-sensitive-data');
  });
  it.each([{ ...identity, client_id: 'another-app' }, { ...identity, user_id: null }, { ...identity, login: null }])('rejects wrong app and app-only tokens: %j', async invalid => {
    const store = memoryStore();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(invalid));
    const auth = new TwitchAuth(config, store, request);
    await expect(auth.exchange('code')).rejects.toThrow('sign-in failed');
    expect(auth.status().connected).toBe(false); expect(store.save).not.toHaveBeenCalled();
  });
  it('fails closed on network errors without discarding retryable credentials', async () => {
    const store = memoryStore(stored);
    const auth = new TwitchAuth(config, store, vi.fn().mockRejectedValue(new Error('network secret')));
    await auth.start(); auth.stop();
    expect(auth.status().connected).toBe(false);
    expect(auth.status().message).toContain('unavailable');
    expect(store.clear).not.toHaveBeenCalled();
  });
});
it('writes tokens atomically with private permissions and reloads them', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'fly-auth-'));
  try {
    const path = join(folder, '.tokens.json'); const store = new FileTokenStore(path);
    expect(await store.load()).toBeUndefined();
    await store.save(stored);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await new FileTokenStore(path).load()).toEqual(stored);
    expect(JSON.parse(await readFile(path, 'utf8')).refresh_token).toBe('old-refresh');
    await writeFile(path, 'malformed');
    await expect(store.load()).rejects.toThrow('Stored token unavailable');
    await store.clear(); expect(await store.load()).toBeUndefined();
  } finally { await rm(folder, { recursive: true, force: true }); }
});
it('binds OAuth state to the browser, rejects replays, and protects mutation requests', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/token') ? json(token) : json(identity));
  const auth = new TwitchAuth(config, memoryStore(), request);
  const app = await createApp(config, auth);
  const host = { host: 'localhost:3000' };
  try {
    const begin = await app.inject({ url: '/auth/login', headers: host });
    const state = new URL(begin.headers.location!).searchParams.get('state')!;
    const cookie = `fly_oauth_${state}=${state}`;
    const callback = `/auth/callback?code=test-code&state=${state}`;
    expect((await app.inject({ url: callback, headers: host })).statusCode).toBe(400);
    expect(request).not.toHaveBeenCalled();
    const success = await app.inject({ url: callback, headers: { ...host, cookie } });
    expect(success.statusCode).toBe(302);
    const session = success.cookies.find(c => c.name === 'fly_session')!;
    expect(session.httpOnly).toBe(true); expect(session.sameSite).toBe('Strict');
    expect((await app.inject({ url: callback, headers: { ...host, cookie } })).statusCode).toBe(400);
    const status = await app.inject({ url: '/auth/status', headers: host });
    expect(status.json().login).toBe('own-broadcaster'); expect(status.body).not.toContain('new-access');
    expect((await app.inject({ method: 'POST', url: '/auth/revalidate', headers: host })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/auth/revalidate', headers: { ...host, cookie: `fly_session=${session.value}`, origin: 'http://evil.test' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/auth/revalidate', headers: { ...host, cookie: `fly_session=${session.value}`, origin: 'http://localhost:3000' } })).statusCode).toBe(200);
  } finally { await app.close(); }
});
it('reports the failing login stage without exposing upstream response details', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ message: 'secret-code-and-token' }, 400));
  const auth = new TwitchAuth(config, memoryStore(), request);
  await expect(auth.exchange('secret-code')).rejects.toThrow('token exchange (HTTP 400)');
  expect(auth.status().message).not.toContain('secret-code');
  expect(auth.status().connected).toBe(false);
});
it('identifies malformed validation fields without revealing their values', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ ...identity, scopes: 'malformed-secret-value' }));
  const auth = new TwitchAuth(config, memoryStore(), request);
  await expect(auth.exchange('code')).rejects.toThrow('account validation (unexpected response fields: scopes)');
  expect(auth.status().message).not.toContain('malformed-secret-value');
  expect(auth.status().message).not.toContain('new-access');
});
it('distinguishes storage failures from Twitch failures', async () => {
  const store = memoryStore(); store.save.mockRejectedValueOnce(new Error('secret-file-content'));
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(identity));
  const auth = new TwitchAuth(config, store, request);
  await expect(auth.exchange('code')).rejects.toThrow('local token storage');
  expect(auth.status().message).not.toContain('secret-file-content');
});

it.each([null, undefined, []])('accepts a no-permission login with scopes=%j and restores it on restart', async scopes => {
  const store = memoryStore();
  const request = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/token') ? json(token) : json({ ...identity, scopes }));
  const auth = new TwitchAuth(config, store, request);
  await auth.exchange('code');
  expect(auth.status()).toMatchObject({ connected: true, broadcasterId: 'own-user' });
  const restarted = new TwitchAuth(config, store, request);
  try {
    await restarted.start();
    expect(restarted.status()).toMatchObject({ connected: true, login: 'own-broadcaster' });
  } finally { restarted.stop(); }
});
it.each([null, undefined, []])('does not treat scopes=%j as a grant of chat permissions', async scopes => {
  const store = memoryStore();
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ ...identity, scopes }));
  const auth = new TwitchAuth(config, store, request);
  await auth.exchange('code');
  expect(auth.status().connected).toBe(true);
  expect(auth.status().chatAuthorized).toBe(false);
  expect(auth.getChatSession()).toBeUndefined();
});
it('redirects alternate loopback hosts before establishing an OAuth cookie', async () => {
  const auth = new TwitchAuth(config, memoryStore(), vi.fn());
  const app = await createApp(config, auth);
  try {
    const response = await app.inject({ url: '/auth/login', headers: { host: '127.0.0.1:3000' } });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://localhost:3000/auth/login');
    expect(response.cookies).toHaveLength(0);
  } finally { await app.close(); }
});
it('keeps simultaneous browser login attempts independent', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/token') ? json(token) : json(identity));
  const app = await createApp(config, new TwitchAuth(config, memoryStore(), request));
  const host = { host: 'localhost:3000' };
  try {
    const first = await app.inject({ url: '/auth/login', headers: host });
    const second = await app.inject({ url: '/auth/login', headers: host });
    const cookies = [...first.cookies, ...second.cookies];
    expect(cookies[0]?.name).not.toBe(cookies[1]?.name);
    const cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    for (const start of [first, second]) {
      const state = new URL(start.headers.location!).searchParams.get('state');
      const response = await app.inject({ url: `/auth/callback?code=code&state=${state}`, headers: { ...host, cookie } });
      expect(response.statusCode).toBe(302);
    }
  } finally { await app.close(); }
});
it('distinguishes missing cookies from attempts invalidated by a restart', async () => {
  const request = vi.fn<typeof fetch>();
  const first = await createApp(config, new TwitchAuth(config, memoryStore(), request));
  const second = await createApp(config, new TwitchAuth(config, memoryStore(), request));
  const host = { host: 'localhost:3000' };
  try {
    const begin = await first.inject({ url: '/auth/login', headers: host });
    const state = new URL(begin.headers.location!).searchParams.get('state');
    const url = `/auth/callback?code=code&state=${state}`;
    const missing = await second.inject({ url, headers: host });
    expect(missing.json().error).toContain('cookie is missing');
    const restarted = await second.inject({ url, headers: { ...host, cookie: begin.cookies.map(c => `${c.name}=${c.value}`).join('; ') } });
    expect(restarted.json().error).toContain('server restarted');
    expect(restarted.json().restartUrl).toBe('http://localhost:3000/auth/login');
    expect(request).not.toHaveBeenCalled();
  } finally { await first.close(); await second.close(); }
});
