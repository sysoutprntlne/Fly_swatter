import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bus } from '../src/bus.js';
import { Simulator, loadScenarios, type Scenario } from '../src/demo/simulator.js';
import type { ChatMessage, RaidEvent } from '../src/types.js';

// Deterministic clock: timers fire only when advance() passes their due time.
function fakeTimers() {
  let now = 1_000_000; let id = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => { pending.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: (handle: unknown) => { pending.delete(handle as number); },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end;
    },
  };
}
const scenario = (events: Scenario['events'], name = 'Test'): Map<string, Scenario & { file: string }> => new Map([[name, { name, events, file: 't.json' }]]);
const basic = scenario([
  { t: 0, type: 'chat', user: 'a', text: 'one' },
  { t: 1000, type: 'chat', user: 'b', text: 'two', accountAgeDays: 1 },
  { t: 3000, type: 'raid', fromUser: 'r', viewers: 50 },
  { t: 4000, type: 'chat', user: 'mod1', text: 'three', role: 'moderator' },
]);
function setup(enabled = true, scenarios = basic) {
  const bus = new Bus(); const timers = fakeTimers();
  const chat: ChatMessage[] = []; const raids: RaidEvent[] = [];
  bus.on('chat.message', m => chat.push(m)); bus.on('raid', r => raids.push(r));
  return { bus, timers, chat, raids, sim: new Simulator(bus, scenarios, enabled, timers) };
}

describe('demo simulator', () => {
  it('replays chat and raid events in time order as demo-sourced messages', () => {
    const { sim, timers, chat, raids } = setup();
    expect(sim.play('Test', 1)).toBe(true);
    timers.advance(0); expect(chat.map(m => m.text)).toEqual(['one']);
    timers.advance(999); expect(chat).toHaveLength(1);
    timers.advance(1); expect(chat.map(m => m.text)).toEqual(['one', 'two']);
    timers.advance(3000);
    expect(raids).toEqual([expect.objectContaining({ fromLogin: 'r', viewers: 50, source: 'demo' })]);
    expect(chat.map(m => m.text)).toEqual(['one', 'two', 'three']);
    expect(chat.every(m => m.source === 'demo' && m.userId.startsWith('demo:'))).toBe(true);
    expect(chat[2]).toMatchObject({ isModerator: true, isBroadcaster: false });
    expect(sim.accountAgeDays('demo:b')).toBe(1);
    expect(sim.snapshot().state).toMatchObject({ playing: false, finished: true, position: 4, total: 4 });
  });
  it('honours playback speed', () => {
    const { sim, timers, chat } = setup();
    sim.play('Test', 2); timers.advance(500);
    expect(chat).toHaveLength(2);
    timers.advance(1500); expect(chat).toHaveLength(3);
  });
  it('pauses and resumes from the same scenario position', () => {
    const { sim, timers, chat } = setup();
    sim.play('Test', 1); timers.advance(600); sim.pause();
    timers.advance(10_000); expect(chat).toHaveLength(1);
    sim.play('Test', 1); timers.advance(399); expect(chat).toHaveLength(1);
    timers.advance(1); expect(chat).toHaveLength(2);
  });
  it('changing speed mid-play keeps scenario time', () => {
    const { sim, timers, chat } = setup();
    sim.play('Test', 1); timers.advance(500);
    sim.play('Test', 0.5); timers.advance(999); expect(chat).toHaveLength(1);
    timers.advance(1); expect(chat).toHaveLength(2);
  });
  it('reset stops playback and clears demo messages', () => {
    const { sim, timers, chat, bus } = setup();
    sim.play('Test', 1); timers.advance(1000);
    let cleared = 0; bus.on('demo.cleared', () => cleared++);
    sim.reset();
    timers.advance(10_000);
    expect(chat).toHaveLength(2); expect(cleared).toBe(1);
    expect(sim.snapshot()).toMatchObject({ messages: [], state: { playing: false, position: 0 } });
  });
  it('replaying a finished scenario starts over', () => {
    const { sim, timers, chat } = setup();
    sim.play('Test', 1); timers.advance(5000); sim.play('Test', 1); timers.advance(0);
    expect(chat).toHaveLength(4); expect(sim.snapshot().messages).toHaveLength(1);
  });
  it('does nothing while demo mode is off, and turning it off stops playback', () => {
    const off = setup(false);
    expect(off.sim.play('Test', 1)).toBe(false); expect(off.sim.inject('x', 'hi')).toBeUndefined();
    const on = setup();
    on.sim.play('Test', 1); on.timers.advance(0); on.sim.setEnabled(false); on.timers.advance(10_000);
    expect(on.chat).toHaveLength(1);
    expect(on.sim.play('Missing', 1)).toBe(false);
  });
  it('injects a message as a chosen fake viewer', () => {
    const { sim, chat } = setup();
    const message = sim.inject('Snoopy_1', 'is that maple ave?');
    expect(message).toMatchObject({ userLogin: 'snoopy_1', userName: 'Snoopy_1', source: 'demo', isBroadcaster: false });
    expect(chat).toEqual([message]);
  });
});

describe('scenario files', () => {
  it('loads every bundled scenario, including the required three', () => {
    const scenarios = loadScenarios();
    expect([...scenarios.values()].map(s => s.file).sort()).toEqual(['false-positive-check.json', 'irl-triangulation.json', 'raid-swarm.json']);
    expect(scenarios.get('IRL triangulation')!.events.some(e => e.type === 'raid')).toBe(true);
  });
  it('skips malformed or out-of-order files instead of crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fly-scenarios-'));
    writeFileSync(join(dir, 'broken.json'), '{nope');
    writeFileSync(join(dir, 'order.json'), JSON.stringify({ name: 'Order', events: [{ t: 5, type: 'chat', user: 'a', text: 'x' }, { t: 1, type: 'chat', user: 'b', text: 'y' }] }));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ name: 'Ok', events: [{ t: 0, type: 'chat', user: 'a', text: 'x' }] }));
    expect([...loadScenarios(dir).keys()]).toEqual(['Ok']);
  });
});
