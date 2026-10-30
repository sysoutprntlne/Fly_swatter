import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { extractPlace, normalize } from './prefilter.js';
import type { AiStatus, Category, ChatMessage, Classification, Flagged, PrefilterResult } from '../types.js';

// Classifies prefilter candidates (AGENTS.md §8.2). AI is optional: with no key, every batch uses the rules fallback.
const categories = ['location_question', 'location_guess', 'location_confirmation', 'location_share', 'approach_intent', 'swat_or_threat', 'benign'] as const;
const granularities = ['none', 'country', 'region', 'city', 'neighborhood', 'street', 'venue', 'exact'] as const;
const aiItem = z.object({
  messageId: z.string(), category: z.enum(categories), confidence: z.number().min(0).max(1),
  severity: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  place: z.object({ rawText: z.string().max(200), canonical: z.string().max(200), granularity: z.enum(granularities) }).nullable(),
  rationale: z.string().max(400),
});
// Strict structured-output schema: every property required, nullable place, no extra properties.
export const classificationJsonSchema = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['messageId', 'category', 'confidence', 'severity', 'place', 'rationale'],
    properties: {
      messageId: { type: 'string' }, category: { type: 'string', enum: [...categories] }, confidence: { type: 'number' },
      severity: { type: 'integer', enum: [0, 1, 2, 3] },
      place: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['rawText', 'canonical', 'granularity'], properties: { rawText: { type: 'string' }, canonical: { type: 'string' }, granularity: { type: 'string', enum: [...granularities] } } }] },
      rationale: { type: 'string' },
    } } } },
} as const;

export interface AiRequest { streamer: string; candidates: { id: string; user: string; text: string }[]; context: { user: string; text: string }[] }
export interface AiClient { classify(request: AiRequest, signal: AbortSignal): Promise<unknown> }

export const classifierPrompt = () => readFileSync(resolve(import.meta.dirname, '../../src/prompts/classifier.system.md'), 'utf8');
export class OpenAiClient implements AiClient {
  private client?: import('openai').default;
  constructor(private apiKey: string, private model: string, private prompt = classifierPrompt()) {}
  async classify(request: AiRequest, signal: AbortSignal) {
    const { default: OpenAI } = await import('openai');
    this.client ??= new OpenAI({ apiKey: this.apiKey, maxRetries: 0 });
    const response = await this.client.responses.create({
      model: this.model, store: false,
      input: [{ role: 'system', content: this.prompt }, { role: 'user', content: JSON.stringify(request) }],
      text: { format: { type: 'json_schema', name: 'fly_swatter_classifications', strict: true, schema: classificationJsonSchema as unknown as Record<string, unknown> } },
    }, { signal });
    if (response.status !== 'completed') throw new Error('AI response incomplete');
    return JSON.parse(response.output_text);
  }
}

// Derive a classification from prefilter rules alone (no AI). Conservative confidences.
export function rulesClassify(message: ChatMessage, prefilter: PrefilterResult): Classification {
  const has = (id: string) => prefilter.matchedRules.includes(id);
  const place = extractPlace(message.text);
  const make = (category: Category, severity: Classification['severity'], confidence: number, why: string, withPlace = true): Classification =>
    ({ messageId: message.id, category, severity, confidence, ...(withPlace && place && category !== 'benign' ? { place } : {}), rationale: `Rules: ${why}.`, source: 'rules_fallback' });
  if (has('address_or_coordinates') || has('state_zip')) return make('location_share', 3, 0.7, 'address, coordinates, directions or map link pattern');
  if (has('threat')) return make('swat_or_threat', 3, 0.6, 'threat or swatting phrase');
  if (has('approach_intent')) return make('approach_intent', 2, 0.5, 'says they are coming or nearby');
  // A placeless "yeah that's…" only counts when it explicitly confirms ("that's it", "that's right"), not "yeah that's funny".
  const explicitConfirm = /\b(that'?s|it'?s|thats|its) (it|right|correct|the (one|place|spot))\b|\bconfirmed\b|\bi know (that|this) place\b|\bi live (near|by|there)\b/.test(normalize(message.text));
  if (has('confirmation_phrasing') && (place || explicitConfirm)) return make('location_confirmation', 2, 0.45, 'confirms a location');
  if (has('confirmation_weak') && place) return make('location_confirmation', 2, 0.4, 'agrees with a named place');
  if ((has('guess_phrasing') || has('guess_phrasing_weak')) && place) return make('location_guess', 2, 0.4, 'guess phrasing with a place');
  if (has('location_question')) return make('location_question', 1, 0.5, 'asks where the streamer is');
  if (has('guess_phrasing')) return make('location_guess', 1, 0.35, 'asks if the streamer is somewhere unrecognised');
  if (place && (has('place_noun') || has('chain_name')) && prefilter.candidate) return make('location_guess', 2, 0.35, 'names a specific place');
  return make('benign', 0, 0.5, 'no location pattern');
}

