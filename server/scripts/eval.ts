// npm run eval — measures the classifier on the labeled fixture (AGENTS.md §15).
// Uses OpenAI when OPENAI_API_KEY is set, otherwise the rules fallback. Non-candidates count as benign,
// exactly as in the live pipeline.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { Classifier, OpenAiClient, rulesClassify } from '../src/pipeline/classifier.js';
import { prefilter } from '../src/pipeline/prefilter.js';
import type { Category, ChatMessage, Classification } from '../src/types.js';

interface Example { id: string; label: Category; text: string; context?: { user: string; text: string }[] }
// Optional argument: another fixture file, e.g. the held-out set (npm run eval -- test/fixtures/holdout-messages.json).
const fixture = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(import.meta.dirname, '../test/fixtures/labeled-messages.json');
const examples = JSON.parse(readFileSync(fixture, 'utf8')) as Example[];
const config = loadConfig();
const categories: Category[] = ['location_question', 'location_guess', 'location_confirmation', 'location_share', 'approach_intent', 'swat_or_threat', 'benign'];
const mode = config.OPENAI_API_KEY ? `AI (${config.OPENAI_MODEL_TEXT})` : 'rules fallback (no OPENAI_API_KEY)';
const toMessage = (id: string, user: string, text: string): ChatMessage => ({ id, userId: user, userLogin: user, userName: user, text, timestamp: Date.now(), isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, source: 'demo' });

async function classify(example: Example): Promise<Classification | undefined> {
  const message = toMessage(example.id, 'viewer', example.text);
  const result = prefilter(message, config.PREFILTER_THRESHOLD);
  if (!result.candidate) return undefined;
  if (!config.OPENAI_API_KEY) return rulesClassify(message, result);
  const context = (example.context ?? []).map((c, i) => toMessage(`${example.id}-ctx${i}`, c.user, c.text));
  let out: Classification | undefined;
  const classifier = new Classifier({ ai: new OpenAiClient(config.OPENAI_API_KEY, config.OPENAI_MODEL_TEXT), maxCallsPerMinute: 1000, timeoutMs: config.AI_TIMEOUT_MS,
    streamer: () => 'the streamer', context: () => context, onResult: f => { out = f.classification; }, onStatus: () => {} });
  classifier.enqueue({ message, prefilter: result });
  await classifier.flush();
  return out;
}

const confusion = new Map<string, number>();
const misses: string[] = [];
let aiUsed = 0;
for (const example of examples) {
  const c = await classify(example);
  const predicted = c?.category ?? 'benign';
  if (c?.source === 'ai') aiUsed++;
  confusion.set(`${example.label}|${predicted}`, (confusion.get(`${example.label}|${predicted}`) ?? 0) + 1);
  if (predicted !== example.label) misses.push(`  ${example.id}  ${example.label.padEnd(21)} → ${predicted.padEnd(21)} ${example.text}`);
}
const count = (label: Category | '*', predicted: Category | '*') => [...confusion].filter(([k]) => { const [l, p] = k.split('|'); return (label === '*' || l === label) && (predicted === '*' || p === predicted); }).reduce((s, [, v]) => s + v, 0);
const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(0)}%` : '—';
console.log(`\nFly Swatter eval · ${fixture.split('/').pop()} · ${examples.length} examples · ${mode}${config.OPENAI_API_KEY ? ` · ${aiUsed} AI results` : ''}\n`);
console.log('category'.padEnd(23) + 'precision  recall  support');
for (const cat of categories) console.log(cat.padEnd(23) + pct(count(cat, cat), count('*', cat)).padStart(9) + pct(count(cat, cat), count(cat, '*')).padStart(8) + String(count(cat, '*')).padStart(9));
const nonBenign = categories.filter(c => c !== 'benign');
const flaggedCorrect = nonBenign.reduce((s, c) => s + count(c, c), 0), flaggedTotal = nonBenign.reduce((s, c) => s + count('*', c), 0);
const flaggedAny = nonBenign.reduce((s, c) => s + nonBenign.reduce((t, p) => t + count(c, p), 0), 0);
const benignFp = count('benign', '*') - count('benign', 'benign');
console.log(`\nnon-benign precision (exact category): ${pct(flaggedCorrect, flaggedTotal)}   target ≥ 85%`);
console.log(`non-benign detected as some risk:      ${pct(flaggedAny, examples.length - count('benign', '*'))}`);
console.log(`benign false-positive rate:            ${pct(benignFp, count('benign', '*'))}   target ≤ 10%`);
console.log('\nconfusion (rows = label, cols = predicted):');
const short = (c: string) => c.replace('location_', '').slice(0, 7);
console.log(''.padEnd(23) + categories.map(c => short(c).padStart(8)).join(''));
for (const label of categories) console.log(label.padEnd(23) + categories.map(p => String(count(label, p) || '·').padStart(8)).join(''));
if (misses.length) console.log(`\nmisclassified (${misses.length}):\n${misses.join('\n')}`);
