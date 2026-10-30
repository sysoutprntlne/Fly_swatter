import { describe, expect, it } from 'vitest';
import { RiskEngine, combine, levelFor } from '../src/pipeline/riskEngine.js';
import type { Category, Flagged } from '../src/types.js';
let clock = 0;
const engine = () => { clock = 1_000_000; return new RiskEngine(() => clock); };
const flagged = (category: Category, severity: 0 | 1 | 2 | 3, confidence = 1): Flagged => ({
  message: { id: 'm', userId: 'u', userLogin: 'u', userName: 'u', text: '', timestamp: 0, isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, source: 'demo' },
  prefilter: { messageId: 'm', score: 1, matchedRules: [], candidate: true, deletable: true, immediate: false },
  classification: { messageId: 'm', category, severity, confidence, rationale: '', source: 'ai' },
});
describe('risk engine', () => {
  it('maps scores to levels at 25/50/75', () => {
    expect([0, 24.9, 25, 49.9, 50, 74.9, 75, 100].map(levelFor)).toEqual(['quiet', 'quiet', 'few_flies', 'few_flies', 'buzzing', 'buzzing', 'swarm', 'swarm']);
  });
  it('lets one signal dominate and stacks the others', () => {
    expect(combine({ chat: 50, triangulation: 0, exposure: 0, raid: 0 }, false)).toBe(35);
    expect(combine({ chat: 50, triangulation: 40, exposure: 20, raid: 20 }, false)).toBe(35 + 9 + 10);
  });
  it('increments chat by severity × 8 × confidence and decays with a 90 s half-life', () => {
    const r = engine();
    r.onClassification(flagged('location_guess', 2, 0.5), { questionPressure: 0 });
    expect(r.state().components.chat).toBe(8);
    clock += 90_000; expect(r.state().components.chat).toBe(4);
  });
  it('weights young accounts and adds question pressure', () => {
    const r = engine();
    r.onClassification(flagged('location_guess', 2, 1), { accountAgeDays: 1, questionPressure: 0 });
    expect(r.state().components.chat).toBeCloseTo(20.8, 1);
    r.onClassification(flagged('location_question', 1, 1), { questionPressure: 3 });
    expect(r.state().components.chat).toBeCloseTo(20.8 + 8 + 20, 1);
  });
  it('a swarm forces at least Swarm Incoming; a severe threat at least Buzzing', () => {
    const r = engine();
    r.setTriangulation(1, true, 0);
    expect(r.state()).toMatchObject({ level: 'swarm' });
    expect(r.state().score).toBeGreaterThanOrEqual(75);
    const t = engine();
    t.onClassification(flagged('swat_or_threat', 3, 0.1), { questionPressure: 0 });
    expect(t.state().components.chat).toBe(70);
    expect(t.state().level).toBe('buzzing');
  });
  it('rises immediately but only falls after 20 s below the threshold', () => {
    const r = engine();
    r.setTriangulation(1, true, 0);
    expect(r.state().level).toBe('swarm');
    r.setTriangulation(0, false, 0);
    clock += 19_000; expect(r.state().level).toBe('swarm');
    clock += 1_000; expect(r.state().level).toBe('quiet');
  });
  it('raids add a decaying component and boost young accounts by 1.5×', () => {
    const r = engine();
    r.onRaid(150);
    expect(r.state().components.raid).toBe(25);
    r.onClassification(flagged('location_guess', 2, 1), { accountAgeDays: 0, questionPressure: 0 });
    expect(r.state().components.chat).toBeCloseTo(16 * 1.3 * 1.5, 1);
    clock += 300_000; expect(r.state().components.raid).toBe(12.5);
  });
});
