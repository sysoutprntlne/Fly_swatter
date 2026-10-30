import { describe, expect, it } from 'vitest';
import { deobfuscate, extractPlace, normalize, prefilter, scoreText } from '../src/pipeline/prefilter.js';
import type { ChatMessage } from '../src/types.js';
const msg = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'm1', userId: 'u1', userLogin: 'u', userName: 'U', text, timestamp: 0, isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, source: 'demo', ...extra });
const rulesOf = (text: string) => scoreText(text).matchedRules;

describe('prefilter rule groups', () => {
  it.each([
    ['where r u', 'location_question'], ['what city is that??', 'location_question'], ['which mall is this', 'location_question'],
    ['is that the CVS on Maple Ave?', 'guess_phrasing'], ['are you near the pier', 'guess_phrasing'], ['I think that\'s Maple Avenue', 'guess_phrasing_weak'], ['pretty sure that\'s Lindell Square', 'guess_phrasing_weak'],
    ['yeah thats it', 'confirmation_phrasing'], ['100% maple', 'confirmation_weak'], ['yes!! that\'s it', 'confirmation_phrasing'], ['i know that place', 'confirmation_phrasing'],
    ['the plaza looks nice', 'place_noun'], ['grabbing a coffee at starbucks', 'chain_name'],
    ['17 Gullhaven Rd', 'address_or_coordinates'], ['40.7128, -74.0060', 'address_or_coordinates'], ['maps.app.goo.gl/abc', 'address_or_coordinates'], ['zip 90210', 'address_or_coordinates'], ['Austin, TX 78701', 'state_zip'], ['apple.co/xyz', 'address_or_coordinates'], ['go north on Maple Ave, second left, red door', 'address_or_coordinates'],
    ['im outside', 'approach_intent'], ['omw', 'approach_intent'], ['10 min away', 'approach_intent'], ['turn around', 'approach_intent'],
    ['im gonna swat you', 'threat'], ['gonna get you swatted', 'threat'], ['swat time lol', 'threat'], ['i know where you live', 'threat'], ['calling the cops on you', 'threat'],
    ['wow we went past Brightwater Mall today', 'proper_noun'],
  ])('%s → %s', (text, rule) => { expect(rulesOf(text)).toContain(rule); });
  it('combines weights as 1 − ∏(1 − w) and caps at 1', () => {
    const { score } = scoreText('is that the CVS on Maple Ave?');
    expect(score).toBeCloseTo(1 - (1 - 0.45) * (1 - 0.3) * (1 - 0.25) * (1 - 0.15), 2);
    expect(scoreText('17 Main St omw i know where you live').score).toBeLessThanOrEqual(1);
  });
  it('does not flag ordinary chat or "Fly Swatter" itself', () => {
    for (const text of ['this walk is so chill', 'love the vibes', 'Protected by Fly Swatter', 'hi from Texas!!', '10000 viewers lets go', 'GG']) expect(scoreText(text).score).toBeLessThan(0.35);
  });
  // QA regressions (2026-10-30): each of these was a candidate, several would have been deleted in Assist.
  it.each(['69420', '11111 lets gooo', 'check apple.com for the deal', 'looks like fun', 'looks like rain lol', '100% agree', 'i see you got a new cam', 'im here for the vibes', 'pull up the map in the game', 'SWAT 4 was a great game', 'zip it lol', 'im close to beating this boss'])('is not a candidate: %s', text => {
    expect(scoreText(text).score).toBeLessThan(0.35);
  });
});
describe('normalization and obfuscation', () => {
  it('lowercases, strips zero-width characters and collapses repeated letters', () => {
    expect(normalize(`MAIN${String.fromCodePoint(0x200b)} STTTT`)).toBe('main st');
  });
  it('joins spaced letters and undoes leetspeak inside words only', () => {
    expect(deobfuscate('m a i n s t')).toBe('main st');
    expect(deobfuscate('m4ple 4ve')).toBe('maple ave');
    expect(deobfuscate('4th street 100%')).toBe('4th street 100%');
  });
  it('catches obfuscated location text', () => {
    expect(rulesOf('is th1s the m a p l e a v e')).toEqual(expect.arrayContaining(['guess_phrasing', 'place_noun']));
    expect(rulesOf('wh3re r u')).toContain('location_question');
  });
});
describe('candidate threshold and deletability', () => {
  it('flags candidates at or above the threshold', () => {
    expect(prefilter(msg('what city is that'), 0.35).candidate).toBe(true);
    expect(prefilter(msg('the park is pretty'), 0.35).candidate).toBe(false);
    expect(prefilter(msg('the park is pretty'), 0.2).candidate).toBe(true);
  });
  it('scores broadcaster and moderator messages but marks them non-deletable', () => {
    const own = prefilter(msg('we are at 17 Gullhaven Rd', { isBroadcaster: true }), 0.35);
    expect(own).toMatchObject({ candidate: true, deletable: false, immediate: true });
    expect(prefilter(msg('where r u', { isModerator: true }), 0.35).deletable).toBe(false);
  });
});
describe('place extraction for the rules fallback', () => {
  it.each([
    ['is that the CVS on Maple Ave?', 'maple ave', 'street'], ['yeah thats maple ave 100%', 'maple ave', 'street'],
    ["that's Brightwater Mall, I see the fountain", 'brightwater mall', 'venue'], ['17 Gullhaven Rd near the mall right?', '17 gullhaven rd', 'exact'],
    ['omw to maple ave', 'maple ave', 'street'], ['is that the cvs?', 'cvs', 'venue'],
  ])('%s → %s', (text, canonical, granularity) => { expect(extractPlace(text)).toMatchObject({ canonical, granularity }); });
  it('does not invent places from question words', () => {
    expect(extractPlace('what mall is this')).toBeUndefined();
    expect(extractPlace('which street is this?')).toBeUndefined();
  });
});
