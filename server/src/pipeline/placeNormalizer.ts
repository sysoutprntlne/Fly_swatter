// Normalizes place text into comparable token sets (AGENTS.md §8.3).
const abbreviations: Record<string, string> = { st: 'street', str: 'street', ave: 'avenue', av: 'avenue', rd: 'road', blvd: 'boulevard', hwy: 'highway', ln: 'lane', dr: 'drive', ct: 'court', pkwy: 'parkway', mt: 'mount', ft: 'fort', pl: 'place', sq: 'square', ctr: 'center', centre: 'center' };
const streetWords = new Set(['street', 'avenue', 'road', 'boulevard', 'highway', 'lane', 'drive', 'court', 'parkway', 'way', 'place']);
const directions: Record<string, string> = { n: 'north', s: 'south', e: 'east', w: 'west' };
const stopwords = new Set(['the', 'on', 'near', 'by', 'at', 'in', 'that', 'thats', 'this', 'of', 'a', 'an', 'and', 'to', 'its', 'is']);
// Words that end in a street abbreviation but are not "<name>+st" (avoid "forest" → "fore street").
const gluedExceptions = new Set(['forest', 'first', 'west', 'east', 'best', 'coast', 'crest', 'harvest', 'midwest', 'northwest', 'southwest', 'northeast', 'southeast', 'august', 'trust', 'post', 'host', 'most', 'last', 'fast', 'past', 'vast', 'nest', 'test', 'rest', 'fest', 'guest', 'quest', 'chest', 'honest', 'interest', 'contest', 'tempest', 'budapest', 'bucharest', 'everest', 'boulevard']);

export interface NormalizedPlace { key: string; tokens: string[] }
export function normalizePlace(text: string): NormalizedPlace {
  let tokens = text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  // "mainst" → "main st" when the glued suffix is the final token.
  const last = tokens.at(-1);
  if (last && !gluedExceptions.has(last)) {
    const glued = last.match(/^([a-z]{3,}?)(st|ave|blvd)$/);
    if (glued && !(glued[1]! in abbreviations)) tokens = [...tokens.slice(0, -1), glued[1]!, glued[2]!];
  }
  tokens = tokens.map(token => abbreviations[token] ?? token);
  // n/s/e/w expand only when adjacent to a street word.
  tokens = tokens.map((token, i) => directions[token] && (streetWords.has(tokens[i + 1] ?? '') || streetWords.has(tokens[i - 1] ?? '') || streetWords.has(tokens[i + 2] ?? '')) ? directions[token]! : token);
  tokens = tokens.filter(token => !stopwords.has(token));
  return { key: tokens.join(' '), tokens };
}

// Jaro-Winkler similarity, used to tolerate typos between individual tokens ("mapel" ≈ "maple").
export function jaroWinkler(a: string, b: string) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false), bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k++]) transpositions++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}
const sameToken = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && !/\d/.test(a + b) && jaroWinkler(a, b) >= 0.92);

// Count tokens of `a` with a (fuzzy) partner in `b`, using each partner once.
function shared(a: string[], b: string[]) {
  const pool = [...b]; let count = 0;
  for (const token of a) {
    const index = pool.findIndex(other => sameToken(token, other));
    if (index >= 0) { pool.splice(index, 1); count++; }
  }
  return count;
}
export function tokenSetSimilarity(a: string[], b: string[]) {
  const A = [...new Set(a)], B = [...new Set(b)];
  if (!A.length || !B.length) return 0;
  return (2 * shared(A, B)) / (A.length + B.length);
}
// Same cluster if token-set similarity ≥ 0.8, or one is a subset of the other sharing ≥ 2 tokens.
export function placesMatch(a: NormalizedPlace, b: NormalizedPlace) {
  if (!a.tokens.length || !b.tokens.length) return false;
  if (a.key === b.key || a.key.replace(/ /g, '') === b.key.replace(/ /g, '')) return true;
  if (tokenSetSimilarity(a.tokens, b.tokens) >= 0.8) return true;
  const [small, large] = a.tokens.length <= b.tokens.length ? [a.tokens, b.tokens] : [b.tokens, a.tokens];
  const common = shared([...new Set(small)], [...new Set(large)]);
  return common === new Set(small).size && common >= 2;
}
