import { chainNames } from '../config.js';
import type { ChatMessage, Granularity, PrefilterResult } from '../types.js';

// Cheap synchronous scoring (AGENTS.md §8.1). Score = 1 − ∏(1 − weight) over matched rule groups.
export interface Rule { id: string; weight: number; patterns: RegExp[]; original?: boolean }
const placeNouns = 'street|st|ave|avenue|road|rd|blvd|boulevard|highway|hwy|exit|mall|station|park|plaza|square|campus|hotel|airport|bridge|pier|downtown|uptown|intersection|block|lane|ln|drive|dr';
const usStates = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
export const streetSuffix = 'st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|hwy|highway';
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const rules: Rule[] = [
  { id: 'location_question', weight: 0.5, patterns: [/\bwhere exactly\b/, /\bwhere (are|r) (you|u)\b/, /\bwhat (city|town|state|country|street|area|neighbou?rhood|mall|park|store|place)\b/, /\bwhere is (this|that)\b/, /\bwhich (city|street|mall|park|station|town|area|store)\b/, /\bwhat part of\b/, /\bwhere (u|you) at\b/, /\bwhere (is|are) (he|she|they|streamer)\b/] },
  // Strong: addressed to the streamer's whereabouts. Weak: common in ordinary chat ("looks like fun"), so it only counts next to a place.
  { id: 'guess_phrasing', weight: 0.45, patterns: [/\bis (that|this) (the|in|on|near)\b/, /\bare (you|u) (in|at|near|by)\b/] },
  { id: 'guess_phrasing_weak', weight: 0.3, patterns: [/\blooks like\b/, /\b(i think|pretty sure|im sure|i'm sure) (that's|thats|that is|you're|youre|you are|it's|its|ur)\b/, /\b(that's|thats|that is) (the|in|on)\b/, /\bthat has to be\b/] },
  { id: 'confirmation_phrasing', weight: 0.4, patterns: [/\b(yeah|yes|yep|yup|yea)\W+(that's|thats|it's|its)\b/, /\bconfirmed\b/, /\bi know (that|this) place\b/, /\bi live (near|by|there)\b/, /\b(that's|thats) right by\b/, /\bdefinitely (that|it)\b/] },
  { id: 'confirmation_weak', weight: 0.25, patterns: [/\b100%/, /\bfor sure\b/] },
  { id: 'place_noun', weight: 0.3, patterns: [new RegExp(`\\b(${placeNouns})\\b`), /\bcorner of\b/] },
  { id: 'chain_name', weight: 0.25, patterns: [new RegExp(`\\b(${chainNames.map(escape).join('|')})\\b`)] },
  { id: 'address_or_coordinates', weight: 0.9, patterns: [new RegExp(`\\b\\d{1,6}\\s+[a-z]+(\\s[a-z]+)?\\s(${streetSuffix})\\b`), /\b(zip|zipcode|zip code|postcode|postal code)\W{0,3}\d{5}\b/, /\b[a-z]\d[a-z]\s\d[a-z]\d\b/, /-?\d{1,3}\.\d{3,},\s*-?\d{1,3}\.\d{3,}/, /maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|\bapple\.co\/|maps\.apple|what3words|w3w\.co/, /\b(go|head|drive|walk) (north|south|east|west) on\b/, /\b(first|second|third|next) (left|right)\b.*\b(door|house|building|gate)\b/] },
  // A bare 5-digit number is usually a meme ("69420"), so ZIPs only count after a US state code (original casing).
  { id: 'state_zip', weight: 0.9, original: true, patterns: [new RegExp(`\\b(${usStates}),?\\s\\d{5}(-\\d{4})?\\b`)] },
  { id: 'approach_intent', weight: 0.6, patterns: [/\b(i'm|im|i am) (coming over|coming to you|outside|nearby|close by|near you|on my way|around the corner|right behind you)\b/, /\bsee (you|u) soon\b/, /\bi (can )?see (you|u)( rn| right now| from here| outside)?[\s!.]*$/, /\bturn around\b/, /\blook behind (you|u)\b/, /\bwave at me\b/, /\b(omw|otw|on my way|pulling up)\b/, /\b\d+\s*(min|mins|minutes)\s+away\b/, /\bcoming to (you|find you)\b/] },
  { id: 'threat', weight: 0.8, patterns: [/\bswat(ted|ting)? (you|u|them|him|her|the streamer|time|this)\b/, /\bget(ting)? (you |u |them |him |her )?swatted\b/, /\bcall(ing)? (in )?(a )?swat\b/, /\bcall(ing)? (the )?cops\b/, /\bcall(ing)? 911 on\b/, /\bi('ll| will) find (you|u)\b/, /\bi know where (you|u) live\b/, /\b(kill|shoot|stab|hurt) (you|u)\b/, /\bpolice (are|r) coming\b/] },
  // Two or more consecutive capitalized words not at sentence start (original casing).
  { id: 'proper_noun', weight: 0.15, original: true, patterns: [/(?<=[a-z0-9,'’]\s+)[A-Z][a-z]+\s+[A-Z][a-z]+/] },
];
export const highWeightRules = new Set(['address_or_coordinates', 'state_zip', 'threat']);

// Zero-width space/joiners, word joiner, BOM and soft hyphen, built from code points so no invisible characters live in source.
const zeroWidth = new RegExp(`[${String.fromCodePoint(0x200b)}-${String.fromCodePoint(0x200d)}${String.fromCodePoint(0x2060, 0xfeff, 0xad)}]`, 'g');
const leet: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
// Lowercase, strip zero-width characters, collapse letters repeated 3+ times ("stttt" → "st").
export function normalize(text: string) {
  return text.normalize('NFKC').replace(zeroWidth, '').toLowerCase().replace(/([a-z])\1{2,}/g, '$1').replace(/\s+/g, ' ').trim();
}
// Undo simple obfuscation: spaced letters ("m a i n s t" → "main st") and leetspeak inside words.
export function deobfuscate(normalized: string) {
  let text = normalized.replace(/\b(?:[a-z0-9] ){3,}[a-z0-9]\b/g, run => {
    const joined = run.replace(/ /g, '');
    const suffix = joined.match(new RegExp(`^(.{3,}?)(${streetSuffix})$`));
    return suffix ? `${suffix[1]} ${suffix[2]}` : joined;
  });
  // Only tokens that mix letters with digits/symbols, so "100%" and "10 min" stay intact.
  text = text.replace(/\S+/g, token => /[a-z]/.test(token) && /[0-9@$]/.test(token) && !/^\d+(st|nd|rd|th|s|k|m|min|mins|am|pm)$/.test(token) ? token.replace(/[013457@$]/g, c => leet[c]!) : token);
  return text;
}

export function scoreText(text: string) {
  const lower = normalize(text);
  const variants = [lower, deobfuscate(lower)];
  const matched = rules.filter(rule => rule.original ? rule.patterns.some(p => p.test(text)) : variants.some(v => rule.patterns.some(p => p.test(v))));
  const score = Math.min(1, 1 - matched.reduce((product, rule) => product * (1 - rule.weight), 1));
  return { score, matchedRules: matched.map(rule => rule.id), normalized: lower, deobfuscated: variants[1]! };
}

export function prefilter(message: ChatMessage, threshold: number): PrefilterResult {
  const { score, matchedRules } = scoreText(message.text);
  return {
    messageId: message.id, score: Math.round(score * 1000) / 1000, matchedRules,
    candidate: score >= threshold,
    deletable: !message.isBroadcaster && !message.isModerator,
    immediate: matchedRules.some(rule => highWeightRules.has(rule)),
  };
}

// Words that end a backwards scan for a place name: filler, pronouns, verbs, question words.
const stopTokens = new Set(('the a an on in at near by to of from and or but is are was were be that thats that\'s this its it\'s it yeah yea yes ya yep i im i\'m think know you u your ur r rn omw otw ' +
  'what which where who how why whats what\'s lol lmao 100 confirmed definitely like right just so def for with me my we they he she him her them see guys chat bro dude looks look yes yep yup pretty sure has be ' +
  'live lives love hate want need got get going go coming pulling up headed heading walking past behind next across around stop old new big little').split(' '));
const venueNouns = new Set(['mall', 'park', 'plaza', 'square', 'station', 'hotel', 'airport', 'campus', 'pier', 'bridge', 'exit']);
const streetNouns = new Set(streetSuffix.split('|'));
// Best-effort span of a place mention, for rules fallback only. The AI path extracts places itself.
export function extractPlace(text: string): { rawText: string; canonical: string; granularity: Granularity } | undefined {
  const lower = deobfuscate(normalize(text));
  const address = lower.match(new RegExp(`\\b\\d{1,6}\\s+[a-z]+(\\s[a-z]+)?\\s(${streetSuffix})\\b`));
  if (address) return { rawText: address[0], canonical: address[0], granularity: 'exact' };
  const tokens = lower.replace(/[’']s\b/g, '').replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const noun = tokens[i]!;
    if (!streetNouns.has(noun) && !venueNouns.has(noun)) continue;
    const words: string[] = [];
    for (let j = i - 1; j >= 0 && words.length < 3 && !stopTokens.has(tokens[j]!); j--) words.unshift(tokens[j]!);
    if (!words.length || words.every(w => /^\d+$/.test(w))) continue;
    const span = [...words, noun].join(' ');
    return { rawText: span, canonical: span, granularity: venueNouns.has(noun) ? 'venue' : 'street' };
  }
  const corner = lower.match(/\bcorner of ([a-z0-9]+(?: [a-z0-9]+)?) (?:and|&) ([a-z0-9]+(?: [a-z0-9]+)?)\b/);
  if (corner) return { rawText: corner[0], canonical: `${corner[1]} and ${corner[2]}`, granularity: 'street' };
  if (/\b(downtown|uptown)\b/.test(lower)) return { rawText: lower.match(/\b(downtown|uptown)\b/)![0], canonical: lower.match(/\b(downtown|uptown)\b/)![0], granularity: 'neighborhood' };
  const chain = chainNames.find(name => new RegExp(`\\b${escape(name)}\\b`).test(lower));
  if (chain) return { rawText: chain, canonical: chain, granularity: 'venue' };
  return undefined;
}

// Rolling context for the classifier: last 5 messages per user, last 30 overall.
export class ChatContext {
  private overall: ChatMessage[] = [];
  private perUser = new Map<string, ChatMessage[]>();
  add(message: ChatMessage) {
    this.overall.push(message); if (this.overall.length > 30) this.overall.shift();
    const list = this.perUser.get(message.userId) ?? [];
    list.push(message); if (list.length > 5) list.shift();
    this.perUser.set(message.userId, list);
    if (this.perUser.size > 2000) this.perUser.delete(this.perUser.keys().next().value!);
  }
  recent() { return [...this.overall]; }
  forUser(userId: string) { return [...(this.perUser.get(userId) ?? [])]; }
  clear() { this.overall = []; this.perUser.clear(); }
}
