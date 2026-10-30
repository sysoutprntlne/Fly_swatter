import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bus } from '../src/bus.js';
import { parseConfig } from '../src/config.js';
import { Simulator, loadScenarios } from '../src/demo/simulator.js';
import { Pipeline } from '../src/pipeline/index.js';
import type { ActionRecord, ChatMessage, RiskLevel } from '../src/types.js';

// Full pipeline over the bundled demo scenarios, rules only (no OpenAI, no Twitch).
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });
async function run(name: string, mode: 'observe' | 'assist' = 'observe') {
  const bus = new Bus();
  const config = { ...parseConfig({ LOG_LEVEL: 'silent' }), DEFAULT_MODE: mode };
  const timers = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const simulator = new Simulator(bus, loadScenarios(), true, timers);
  const sent: string[] = [];
  const moderation = { deleteMessage: vi.fn(async () => {}), sendChat: vi.fn(async (m: string) => { sent.push(m); }), warnUser: vi.fn(async () => {}), setShieldMode: vi.fn(async () => {}) };
  const pipeline = new Pipeline({ bus, config, moderation, isDemo: () => true, streamer: () => 'tester', accountAgeDays: id => simulator.accountAgeDays(id), now: () => Date.now() });
  const levels: RiskLevel[] = []; const actions: ActionRecord[] = []; const messages: ChatMessage[] = [];
  bus.on('risk.level_changed', ({ to }) => levels.push(to)); bus.on('action.taken', a => actions.push(a)); bus.on('chat.message', m => messages.push(m));
  pipeline.start();
  simulator.play(name, 1);
  await vi.advanceTimersByTimeAsync(40_000);
  const snapshot = pipeline.snapshot();
  pipeline.stop(); simulator.stop();
  return { levels, actions, snapshot, moderation, sent, messages };
}
describe('demo scenarios through the full pipeline (rules fallback)', () => {
  it('IRL triangulation reaches Swarm Incoming and swats the converging guesses', async () => {
    const r = await run('IRL triangulation');
    expect(r.levels).toContain('swarm');
    expect(r.snapshot.clusters[0]).toMatchObject({ isSwarm: true });
    expect(r.actions.some(a => a.kind === 'delete_message')).toBe(true);
    expect(r.actions.every(a => a.dryRun || a.kind === 'private_alert')).toBe(true);
    expect(r.moderation.deleteMessage).not.toHaveBeenCalled();
    // QA regression: one swarm alert, not one from the level change plus one from the cluster.
    expect(r.actions.filter(a => a.kind === 'mod_alert' && a.reason.toLowerCase().includes('swarm'))).toHaveLength(1);
  });
  it('false-positive check stays Quiet or A Few Flies', async () => {
    const r = await run('False positive check');
    expect(r.levels.every(l => l === 'quiet' || l === 'few_flies')).toBe(true);
    expect(r.snapshot.clusters.filter(c => c.isSwarm)).toHaveLength(0);
  });
  it('raid swarm reaches Swarm Incoming', async () => {
    const r = await run('Raid swarm');
    expect(r.levels).toContain('swarm');
  });
});
