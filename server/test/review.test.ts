import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Bus } from '../src/bus.js';
import { parseConfig } from '../src/config.js';
import { Pipeline } from '../src/pipeline/index.js';
import { createApp } from '../src/server/http.js';
import { EventSub } from '../src/twitch/eventsub.js';
import type { ChatMessage, Review } from '../src/types.js';

// Mods check the model's calls on a review board. Verdicts live in memory for the session only.
const msg = (id: string, text: string): ChatMessage => ({ id, userId: id, userLogin: id, userName: id, text, timestamp: Date.now(), isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, source: 'twitch' });
const moderation = () => ({ deleteMessage: vi.fn(async () => {}), sendChat: vi.fn(async () => {}), warnUser: vi.fn(async () => {}), setShieldMode: vi.fn(async () => {}) });
const closers: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); vi.useRealTimers(); });

function pipelineWithFlag() {
  const bus = new Bus();
  const pipeline = new Pipeline({ bus, config: parseConfig({ LOG_LEVEL: 'silent' }), moderation: moderation(), isDemo: () => false, streamer: () => 's', accountAgeDays: () => undefined, now: () => Date.now() });
  closers.push(() => pipeline.stop());
  return { bus, pipeline };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T12:00:00Z')); });

it('records, replaces and clears a verdict on a flagged message, and announces each change', async () => {
  const { bus, pipeline } = pipelineWithFlag();
  const events: { messageId: string; review: Review | null }[] = []; bus.on('review', e => events.push(e));
  bus.emit('chat.message', msg('a', 'is that the CVS on Maple Ave?'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(pipeline.review('a', 'right')).toBe(true);
  expect(pipeline.snapshot().reviews).toEqual([{ messageId: 'a', verdict: 'right', at: Date.now() }]);
  expect(pipeline.review('a', 'wrong', 'benign')).toBe(true);
  expect(pipeline.snapshot().reviews[0]).toMatchObject({ verdict: 'wrong', shouldBe: 'benign' });
  expect(pipeline.review('a', null)).toBe(true);
  expect(pipeline.snapshot().reviews).toEqual([]);
  expect(events.map(e => e.review?.verdict ?? null)).toEqual(['right', 'wrong', null]);
});

it('only accepts verdicts on messages the model flagged, and drops them on reset', async () => {
  const { pipeline, bus } = pipelineWithFlag();
  expect(pipeline.review('never-seen', 'right')).toBe(false);
  bus.emit('chat.message', msg('a', 'is that the CVS on Maple Ave?'));
  await vi.advanceTimersByTimeAsync(1000);
  pipeline.review('a', 'right', 'benign');
  expect(pipeline.snapshot().reviews[0]).not.toHaveProperty('shouldBe');   // "should be" only goes with a wrong call
  pipeline.reset();
  expect(pipeline.snapshot().reviews).toEqual([]);
});

it('the review route needs the session cookie, validates input and 404s on unknown messages', async () => {
  vi.useRealTimers();
  const bus = new Bus();
  const receiver = new EventSub({ bus, getSession: () => undefined, subscribe: async () => {} });
  const pipeline = new Pipeline({ bus, config: parseConfig({ LOG_LEVEL: 'silent' }), moderation: moderation(), isDemo: () => false, streamer: () => 's', accountAgeDays: () => undefined });
  const app = await createApp(parseConfig({ LOG_LEVEL: 'silent' }), undefined, { bus, receiver, pipeline });
  closers.push(async () => { pipeline.stop(); await app.close(); });
  const cookie = String((await app.inject({ url: '/api/session', headers: { host: 'localhost:3000' } })).headers['set-cookie']).split(';')[0]!;
  const post = (payload: object, headers: Record<string, string> = { cookie, origin: 'http://localhost:3000' }) =>
    app.inject({ method: 'POST', url: '/api/review', payload, headers: { host: 'localhost:3000', ...headers } });
  expect((await post({ messageId: 'a', verdict: 'right' }, { origin: 'http://localhost:3000' })).statusCode).toBe(403);
  expect((await post({ messageId: 'a', verdict: 'maybe' })).statusCode).toBe(400);
  expect((await post({ messageId: 'a', verdict: 'wrong', shouldBe: 'not_a_category' })).statusCode).toBe(400);
  expect((await post({ messageId: 'a', verdict: 'right' })).statusCode).toBe(404);
  bus.emit('chat.message', msg('a', 'is that the CVS on Maple Ave?'));
  await new Promise(resolve => setTimeout(resolve, 50));
  await pipeline.flush();
  expect((await post({ messageId: 'a', verdict: 'wrong', shouldBe: 'location_question' })).statusCode).toBe(200);
  const state = (await app.inject({ url: '/api/state', headers: { host: 'localhost:3000' } })).json();
  expect(state.pipeline.reviews[0]).toMatchObject({ messageId: 'a', verdict: 'wrong', shouldBe: 'location_question' });
});
