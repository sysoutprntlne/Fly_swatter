import type { Flagged, RiskLevel, RiskState } from '../types.js';

// Combines signals into one 0–100 score and a level with hysteresis (AGENTS.md §10).
export const levels: { level: RiskLevel; min: number }[] = [{ level: 'quiet', min: 0 }, { level: 'few_flies', min: 25 }, { level: 'buzzing', min: 50 }, { level: 'swarm', min: 75 }];
const rank = (level: RiskLevel) => levels.findIndex(l => l.level === level);
export const levelFor = (score: number): RiskLevel => [...levels].reverse().find(l => score >= l.min)!.level;
const HALF_LIFE = { chat: 90_000, exposure: 60_000, raid: 300_000 };
const HYSTERESIS_MS = 20_000;

class Decaying {
  private value = 0; private at = 0;
  constructor(private halfLife: number) {}
  get(now: number) { return this.value * 0.5 ** (Math.max(0, now - this.at) / this.halfLife); }
  set(value: number, now: number) { this.value = Math.max(0, Math.min(100, value)); this.at = now; }
  add(delta: number, now: number) { this.set(this.get(now) + delta, now); }
}

/**
 * Overall score. The strongest of chat/triangulation/exposure dominates (×0.7), the other two stack (×0.15 each),
 * and raid adds ×0.5. Floors keep decisive signals visible: an active swarm is always "swarm" (≥ 75) and a
 * severe threat (chat ≥ 70) is always at least "buzzing" (≥ 50). Without floors one signal tops out at 70.
 */
export function combine(c: RiskState['components'], anySwarm: boolean) {
  const main = [c.chat, c.triangulation, c.exposure].sort((a, b) => b - a);
  let score = main[0]! * 0.7 + (main[1]! + main[2]!) * 0.15 + c.raid * 0.5;
  if (anySwarm) score = Math.max(score, 75);
  if (c.chat >= 70) score = Math.max(score, 50);
  return Math.min(100, Math.round(score * 10) / 10);
}

export interface MessageContext { accountAgeDays?: number; questionPressure: number }
export class RiskEngine {
  private chat = new Decaying(HALF_LIFE.chat);
  private exposure = new Decaying(HALF_LIFE.exposure);
  private raid = new Decaying(HALF_LIFE.raid);
  private triangulation = 0;
  private anySwarm = false;
  private pressureCounted = 0;
  private questionPressure = 0;
  private level: RiskLevel = 'quiet';
  private belowSince?: number;
  constructor(private now: () => number) {}

  onClassification({ classification: c }: Flagged, context: MessageContext) {
    const now = this.now();
    this.questionPressure = context.questionPressure;
    if (c.category === 'benign') return this.state();
    const age = context.accountAgeDays;
    const ageFactor = age === undefined ? 1 : age < 7 ? 1.3 : age < 30 ? 1.15 : 1;
    const raidFactor = this.raid.get(now) > 1 && age !== undefined && age < 7 ? 1.5 : 1;
    let delta = c.severity * 8 * c.confidence * ageFactor * raidFactor;
    // +10 per distinct questioning user beyond the first within 2 minutes.
    if (context.questionPressure > Math.max(1, this.pressureCounted)) delta += 10 * (context.questionPressure - Math.max(1, this.pressureCounted));
    this.pressureCounted = context.questionPressure;
    this.chat.add(delta, now);
    if (c.category === 'swat_or_threat' && c.severity === 3) this.chat.set(Math.max(70, this.chat.get(now)), now);
    return this.state();
  }
  setTriangulation(topClusterScore: number, anySwarm: boolean, questionPressure: number) {
    this.triangulation = Math.min(100, topClusterScore * 22);
    if (anySwarm) this.triangulation = Math.max(75, this.triangulation);
    this.anySwarm = anySwarm;
    this.questionPressure = questionPressure;
    if (questionPressure < this.pressureCounted) this.pressureCounted = questionPressure;
    this.state(); // start the hysteresis clock at the moment the score changes
  }
  onRaid(viewers: number) { const now = this.now(); this.raid.set(Math.max(this.raid.get(now), Math.min(40, 10 + viewers / 10)), now); return this.state(); }
  setExposure(score: number) { this.exposure.set(score, this.now()); this.state(); }
  // Recompute with decay and apply hysteresis: rise immediately, fall only after 20 s below the current level.
  state(): RiskState {
    const now = this.now();
    const round = (n: number) => Math.round(n * 10) / 10;
    const components = { chat: round(this.chat.get(now)), triangulation: round(this.triangulation), exposure: round(this.exposure.get(now)), raid: round(this.raid.get(now)) };
    const score = combine(components, this.anySwarm);
    const raw = levelFor(score);
    if (rank(raw) >= rank(this.level)) { this.level = raw; this.belowSince = undefined; }
    else {
      this.belowSince ??= now;
      if (now - this.belowSince >= HYSTERESIS_MS) { this.level = raw; this.belowSince = undefined; }
    }
    return { score, level: this.level, components, questionPressure: this.questionPressure, updatedAt: now };
  }
  reset() {
    const now = this.now();
    this.chat.set(0, now); this.exposure.set(0, now); this.raid.set(0, now);
    this.triangulation = 0; this.anySwarm = false; this.pressureCounted = 0; this.questionPressure = 0; this.level = 'quiet'; this.belowSince = undefined;
  }
}
