import type { Granularity } from '../../server/src/types';
// Plain-language versions of the pipeline's numbers and reasons, for streamers and mods who don't know the jargon.
// The server keeps its precise wording (logs, reports); the dashboard says what it means.

/** 0-100 component strength as a word. The number stays one hover away. */
export function strength(value: number): string {
  if (value < 1) return 'None';
  if (value < 25) return 'Low';
  if (value < 50) return 'Some';
  if (value < 75) return 'High';
  return 'Very high';
}

/** Classifier confidence as a word. */
export function sureness(confidence: number): string {
  return confidence < .45 ? 'Not sure' : confidence < .7 ? 'Fairly sure' : 'Very sure';
}

/** What a place guess narrows down, as part of a sentence ("the street you're on"). */
export const placeKind: Record<Granularity, string> = {
  none: 'a place', country: 'your country', region: 'your region', city: 'your city', neighborhood: 'your neighbourhood',
  street: "the street you're on", venue: "the place you're at", exact: 'your exact spot',
};

const deletedWhat: Record<string, string> = {
  'location guess': 'a guess about where you are', 'location confirmation': 'someone agreeing with a guess',
  'location question': 'a question about where you are', 'location share': 'a shared location',
  'approach intent': 'someone saying they are coming', 'swat or threat': 'a threat',
};
const deletedWhy: [RegExp, string][] = [
  [/part of a converging swarm/g, 'several people agreed on the same place'],
  [/shared a location/g, 'it gave away a location'],
  [/confident guess/g, 'it was a confident guess'],
  [/confident confirmation/g, 'it confidently agreed with a guess'],
  [/swat-all-guesses is on/g, '"Delete every guess" is on'],
  [/location question while chat is buzzing/g, 'chat was busy guessing'],
];

/** The server's action reason, said plainly. Unknown reasons pass through unchanged. */
export function plainReason(reason: string): string {
  const swat = /^Swatted ([a-z ]+): (.*)$/.exec(reason);
  if (swat) {
    let why = swat[2]!;
    for (const [pattern, words] of deletedWhy) why = why.replace(pattern, words);
    const because = why.replace(/; /g, ' and ');
    return `It was ${deletedWhat[swat[1]!] ?? 'a flagged message'}. Reason: ${because}.`;
  }
  const swarm = /^Swarm formed: (\d+) chatters converged on one place$/.exec(reason);
  if (swarm) return `${swarm[1]} people agreed on the same place.`;
  if (reason.startsWith('Risk rose to ')) return `Danger went up to ${reason.slice('Risk rose to '.length)}.`;
  if (reason.startsWith('Repeat offender')) return 'This chatter had 2 or more messages deleted in 10 minutes.';
  if (reason.startsWith('Guardian: risk reached ')) return `Danger reached ${reason.slice('Guardian: risk reached '.length)}.`;
  return reason;
}

const rationale: [RegExp, string][] = [
  [/^Rules: /, ''],
  [/address, coordinates, directions or map link pattern/, 'looks like an address, map link or directions'],
  [/threat or swatting phrase/, 'sounds like a threat or a fake police call'],
  [/says they are coming or nearby/, 'talks about coming to you or being close'],
  [/confirms a location/, 'agrees with a place someone named'],
  [/agrees with a named place/, 'agrees with a place someone named'],
  [/guess phrasing with a place/, 'phrased as a guess and names a place'],
  [/asks where the streamer is/, 'a question about your location, with no place named'],
  [/asks if the streamer is somewhere unrecognised/, 'asks if you are somewhere'],
  [/names a specific place/, 'names a specific place'],
];

/** Why a message was flagged, in everyday words. */
export function plainRationale(text: string): string {
  let out = text;
  for (const [pattern, words] of rationale) out = out.replace(pattern, words);
  out = out.replace(/\.$/, '');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The prefilter's rule ids, as what a mod would notice in the message. */
export const ruleLabel: Record<string, string> = {
  address_or_coordinates: 'Looks like an address, map link or coordinates',
  approach_intent: 'Says they are coming or nearby',
  chain_name: 'Names a chain store or restaurant',
  confirmation_phrasing: 'Agrees with something ("yeah that\'s it")',
  confirmation_weak: 'Sounds like agreement',
  guess_phrasing: 'Phrased as a guess ("is that…")',
  guess_phrasing_weak: 'Sounds like a guess',
  location_question: 'Asks where you are',
  place_noun: 'Uses a place word (street, mall, station…)',
  proper_noun: 'Names something with capital letters',
  state_zip: 'Mentions a state or postcode',
  threat: 'Threat or fake-police-call wording',
};