interface Timers { now: () => number; setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void }
const realTimers: Timers = { now: Date.now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
export interface ClassifierOptions {
  ai?: AiClient; maxCallsPerMinute: number; timeoutMs: number; streamer: () => string;
  context: () => ChatMessage[]; onResult: (flagged: Flagged) => void; onStatus: (status: AiStatus) => void; timers?: Timers;
}
type Item = { message: ChatMessage; prefilter: PrefilterResult };
const BATCH_MS = 2000, BATCH_SIZE = 10, RETRY_AI_MS = 60_000, CACHE_SIZE = 500;

export class Classifier {
  private queue: Item[] = [];
  private timer: unknown;
  private calls: number[] = [];
  private cache = new Map<string, Omit<Classification, 'messageId'>>();
  private aiDownUntil = 0;
  private status: AiStatus;
  private generation = 0;
  private timers: Timers;
  constructor(private options: ClassifierOptions) {
    this.timers = options.timers ?? realTimers;
    this.status = options.ai ? { enabled: true, healthy: true, budgetReached: false, message: 'AI classifier ready.' } : { enabled: false, healthy: true, budgetReached: false, message: 'No OpenAI key: using built-in rules.' };
  }
  aiStatus() { return { ...this.status }; }
  enqueue(item: Item) {
    const cached = this.cache.get(normalize(item.message.text));
    if (cached) { this.deliver(item, { ...cached, messageId: item.message.id }); return; }
    this.queue.push(item);
    // Address and threat hits skip the batching delay; so does rules-only mode, which has nothing to batch.
    if (!this.options.ai || item.prefilter.immediate || this.queue.length >= BATCH_SIZE) void this.flush();
    else if (this.timer === undefined) this.timer = this.timers.setTimeout(() => { this.timer = undefined; void this.flush(); }, BATCH_MS);
  }
  async flush() {
    if (this.timer !== undefined) { this.timers.clearTimeout(this.timer); this.timer = undefined; }
    const batch = this.queue.splice(0);
    if (!batch.length) return;
    const generation = this.generation;
    const results = await this.classifyBatch(batch);
    if (generation !== this.generation) return; // reset happened mid-flight
    batch.forEach((item, i) => this.deliver(item, results[i]!));
  }
  reset() { this.generation++; this.queue = []; if (this.timer !== undefined) this.timers.clearTimeout(this.timer); this.timer = undefined; }
  private deliver(item: Item, classification: Classification) {
    try { this.options.onResult({ ...item, classification }); } catch { /* one bad consumer must not stop the pipeline */ }
  }
  private setStatus(next: Partial<AiStatus>) {
    const merged = { ...this.status, ...next };
    if (JSON.stringify(merged) === JSON.stringify(this.status)) return;
    this.status = merged; this.options.onStatus({ ...merged });
  }
  private async classifyBatch(batch: Item[]): Promise<Classification[]> {
    const fallback = () => batch.map(item => rulesClassify(item.message, item.prefilter));
    const ai = this.options.ai;
    const now = this.timers.now();
    if (!ai || now < this.aiDownUntil) return fallback();
    this.calls = this.calls.filter(at => now - at < 60_000);
    if (this.calls.length >= this.options.maxCallsPerMinute) { this.setStatus({ budgetReached: true, message: 'AI budget reached: using rules for now.' }); return fallback(); }
    this.calls.push(now);
    const ids = new Set(batch.map(item => item.message.id));
    const request: AiRequest = {
      streamer: this.options.streamer(),
      candidates: batch.map(item => ({ id: item.message.id, user: item.message.userName, text: item.message.text })),
      context: this.options.context().filter(m => !ids.has(m.id)).slice(-30).map(m => ({ user: m.userName, text: m.text })),
    };
    try {
      const raw = await ai.classify(request, AbortSignal.timeout(this.options.timeoutMs));
      const items = z.object({ items: z.array(z.unknown()) }).parse(raw).items;
      const byId = new Map<string, z.infer<typeof aiItem>>();
      for (const candidate of items) { const parsed = aiItem.safeParse(candidate); if (parsed.success && ids.has(parsed.data.messageId)) byId.set(parsed.data.messageId, parsed.data); }
      this.setStatus({ healthy: true, budgetReached: false, message: 'AI classifier ready.' });
      return batch.map(item => {
        const found = byId.get(item.message.id);
        if (!found) return rulesClassify(item.message, item.prefilter);
        const { place, ...rest } = found;
        const classification: Classification = { ...rest, ...(place && rest.category !== 'benign' ? { place } : {}), source: 'ai' };
        // Confirmations depend on context, so they are never reused for identical text.
        if (classification.category !== 'location_confirmation') this.remember(normalize(item.message.text), classification);
        return classification;
      });
    } catch {
      this.aiDownUntil = this.timers.now() + RETRY_AI_MS;
      this.setStatus({ healthy: false, message: 'AI unavailable: using rules, retrying in 60 s.' });
      return fallback();
    }
  }
  private remember(key: string, classification: Classification) {
    const { messageId: _omit, ...rest } = classification; void _omit;
    this.cache.set(key, rest);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
  }
}
