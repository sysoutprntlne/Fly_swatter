import { describe, expect, it } from 'vitest';
import { jaroWinkler, normalizePlace, placesMatch } from '../src/pipeline/placeNormalizer.js';
const match = (a: string, b: string) => placesMatch(normalizePlace(a), normalizePlace(b));
describe('place normalizer', () => {
  it.each([['Main St', 'main street'], ['main street', 'main street'], ['the CVS on main', 'cvs main'], ['mainst', 'main street'], ['MAIN ST!!!', 'main street'], ['N Maple Ave', 'north maple avenue'], ['Mt Hollow Rd', 'mount hollow road'], ['forest', 'forest']])('%s → %s', (input, key) => {
    expect(normalizePlace(input).key).toBe(key);
  });
  it.each([['Main St', 'main street'], ['mainst', 'MAIN ST!!!'], ['cvs main street', 'main street'], ['maple ave', 'Maple Avenue'], ['mapel avenue', 'maple avenue'], ['maple ave and 4th', 'maple avenue'], ['Brightwater Mall', 'the brightwater mall']])('matches %s ~ %s', (a, b) => {
    expect(match(a, b)).toBe(true);
  });
  it.each([['main street', 'main mall'], ['maple avenue', 'oak avenue'], ['brightwater mall', 'brightwater park'], ['17 gullhaven road', 'brightwater mall'], ['1st street', '2nd street']])('keeps %s and %s apart', (a, b) => {
    expect(match(a, b)).toBe(false);
  });
  it('implements Jaro-Winkler', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });
});
