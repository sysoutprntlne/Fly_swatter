import { describe, expect, it, vi } from 'vitest';
import { ActionEngine } from '../src/pipeline/actionEngine.js';
import { copy } from '../src/copy.js';
import type { ActionRecord, Category, Flagged, Mode, PlaceCluster } from '../src/types.js';
let clock = 0; let n = 0;
function setup(mode: Mode) {
  clock = 1_000_000;
  const api = { deleteMessage: vi.fn<(id: string) => Promise<void>>(async () => {}), sendChat: vi.fn<(text: string) => Promise<void>>(async () => {}), warnUser: vi.fn<(user: string, reason: string) => Promise<void>>(async () => {}), setShieldMode: vi.fn<(active: boolean) => Promise<void>>(async () => {}) };
  const records: ActionRecord[] = [];
  return { api, records, engine: new ActionEngine(api, () => clock, r => records.push(r), mode) };
}
function flag(category: Category, opts: { confidence?: number; severity?: 0 | 1 | 2 | 3; user?: string; broadcaster?: boolean; mod?: boolean; demo?: boolean; place?: string } = {}): Flagged {
  const id = `msg-${++n}`;
  const privileged = Boolean(opts.broadcaster || opts.mod);
  return {
    message: { id, userId: opts.user ?? `user-${n}`, userLogin: 'x', userName: 'x', text: 'is that maple ave', timestamp: clock, isBroadcaster: Boolean(opts.broadcaster), isModerator: Boolean(opts.mod), isVip: false, isSubscriber: false, source: opts.demo ? 'demo' : 'twitch' },
    prefilter: { messageId: id, score: 0.9, matchedRules: [], candidate: true, deletable: !privileged, immediate: false },
    classification: { messageId: id, category, confidence: opts.confidence ?? 0.9, severity: opts.severity ?? 2, ...(opts.place ? { place: { rawText: opts.place, canonical: opts.place, granularity: 'street' as const } } : {}), rationale: '', source: 'ai' },
  };
}
const cluster = (ids: string[], canonical = 'maple avenue'): PlaceCluster => ({ id: 'c1', canonical, granularity: 'street', mentions: ids.map(id => ({ messageId: id, userId: id, userLogin: id, excerpt: '', category: 'location_guess', confidence: 0.4, weight: 0.4, at: clock })), distinctUsers: ids.length, score: 4, firstSeen: clock, lastSeen: clock, isSwarm: true });

