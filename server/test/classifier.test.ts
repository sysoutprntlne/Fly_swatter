import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Classifier, rulesClassify, type AiClient } from '../src/pipeline/classifier.js';
import { prefilter } from '../src/pipeline/prefilter.js';
import type { AiStatus, ChatMessage, Flagged } from '../src/types.js';
let n = 0;
const msg = (text: string): ChatMessage => ({ id: `m${++n}`, userId: `u${n}`, userLogin: 'u', userName: 'U', text, timestamp: 0, isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, source: 'twitch' });
const item = (text: string) => { const message = msg(text); return { message, prefilter: prefilter(message, 0.35) }; };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
function setup(ai?: AiClient, maxCallsPerMinute = 30) {
  const results: Flagged[] = []; const statuses: AiStatus[] = [];
  const classifier = new Classifier({ ai, maxCallsPerMinute, timeoutMs: 8000, streamer: () => 'streamer', context: () => [], onResult: f => results.push(f), onStatus: s => statuses.push(s),
    timers: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) } });
  return { classifier, results, statuses };
}
const echoAi = (category = 'location_guess'): AiClient & { classify: ReturnType<typeof vi.fn> } => ({
  classify: vi.fn(async (request: { candidates: { id: string }[] }) => ({ items: request.candidates.map(c => ({ messageId: c.id, category, confidence: 0.9, severity: 2, place: { rawText: 'Maple Ave', canonical: 'maple avenue', granularity: 'street' }, rationale: 'guess' })) })),
});

