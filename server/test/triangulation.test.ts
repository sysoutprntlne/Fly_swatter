import { describe, expect, it } from 'vitest';
import { Triangulation } from '../src/pipeline/triangulation.js';
import type { Category, Flagged, Granularity } from '../src/types.js';
let clock = 0; let n = 0;
const tracker = () => { clock = 1_000_000; return new Triangulation({ windowMs: 300_000, swarmMinUsers: 3, swarmMinScore: 3, now: () => clock }); };
function flag(user: string, category: Category, place?: string, opts: { confidence?: number; granularity?: Granularity; replyTo?: string; mod?: boolean } = {}): Flagged {
  const id = `m${++n}`;
  return {
    message: { id, userId: user, userLogin: user, userName: user, text: `${category} ${place ?? ''}`, timestamp: clock, isBroadcaster: false, isModerator: Boolean(opts.mod), isVip: false, isSubscriber: false, source: 'demo', ...(opts.replyTo ? { replyToMessageId: opts.replyTo } : {}) },
    prefilter: { messageId: id, score: 0.8, matchedRules: [], candidate: true, deletable: true, immediate: false },
    classification: { messageId: id, category, confidence: opts.confidence ?? 0.9, severity: 2, ...(place ? { place: { rawText: place, canonical: place, granularity: opts.granularity ?? 'street' } } : {}), rationale: '', source: 'ai' },
  };
}
describe('triangulation', () => {
  it('one user spamming the same guess never forms a swarm', () => {
    const t = tracker();
    for (let i = 0; i < 20; i++) { t.add(flag('spammer', 'location_guess', 'maple ave')); clock += 1000; }
    const [cluster] = t.snapshot();
    expect(cluster).toMatchObject({ distinctUsers: 1, isSwarm: false });
    expect(cluster!.score).toBeCloseTo(0.9);
  });
  it('three users converging forms a swarm exactly once', () => {
    const t = tracker();
    expect(t.add(flag('a', 'location_guess', 'Maple Ave')).becameSwarm).toBe(false);
    expect(t.add(flag('b', 'location_guess', 'maple avenue')).becameSwarm).toBe(false);
    const third = t.add(flag('c', 'location_share', 'maple ave', { granularity: 'exact' }));
    expect(third.becameSwarm).toBe(true);
    expect(third.cluster).toMatchObject({ distinctUsers: 3, isSwarm: true });
    expect(third.cluster!.score).toBeCloseTo((0.9 + 0.9 + 2.0 * 1.5 * 0.9) * 1.5, 1);
    expect(t.add(flag('d', 'location_guess', 'maple ave')).becameSwarm).toBe(false);
  });
  it('keeps different places in separate clusters', () => {
    const t = tracker();
    t.add(flag('a', 'location_guess', 'maple ave')); t.add(flag('b', 'location_guess', 'brightwater mall', { granularity: 'venue' })); t.add(flag('c', 'location_guess', 'oak street'));
    expect(t.snapshot()).toHaveLength(3);
  });
  it('drops mentions outside the window and removes empty clusters', () => {
    const t = tracker();
    t.add(flag('a', 'location_guess', 'maple ave')); clock += 200_000;
    t.add(flag('b', 'location_guess', 'maple ave')); clock += 150_000;
    expect(t.snapshot()[0]!.distinctUsers).toBe(1);
    clock += 200_000;
    expect(t.snapshot()).toHaveLength(0);
  });
  it('adds a +0.5 bonus when a confirmation follows a guess, including placeless replies', () => {
    const t = tracker();
    const guess = flag('a', 'location_guess', 'maple ave');
    t.add(guess); clock += 5000;
    const result = t.add(flag('b', 'location_confirmation', undefined, { replyTo: guess.message.id }));
    expect(result.cluster!.distinctUsers).toBe(2);
    expect(result.cluster!.score).toBeCloseTo((0.9 + 1.3 * 0.9) * 1.25 + 0.5, 1);
  });
  it('ignores moderators, placeless questions and benign messages; tracks question pressure', () => {
    const t = tracker();
    t.add(flag('mod', 'location_guess', 'maple ave', { mod: true }));
    t.add(flag('q1', 'location_question')); t.add(flag('q2', 'location_question')); t.add(flag('q2', 'location_question'));
    t.add(flag('x', 'benign', 'maple ave'));
    expect(t.snapshot()).toHaveLength(0);
    expect(t.questionPressure()).toBe(2);
    clock += 121_000;
    expect(t.questionPressure()).toBe(0);
  });
});
