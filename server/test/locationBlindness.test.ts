import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bus } from '../src/bus.js';
import { parseConfig } from '../src/config.js';
import { Pipeline } from '../src/pipeline/index.js';
import { ActionEngine } from '../src/pipeline/actionEngine.js';
import type { ActionRecord, ChatMessage, Flagged } from '../src/types.js';

// AGENTS.md §2.9: Fly Swatter never knows the true location, so deleting a guess can never confirm it.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

const script = (place: string) => [
  ['lurker', 'what city is that??'], ['sniffer', `is that the CVS on ${place} Ave?`], ['newacc', `yeah thats ${place} ave 100%`],
  ['watcher', `I think that's ${place} Avenue by the bakery`], ['sleuth', `${place} ave and 4th, i know that place`], ['chill', 'love this walk'],
];
async function run(place: string, swatAllGuesses = false) {
  const bus = new Bus();
  const config = { ...parseConfig({ LOG_LEVEL: 'silent' }), DEFAULT_MODE: 'assist' as const, SWAT_ALL_GUESSES: swatAllGuesses };
  const moderation = { deleteMessage: vi.fn(async () => {}), sendChat: vi.fn(async () => {}), warnUser: vi.fn(async () => {}), setShieldMode: vi.fn(async () => {}) };
  const pipeline = new Pipeline({ bus, config, moderation, isDemo: () => false, streamer: () => 's', accountAgeDays: () => undefined, now: () => Date.now() });
  const actions: ActionRecord[] = []; bus.on('action.taken', a => actions.push(a));
  let n = 0;
  for (const [user, text] of script(place)) {
    const message: ChatMessage = { id: `m${++n}`, userId: user!, userLogin: user!, userName: user!, text: text!, timestamp: Date.now(), isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, source: 'twitch' };
    bus.emit('chat.message', message);
    await vi.advanceTimersByTimeAsync(1500);
  }
  await vi.advanceTimersByTimeAsync(3000);
  const snapshot = pipeline.snapshot(); pipeline.stop();
  return { actions: actions.map(a => `${a.kind}:${a.targetMessageId ?? ''}`), risk: snapshot.risk.score, chat: moderation.sendChat.mock.calls.flat() };
}

describe('location blindness', () => {
  it('has no configuration for a true location', () => {
    const config = parseConfig({ LOG_LEVEL: 'silent', STREAMER_LOCATION: 'Maple Ave', HOME_ADDRESS: '1 Main St', CURRENT_CITY: 'Gullhaven' }) as Record<string, unknown>;
    for (const key of Object.keys(config)) expect(key).not.toMatch(/LOCATION|ADDRESS|CITY|LATITUDE|LONGITUDE|COORD|HOME/);
  });
  it('the classifier prompt never asks for or supplies the true location', () => {
    const prompt = readFileSync(resolve(import.meta.dirname, '../src/prompts/classifier.system.md'), 'utf8');
    expect(prompt).toContain('Do not add any information about where the streamer actually is');
  });
  it('makes identical decisions whatever place chat names (deletions cannot confirm a guess)', async () => {
    const [maple, oak, made] = [await run('Maple'), await run('Oak'), await run('Zibblewick')];
    expect(maple.actions.length).toBeGreaterThan(0);
    expect(oak).toEqual(maple);
    expect(made).toEqual(maple);
  });
  it('swat-all-guesses deletes every guess, confirmation and share regardless of confidence', async () => {
    const records: ActionRecord[] = [];
    const engine = new ActionEngine({ deleteMessage: async () => {}, sendChat: async () => {}, warnUser: async () => {}, setShieldMode: async () => {} }, () => 0, r => records.push(r), 'assist', true);
    const flag = (id: string, category: Flagged['classification']['category'], confidence: number): Flagged => ({
      message: { id, userId: id, userLogin: id, userName: id, text: '', timestamp: 0, isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, source: 'twitch' },
      prefilter: { messageId: id, score: 0.5, matchedRules: [], candidate: true, deletable: true, immediate: false },
      classification: { messageId: id, category, confidence, severity: 1, rationale: '', source: 'rules_fallback' },
    });
    for (const [id, category] of [['g', 'location_guess'], ['c', 'location_confirmation'], ['s', 'location_share'], ['q', 'location_question'], ['b', 'benign']] as const) await engine.onFlagged(flag(id, category, 0.1), 'quiet');
    expect(records.map(r => r.targetMessageId)).toEqual(['g', 'c', 's']);
  });
});