describe('rules fallback', () => {
  it.each([
    ['17 Gullhaven Rd', 'location_share', 3], ['swat time lol', 'swat_or_threat', 3], ['omw', 'approach_intent', 2],
    ['yeah thats maple ave', 'location_confirmation', 2], ['is that the CVS on Maple Ave?', 'location_guess', 2], ['what city is that', 'location_question', 1],
  ])('%s → %s', (text, category, severity) => {
    const { message, prefilter: p } = item(text);
    expect(rulesClassify(message, p)).toMatchObject({ category, severity, source: 'rules_fallback' });
  });
});
describe('rules fallback QA regressions', () => {
  it.each(['yeah that\'s funny', 'yeah thats true'])('a placeless "%s" is not a confirmation', text => {
    const { message, prefilter: p } = item(text);
    expect(rulesClassify(message, p).category).toBe('benign');
  });
  it.each([['yeah that\'s it', 'location_confirmation'], ['yes!! that\'s Quillon Park', 'location_confirmation'], ['100% maple ave', 'location_confirmation'], ['is that Brightwater Mall\'s north entrance?', 'location_guess'], ['is that downtown? where exactly', 'location_question']])('%s → %s', (text, category) => {
    const { message, prefilter: p } = item(text);
    expect(rulesClassify(message, p).category).toBe(category);
  });
  it('rules-only mode classifies immediately instead of waiting for a batch', async () => {
    const { classifier, results } = setup();
    classifier.enqueue(item('what city is that'));
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(1);
  });
});
describe('classifier batching and AI', () => {
  it('clears cached practice classifications on reset', async () => {
    const ai = echoAi(); const { classifier, results } = setup(ai);
    classifier.enqueue(item('is that the CVS on Maple Ave?'));
    await vi.advanceTimersByTimeAsync(2000);
    classifier.reset();
    classifier.enqueue(item('is that the CVS on Maple Ave?'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(ai.classify).toHaveBeenCalledTimes(2); expect(results).toHaveLength(2);
  });
  it.each(['resolve', 'reject'] as const)('ignores an AI request that completes after reset (%s)', async outcome => {
    const ai = echoAi(); const { classifier, results, statuses } = setup(ai);
    let finish!: () => void;
    ai.classify.mockImplementationOnce((request: { candidates: { id: string }[] }) => new Promise((resolve, reject) => {
      finish = () => outcome === 'reject' ? reject(new Error('old failure')) : resolve({ items: request.candidates.map(c => ({ messageId: c.id, category: 'location_guess', confidence: 0.9, severity: 2, place: null, rationale: 'old result' })) });
    }));
    classifier.enqueue(item('is that the CVS on Maple Ave?'));
    await vi.advanceTimersByTimeAsync(2000);
    classifier.reset(); finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(0); expect(statuses).toHaveLength(0);
    classifier.enqueue(item('is that the CVS on Maple Ave?'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(ai.classify).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });
  it('works with no AI at all', async () => {
    const { classifier, results } = setup();
    classifier.enqueue(item('what city is that'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(results[0]!.classification).toMatchObject({ category: 'location_question', source: 'rules_fallback' });
  });
  it('batches every 2 s or at 10 messages, and sends address/threat hits immediately', async () => {
    const ai = echoAi(); const { classifier, results } = setup(ai);
    classifier.enqueue(item('is that the CVS on Maple Ave?'));
    await vi.advanceTimersByTimeAsync(1999); expect(ai.classify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(ai.classify).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) classifier.enqueue(item(`where r u ${i}`));
    await vi.advanceTimersByTimeAsync(0); expect(ai.classify).toHaveBeenCalledTimes(2);
    classifier.enqueue(item('17 Gullhaven Rd'));
    await vi.advanceTimersByTimeAsync(0); expect(ai.classify).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(12); expect(results.every(r => r.classification.source === 'ai')).toBe(true);
  });
  it('falls back to rules when the AI fails or returns invalid items, then retries after 60 s', async () => {
    const ai = echoAi(); const { classifier, results, statuses } = setup(ai);
    ai.classify.mockRejectedValueOnce(new Error('timeout'));
    classifier.enqueue(item('what city is that'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(results[0]!.classification.source).toBe('rules_fallback');
    expect(statuses.at(-1)).toMatchObject({ healthy: false });
    classifier.enqueue(item('where r u')); await vi.advanceTimersByTimeAsync(2000);
    expect(ai.classify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    ai.classify.mockResolvedValueOnce({ items: [{ messageId: 'wrong', category: 'nonsense' }] });
    classifier.enqueue(item('which street is this')); await vi.advanceTimersByTimeAsync(2000);
    expect(ai.classify).toHaveBeenCalledTimes(2);
    expect(results.at(-1)!.classification.source).toBe('rules_fallback');
  });
  it('enforces the per-minute AI budget', async () => {
    const ai = echoAi(); const { classifier, statuses } = setup(ai, 2);
    for (let i = 0; i < 3; i++) { classifier.enqueue(item(`where r u ${i}`)); await vi.advanceTimersByTimeAsync(2000); }
    expect(ai.classify).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toMatchObject({ budgetReached: true });
  });
  it('caches identical text but never caches context-dependent confirmations', async () => {
    const ai = echoAi(); const { classifier, results } = setup(ai);
    classifier.enqueue(item('is that the CVS on Maple Ave?')); await vi.advanceTimersByTimeAsync(2000);
    classifier.enqueue(item('IS THAT THE CVS ON MAPLE AVE?')); await vi.advanceTimersByTimeAsync(2000);
    expect(ai.classify).toHaveBeenCalledTimes(1);
    expect(results[1]!.classification.messageId).toBe(results[1]!.message.id);
    const confirm = echoAi('location_confirmation'); const second = setup(confirm);
    second.classifier.enqueue(item('yeah thats it')); await vi.advanceTimersByTimeAsync(2000);
    second.classifier.enqueue(item('yeah thats it')); await vi.advanceTimersByTimeAsync(2000);
    expect(confirm.classify).toHaveBeenCalledTimes(2);
  });
  it('never sends secrets: the AI request holds only chat text, usernames and the streamer name', async () => {
    const ai = echoAi(); const { classifier } = setup(ai);
    classifier.enqueue(item('what city is that')); await vi.advanceTimersByTimeAsync(2000);
    expect(Object.keys(ai.classify.mock.calls[0]![0])).toEqual(['streamer', 'candidates', 'context']);
  });
});
