import { afterEach, expect, it } from 'vitest';
import { createApp } from '../src/server/http.js';
import { parseConfig } from '../src/config.js';
import { Bus } from '../src/bus.js';
import { EventSub } from '../src/twitch/eventsub.js';
import { Simulator, loadScenarios } from '../src/demo/simulator.js';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function build(enabled = true) {
  const bus = new Bus();
  const receiver = new EventSub({ bus, getSession: () => undefined, subscribe: async () => {} });
  const simulator = new Simulator(bus, loadScenarios(), enabled);
  const app = await createApp(parseConfig({ LOG_LEVEL: 'silent' }), undefined, { bus, receiver, simulator });
  closers.push(() => app.close());
  const session = await app.inject({ url: '/api/session', headers: { host: 'localhost:3000' } });
  const cookie = String(session.headers['set-cookie']).split(';')[0]!;
  const post = (url: string, payload: unknown, headers: Record<string, string> = { cookie, origin: 'http://localhost:3000' }) =>
    app.inject({ method: 'POST', url, payload: payload as object, headers: { host: 'localhost:3000', ...headers } });
  return { app, post, simulator };
}

it('requires the local session cookie and an allowed origin for demo controls', async () => {
  const { post } = await build();
  expect((await post('/api/demo/inject', { user: 'x', text: 'hi' }, { origin: 'http://localhost:3000' })).statusCode).toBe(403);
  expect((await post('/api/demo/inject', { user: 'x', text: 'hi' }, { origin: 'http://evil.test' })).statusCode).toBe(403);
});

it('lists scenarios, plays, injects and resets without Twitch', async () => {
  const { app, post } = await build();
  const list = (await app.inject({ url: '/api/demo/scenarios', headers: { host: 'localhost:3000' } })).json();
  expect(list.scenarios.map((s: { name: string }) => s.name)).toContain('IRL triangulation');
  expect((await post('/api/demo/play', { name: 'IRL triangulation', speed: 2 })).json()).toMatchObject({ playing: true, speed: 2, scenario: 'IRL triangulation' });
  expect((await post('/api/demo/inject', { user: 'live_guest', text: 'hello from the audience' })).statusCode).toBe(200);
  const state = (await app.inject({ url: '/api/state', headers: { host: 'localhost:3000' } })).json();
  expect(state.demo.enabled).toBe(true);
  expect(state.messages.some((m: { text: string; source: string }) => m.text === 'hello from the audience' && m.source === 'demo')).toBe(true);
  expect((await post('/api/demo/pause', {})).json().playing).toBe(false);
  expect((await post('/api/demo/reset', {})).json()).toMatchObject({ position: 0, playing: false });
});

it('rejects bad input and actions while demo mode is off', async () => {
  const { post } = await build(false);
  expect((await post('/api/demo/play', { name: 'IRL triangulation', speed: 3 })).statusCode).toBe(400);
  expect((await post('/api/demo/inject', { user: 'bad name!', text: 'hi' })).statusCode).toBe(400);
  expect((await post('/api/demo/play', { name: 'IRL triangulation', speed: 1 })).statusCode).toBe(409);
  expect((await post('/api/demo/mode', { enabled: true })).json().enabled).toBe(true);
  expect((await post('/api/demo/play', { name: 'IRL triangulation', speed: 1 })).statusCode).toBe(200);
});

it('reports a failed Shield Mode change as an error and validates mode/settings (QA regression)', async () => {
  const bus = new Bus();
  const receiver = new EventSub({ bus, getSession: () => undefined, subscribe: async () => {} });
  const simulator = new Simulator(bus, loadScenarios(), false);
  const { Pipeline } = await import('../src/pipeline/index.js');
  const failing = { deleteMessage: async () => {}, sendChat: async () => {}, warnUser: async () => {}, setShieldMode: async () => { throw new Error('Moderation permission not granted'); } };
  const pipeline = new Pipeline({ bus, config: parseConfig({ LOG_LEVEL: 'silent' }), moderation: failing, isDemo: () => false, streamer: () => 's', accountAgeDays: () => undefined });
  const app = await createApp(parseConfig({ LOG_LEVEL: 'silent' }), undefined, { bus, receiver, simulator, pipeline });
  closers.push(async () => { pipeline.stop(); await app.close(); });
  const cookie = String((await app.inject({ url: '/api/session', headers: { host: 'localhost:3000' } })).headers['set-cookie']).split(';')[0]!;
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, headers: { host: 'localhost:3000', cookie, origin: 'http://localhost:3000' } });
  const shield = await post('/api/shield', { active: true });
  expect(shield.statusCode).toBe(502); expect(shield.json().error).toContain('permission');
  expect((await post('/api/mode', { mode: 'chaos' })).statusCode).toBe(400);
  expect((await post('/api/mode', { mode: 'guardian' })).json().mode).toBe('guardian');
  expect((await post('/api/settings', { swatAllGuesses: true })).json()).toEqual({ swatAllGuesses: true });
  expect((await app.inject({ url: '/api/state', headers: { host: 'localhost:3000' } })).json().pipeline.settings.swatAllGuesses).toBe(true);
});