describe('action engine', () => {
  it('Observe mode only records dry runs', async () => {
    const { api, records, engine } = setup('observe');
    await engine.onFlagged(flag('location_share', { severity: 3 }), 'quiet');
    await engine.onLevelChange('few_flies', 'buzzing', false);
    expect(api.deleteMessage).not.toHaveBeenCalled(); expect(api.sendChat).not.toHaveBeenCalled();
    expect(records.map(r => [r.kind, r.dryRun])).toEqual([['delete_message', true], ['mod_alert', true]]);
  });
  it('Assist deletes shares and confident guesses, but not low-confidence guesses or benign messages', async () => {
    const { api, engine } = setup('assist');
    const share = flag('location_share', { confidence: 0.6, severity: 3 }); const sure = flag('location_guess', { confidence: 0.7 });
    await engine.onFlagged(share, 'quiet'); await engine.onFlagged(sure, 'quiet');
    await engine.onFlagged(flag('location_guess', { confidence: 0.4 }), 'quiet');
    await engine.onFlagged(flag('location_guess', { confidence: 0.9, severity: 1 }), 'quiet');
    await engine.onFlagged(flag('benign', { confidence: 1, severity: 3 }), 'swarm');
    await engine.onFlagged(flag('location_question'), 'swarm');
    expect(api.deleteMessage.mock.calls.map(c => c[0])).toEqual([share.message.id, sure.message.id]);
  });
  it('a swarm deletes every contributing message, once, and alerts mods once per cluster', async () => {
    const { api, engine } = setup('assist');
    const a = flag('location_guess', { confidence: 0.4 }), b = flag('location_guess', { confidence: 0.4 }), c = flag('location_confirmation', { confidence: 0.45 });
    for (const f of [a, b]) await engine.onFlagged(f, 'few_flies');
    const swarm = cluster([a, b, c].map(f => f.message.id));
    await engine.onFlagged(c, 'swarm', swarm);
    await engine.onSwarm(swarm, false); await engine.onSwarm(swarm, false);
    expect(api.deleteMessage.mock.calls.map(x => x[0]).sort()).toEqual([a, b, c].map(f => f.message.id).sort());
    expect(api.sendChat).toHaveBeenCalledTimes(1);
  });
  it('never deletes broadcaster or moderator messages; alerts the broadcaster privately', async () => {
    const { api, records, engine } = setup('guardian');
    await engine.onFlagged(flag('location_share', { broadcaster: true, severity: 3 }), 'swarm');
    await engine.onFlagged(flag('location_share', { mod: true, severity: 3 }), 'swarm');
    expect(api.deleteMessage).not.toHaveBeenCalled();
    expect(records).toEqual([expect.objectContaining({ kind: 'private_alert', dryRun: false, success: true })]);
  });
  it('demo messages are always dry runs, even in Guardian', async () => {
    const { api, records, engine } = setup('guardian');
    await engine.onFlagged(flag('location_share', { demo: true, severity: 3 }), 'swarm');
    await engine.onLevelChange('buzzing', 'swarm', true);
    expect(api.deleteMessage).not.toHaveBeenCalled(); expect(api.setShieldMode).not.toHaveBeenCalled(); expect(api.sendChat).not.toHaveBeenCalled();
    expect(records.every(r => r.dryRun)).toBe(true);
  });
  it('dedupes level alerts within 60 s', async () => {
    const { api, engine } = setup('assist');
    await engine.onLevelChange('few_flies', 'buzzing', false); await engine.onLevelChange('few_flies', 'buzzing', false);
    clock += 61_000; await engine.onLevelChange('few_flies', 'buzzing', false);
    expect(api.sendChat).toHaveBeenCalledTimes(2);
    await engine.onLevelChange('swarm', 'buzzing', false);
    expect(api.sendChat).toHaveBeenCalledTimes(2);
  });
  it('Guardian deletes questions while buzzing, warns repeat offenders and enables Shield Mode at swarm', async () => {
    const { api, engine } = setup('guardian');
    await engine.onFlagged(flag('location_question'), 'few_flies');
    expect(api.deleteMessage).not.toHaveBeenCalled();
    await engine.onFlagged(flag('location_question', { user: 'repeat' }), 'buzzing');
    await engine.onFlagged(flag('location_question', { user: 'repeat' }), 'buzzing');
    expect(api.deleteMessage).toHaveBeenCalledTimes(2);
    expect(api.warnUser).toHaveBeenCalledWith('repeat', copy.warningReason);
    await engine.onLevelChange('buzzing', 'swarm', false); await engine.onLevelChange('buzzing', 'swarm', false);
    expect(api.setShieldMode).toHaveBeenCalledTimes(1); expect(api.setShieldMode).toHaveBeenCalledWith(true);
    const assist = setup('assist');
    await assist.engine.onLevelChange('buzzing', 'swarm', false);
    expect(assist.api.setShieldMode).not.toHaveBeenCalled();
  });
  it('records failures without throwing', async () => {
    const { api, records, engine } = setup('assist');
    api.deleteMessage.mockRejectedValueOnce(new Error('Twitch DELETE /moderation/chat failed (HTTP 400)'));
    await engine.onFlagged(flag('location_share', { severity: 3 }), 'quiet');
    expect(records[0]).toMatchObject({ success: false, error: expect.stringContaining('HTTP 400') });
  });
  it('outgoing chat never contains the place text (rule §2.3)', async () => {
    const places = ['maple avenue', 'brightwater mall', '17 gullhaven road'];
    const { api, engine } = setup('guardian');
    for (const place of places) {
      const fs = [1, 2, 3].map(() => flag('location_guess', { place }));
      for (const f of fs) await engine.onFlagged(f, 'buzzing');
      await engine.onSwarm({ ...cluster(fs.map(f => f.message.id), place), id: place }, false);
    }
    await engine.onLevelChange('few_flies', 'buzzing', false); clock += 61_000; await engine.onLevelChange('buzzing', 'swarm', false);
    const outgoing = [...api.sendChat.mock.calls.map(c => c[0]), ...api.warnUser.mock.calls.map(c => c[1])];
    expect(outgoing.length).toBeGreaterThan(0);
    for (const text of [...outgoing, ...Object.values(copy)]) {
      expect(text.length).toBeLessThanOrEqual(300);
      for (const place of places) for (const word of place.split(' ')) expect(text.toLowerCase()).not.toContain(word);
    }
  });
});
