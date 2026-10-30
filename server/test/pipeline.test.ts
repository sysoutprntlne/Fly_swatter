import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Bus } from '../src/bus.js';
import { parseConfig } from '../src/config.js';
import { Pipeline } from '../src/pipeline/index.js';
import type { ChatMessage, PlaceCluster } from '../src/types.js';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });
const msg = (id: string, text: string, source: 'twitch' | 'demo' = 'twitch'): ChatMessage => ({ id, userId: id, userLogin: id, userName: id, text, timestamp: Date.now(), isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, source });
function setup(isDemo = false) {
  const bus = new Bus();
  const moderation = { deleteMessage: vi.fn(async () => {}), sendChat: vi.fn(async () => {}), warnUser: vi.fn(async () => {}), setShieldMode: vi.fn(async () => {}) };
  const pipeline = new Pipeline({ bus, config: parseConfig({ LOG_LEVEL: 'silent' }), moderation, isDemo: () => isDemo, streamer: () => 's', accountAgeDays: () => undefined, now: () => Date.now() });
  pipeline.start();
  return { bus, pipeline };
}
it('pushes cluster expiry to the dashboard when mentions age out (QA regression)', async () => {
  const { bus, pipeline } = setup();
  const updates: PlaceCluster[][] = []; bus.on('cluster.updated', c => updates.push(c));
  bus.emit('chat.message', msg('a', 'is that the CVS on Maple Ave?'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(updates.at(-1)).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(301_000);
  expect(updates.at(-1)).toHaveLength(0);
  pipeline.stop();
});
it('analyses only the active source: live chat is ignored during demo and vice versa', async () => {
  const live = setup(false), demo = setup(true);
  for (const s of [live, demo]) { s.bus.emit('chat.message', msg('d1', 'is that the CVS on Maple Ave?', 'demo')); s.bus.emit('chat.message', msg('t1', 'what city is that', 'twitch')); }
  await vi.advanceTimersByTimeAsync(1000);
  expect(live.pipeline.snapshot().flagged.map(f => f.message.id)).toEqual(['t1']);
  expect(demo.pipeline.snapshot().flagged.map(f => f.message.id)).toEqual(['d1']);
  live.pipeline.stop(); demo.pipeline.stop();
});
it('survives a throwing bus consumer and malformed input', async () => {
  const { bus, pipeline } = setup();
  bus.on('classification', () => { throw new Error('consumer bug'); });
  bus.emit('chat.message', { ...msg('x', 'is that the CVS on Maple Ave?'), text: undefined as unknown as string });
  bus.emit('chat.message', msg('y', 'what city is that'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(pipeline.snapshot().risk.score).toBeGreaterThanOrEqual(0);
  pipeline.stop();
});
