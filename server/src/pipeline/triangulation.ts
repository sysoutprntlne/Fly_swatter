import { normalizePlace, placesMatch, type NormalizedPlace } from './placeNormalizer.js';
import type { Category, ClusterMention, Flagged, Granularity, PlaceCluster } from '../types.js';

// Detects several distinct chatters converging on the same place guess (AGENTS.md §8.4).
export const categoryWeight: Partial<Record<Category, number>> = { location_question: 0.5, location_guess: 1.0, location_confirmation: 1.3, location_share: 2.0, approach_intent: 1.5 };
export const granularityWeight: Record<Granularity, number> = { none: 0, country: 0.2, region: 0.4, city: 0.6, neighborhood: 0.8, street: 1.0, venue: 1.1, exact: 1.5 };
const granularityOrder: Granularity[] = ['none', 'country', 'region', 'city', 'neighborhood', 'street', 'venue', 'exact'];
const placeRequired = new Set<Category>(['location_question', 'approach_intent']);
const CONFIRM_WINDOW_MS = 60_000;
const QUESTION_WINDOW_MS = 120_000;

interface Entry extends ClusterMention { place?: NormalizedPlace; granularity: Granularity; replyTo?: string; bonus: boolean }
interface Cluster { id: string; entries: Entry[]; variants: NormalizedPlace[]; swarmAlerted: boolean }
export interface TriangulationOptions { windowMs: number; swarmMinUsers: number; swarmMinScore: number; now: () => number }

export class Triangulation {
  private clusters: Cluster[] = [];
  private questions: { userId: string; at: number }[] = [];
  private counter = 0;
  constructor(private options: TriangulationOptions) {}

  // Returns the affected cluster and whether this mention turned it into a swarm (emitted once per cluster).
  add({ message, classification }: Flagged): { cluster?: PlaceCluster; becameSwarm: boolean } {
    this.prune();
    const now = this.options.now();
    // Mods and the broadcaster are excluded: "please stop guessing Maple Ave" must not build a swarm.
    if (message.isBroadcaster || message.isModerator) return { becameSwarm: false };
    const { category, place } = classification;
    if (category === 'location_question') this.questions.push({ userId: message.userId, at: now });
    const weightOfCategory = categoryWeight[category];
    if (!weightOfCategory || (placeRequired.has(category) && !place)) return { becameSwarm: false };
    const normalized = place ? normalizePlace(place.canonical || place.rawText) : undefined;
    if (normalized && !normalized.tokens.length) return { becameSwarm: false };
    let cluster: Cluster | undefined;
    if (normalized) cluster = this.clusters.find(c => c.variants.some(v => placesMatch(v, normalized)));
    else if (category === 'location_confirmation') cluster = this.confirmationTarget(message.replyToMessageId, now);
    if (!cluster && !normalized) return { becameSwarm: false };
    if (!cluster) { cluster = { id: `cluster-${++this.counter}`, entries: [], variants: [], swarmAlerted: false }; this.clusters.push(cluster); }
    if (normalized && !cluster.variants.some(v => v.key === normalized.key)) cluster.variants.push(normalized);
    const granularity = place?.granularity ?? this.precision(cluster);
    const bonus = category === 'location_confirmation' && cluster.entries.some(e => e.userId !== message.userId && e.category === 'location_guess' && (e.messageId === message.replyToMessageId || now - e.at <= CONFIRM_WINDOW_MS));
    cluster.entries.push({
      messageId: message.id, userId: message.userId, userLogin: message.userLogin, excerpt: message.text.slice(0, 140), category,
      confidence: classification.confidence, weight: weightOfCategory * granularityWeight[granularity] * classification.confidence,
      at: now, place: normalized, granularity, replyTo: message.replyToMessageId, bonus,
    });
    const view = this.view(cluster);
    const becameSwarm = view.isSwarm && !cluster.swarmAlerted;
    if (becameSwarm) cluster.swarmAlerted = true;
    return { cluster: view, becameSwarm };
  }
  // A placeless "yeah that's it" joins the cluster it replies to, else the most recent guess within 60 s.
  private confirmationTarget(replyTo: string | undefined, now: number) {
    if (replyTo) { const byReply = this.clusters.find(c => c.entries.some(e => e.messageId === replyTo)); if (byReply) return byReply; }
    let best: Cluster | undefined; let bestAt = -Infinity;
    for (const c of this.clusters) for (const e of c.entries) if (e.category === 'location_guess' && now - e.at <= CONFIRM_WINDOW_MS && e.at > bestAt) { best = c; bestAt = e.at; }
    return best;
  }
  private precision(cluster: Cluster): Granularity {
    return cluster.entries.reduce<Granularity>((best, e) => granularityOrder.indexOf(e.granularity) > granularityOrder.indexOf(best) ? e.granularity : best, 'none');
  }
  // Score = Σ over distinct users of their max mention weight × (1 + 0.25 × (users − 1)), + 0.5 confirmation bonus.
  static score(entries: Pick<Entry, 'userId' | 'weight' | 'bonus'>[]) {
    const best = new Map<string, number>();
    for (const e of entries) best.set(e.userId, Math.max(best.get(e.userId) ?? 0, e.weight));
    const users = best.size;
    if (!users) return { users, score: 0 };
    const base = [...best.values()].reduce((a, b) => a + b, 0) * (1 + 0.25 * (users - 1));
    return { users, score: base + (entries.some(e => e.bonus) ? 0.5 : 0) };
  }
  private view(cluster: Cluster): PlaceCluster {
    const { users, score } = Triangulation.score(cluster.entries);
    const counts = new Map<string, number>();
    for (const e of cluster.entries) if (e.place) counts.set(e.place.key, (counts.get(e.place.key) ?? 0) + 1);
    const canonical = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? cluster.variants[0]?.key ?? '';
    const round = Math.round(score * 100) / 100;
    return {
      id: cluster.id, canonical, granularity: this.precision(cluster),
      mentions: cluster.entries.map(({ messageId, userId, userLogin, excerpt, category, confidence, weight, at }) => ({ messageId, userId, userLogin, excerpt, category, confidence, weight: Math.round(weight * 1000) / 1000, at })),
      distinctUsers: users, score: round, firstSeen: cluster.entries[0]?.at ?? 0, lastSeen: cluster.entries.at(-1)?.at ?? 0,
      isSwarm: users >= this.options.swarmMinUsers && score >= this.options.swarmMinScore,
    };
  }
  prune() {
    const cutoff = this.options.now() - this.options.windowMs;
    for (const c of this.clusters) c.entries = c.entries.filter(e => e.at >= cutoff);
    this.clusters = this.clusters.filter(c => c.entries.length);
    const questionCutoff = this.options.now() - QUESTION_WINDOW_MS;
    this.questions = this.questions.filter(q => q.at >= questionCutoff);
  }
  // Distinct users asking location questions in the last 2 minutes (feeds the risk engine).
  questionPressure() { this.prune(); return new Set(this.questions.map(q => q.userId)).size; }
  snapshot(): PlaceCluster[] { this.prune(); return this.clusters.map(c => this.view(c)).sort((a, b) => b.score - a.score); }
  clusterFor(messageId: string) { const c = this.clusters.find(c => c.entries.some(e => e.messageId === messageId)); return c && this.view(c); }
  reset() { this.clusters = []; this.questions = []; }
}
