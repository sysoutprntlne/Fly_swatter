// Procedural housefly (Musca domestica) in millimetres, shared by the dashboard specimen.
// +x right, +y up, +z toward the head. Each edge is [x1, y1, z1, x2, y2, z2, weight, revealOrder] in a Float32Array.
export type Level = 1 | 2 | 3;
export interface Fly { edges: Float32Array; count: number; radius: number }
type V = [number, number, number];
type Edge = [number, number, number, number, number, number, number];
const TAU = Math.PI * 2;

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

export function buildFly(level: Level): Fly {
  const E: Edge[] = [];
  const seg = (a: V, b: V, w = 1) => E.push([a[0], a[1], a[2], b[0], b[1], b[2], w]);
  const line = (pts: V[], w = 1, closed = false) => { for (let i = 1; i < pts.length; i++) seg(pts[i - 1]!, pts[i]!, w); if (closed) seg(pts[pts.length - 1]!, pts[0]!, w); };
  const mirror = (p: V): V => [-p[0], p[1], p[2]];
  const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
  const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a: V): V => mul(a, 1 / (len(a) || 1));
  const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const lerp = (a: V, b: V, t: number): V => add(a, mul(sub(b, a), t));
  const L = level;
  const pick = (a: number[]) => a[L - 1]!;   // per-density value                       // 1 sparse, 2 standard, 3 dense + setae
  const ring = [12, 20, 32][L - 1]!;

  // Ellipsoid as rings around its long axis (z) and meridians along it: reads like a lofted body.
  function ellipsoid(c: V, r: V, rings: number, meridians: number, w = 1) {
    const pt = (phi: number, th: number): V => [c[0] + r[0] * Math.cos(phi) * Math.cos(th), c[1] + r[1] * Math.cos(phi) * Math.sin(th), c[2] + r[2] * Math.sin(phi)];
    for (let i = 1; i < rings; i++) {
      const phi = -Math.PI / 2 + Math.PI * i / rings, pts: V[] = [];
      for (let k = 0; k < ring; k++) pts.push(pt(phi, TAU * k / ring));
      line(pts, w, true);
    }
    for (let j = 0; j < meridians; j++) {
      const th = TAU * j / meridians, pts: V[] = [];
      for (let k = 0; k <= ring / 2; k++) pts.push(pt(-Math.PI / 2 + Math.PI * k / (ring / 2), th));
      line(pts, w * .8);
    }
  }

  // Icosphere: the compound eye's facets.
  function icosphere(c: V, r: V, detail: number, w = 1) {
    const t = (1 + Math.sqrt(5)) / 2;
    const v: V[] = ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as V[]).map(norm);
    let f: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let d = 0; d < detail; d++) {
      const cache = new Map<string, number>(), nf: [number, number, number][] = [];
      const mid = (a: number, b: number): number => { const k = a < b ? a + '_' + b : b + '_' + a; if (!cache.has(k)) { cache.set(k, v.length); v.push(norm(lerp(v[a]!, v[b]!, .5))); } return cache.get(k)!; };
      for (const [a, b, cc] of f) { const ab = mid(a, b), bc = mid(b, cc), ca = mid(cc, a); nf.push([a, ab, ca], [b, bc, ab], [cc, ca, bc], [ab, bc, ca]); }
      f = nf;
    }
    const seen = new Set<string>(), P = v.map((p): V => [c[0] + p[0] * r[0], c[1] + p[1] * r[1], c[2] + p[2] * r[2]]);
    for (const tri of f) for (let i = 0; i < 3; i++) {
      const a = tri[i]!, b = tri[(i + 1) % 3]!, k = a < b ? a + '_' + b : b + '_' + a;
      if (!seen.has(k)) { seen.add(k); seg(P[a]!, P[b]!, w); }
    }
  }

  // A small ring perpendicular to a direction: joints, the labellum, haltere knobs.
  function hoop(c: V, dir: V, r: number, n: number, w: number) {
    const d = norm(dir), u = norm(cross(d, Math.abs(d[1]) > .9 ? [1, 0, 0] : [0, 1, 0])), v = cross(d, u), pts: V[] = [];
    for (let k = 0; k < n; k++) { const a = TAU * k / n; pts.push(add(c, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r)))); }
    line(pts, w, true);
  }

  // A tube through joint points: leg segments as thin wire cylinders with rims at each joint.
  function tube(joints: V[], radii: number[], sides: number, w: number) {
    const rims = joints.map((p, i) => {
      const d = norm(sub(joints[Math.min(i + 1, joints.length - 1)]!, joints[Math.max(i - 1, 0)]!));
      const u = norm(cross(d, Math.abs(d[1]) > .9 ? [1, 0, 0] : [0, 1, 0])), v = cross(d, u);
      return Array.from({ length: sides }, (_, k) => { const a = TAU * k / sides; return add(p, add(mul(u, Math.cos(a) * radii[i]!), mul(v, Math.sin(a) * radii[i]!))); });
    });
    rims.forEach((rim, i) => { if (i > 0 && i < rims.length - 1 || L > 1) line(rim, w, true); });
    for (let k = 0; k < sides; k++) line(rims.map(r => r[k]!), w * .85);
  }

  // ---- Head: a wide capsule, the two faceted eyes, antennae, proboscis.
  ellipsoid([0, .2, 2.7], [1.2, 1.0, .68], pick([5, 7, 9]), pick([8, 12, 16]), .9);
  for (const s of [1, -1]) icosphere([.8 * s, .34, 2.84], [.6, .84, .56], pick([1, 2, 3]), .75);
  for (const s of [1, -1]) {
    const a0: V = [.16 * s, .62, 3.28], a1: V = [.24 * s, .52, 3.52], a2: V = [.3 * s, .2, 3.6];
    line([a0, a1, a2], 1.1); hoop(a2, sub(a2, a1), .07, 6, .8);
    line([a2, [.52 * s, .5, 3.82], [.62 * s, .86, 3.86]], .55);          // arista
  }
  const pr: V[] = [[0, -.36, 3.0], [0, -.86, 3.22], [0, -1.28, 3.18]];
  tube(pr, [.13, .11, .09], pick([4, 5, 6]), .9);
  hoop([0, -1.34, 3.18], [0, 1, 0], .3, 12, 1); hoop([0, -1.34, 3.18], [0, 1, 0], .18, 10, .7);

  // ---- Thorax: domed, with a scutellum over the wing roots.
  ellipsoid([0, .32, 1.0], [1.12, 1.05, 1.42], pick([7, 9, 13]), pick([10, 14, 20]), 1);
  ellipsoid([0, 1.12, -.2], [.62, .28, .42], pick([3, 4, 6]), pick([6, 8, 12]), .8);

  // ---- Abdomen: five tergites, lofted. Segment rims are heavier than the in-between rings.
  const S: [number, number, number, number][] = [[-.25, .78, .68, .2], [-.95, 1.24, .98, .12], [-1.75, 1.34, 1.02, .06], [-2.55, 1.2, .9, .02], [-3.25, .86, .66, .0], [-3.72, .32, .28, .02], [-3.86, .02, .02, .04]];
  const steps = [1, 2, 3][L - 1]!;
  const prof: { z: number; rx: number; ry: number; y: number; rim: boolean }[] = [];
  for (let i = 0; i < S.length - 1; i++) for (let k = 0; k < steps; k++) {
    const t = k / steps, a = S[i]!, b = S[i + 1]!, e = t * t * (3 - 2 * t);
    prof.push({ z: a[0] + (b[0] - a[0]) * t, rx: a[1] + (b[1] - a[1]) * e, ry: a[2] + (b[2] - a[2]) * e, y: a[3] + (b[3] - a[3]) * t, rim: k === 0 });
  }
  const tip = S[S.length - 1]!;
  prof.push({ z: tip[0], rx: tip[1], ry: tip[2], y: tip[3], rim: true });
  const ab = prof.map(p => Array.from({ length: ring }, (_, k): V => { const a = TAU * k / ring; return [p.rx * Math.cos(a), p.y + p.ry * Math.sin(a), p.z]; }));
  ab.forEach((r, i) => { if (prof[i]!.rx > .05) line(r, prof[i]!.rim ? 1.15 : .55, true); });
  const lon = [8, 12, 16][L - 1]!;
  for (let k = 0; k < lon; k++) line(ab.map(r => r[Math.round(k * ring / lon) % ring]!), .7);

  // ---- Wings: membrane outline, five veins fanned from the root, cross-veins, and at density 3 a fine lattice.
  function wing(s: number) {
    const root: V = [.56 * s, 1.22, 1.3];
    const d = norm([.5 * s, -.1, -1]);                     // spread back and out
    const across = norm(cross([0, 1, 0], d));               // in-plane, perpendicular to the span
    const lift = norm(cross(d, across));
    const WL = 5.6, WW = 2.0;
    const P = (u: number, t: number): V => { // u along the span 0..1, t across -1..1 (leading edge +)
      const half = WW * .5 * Math.pow(Math.sin(Math.PI * Math.min(1, u * .96 + .04)), .62) * (1 - .18 * u);
      const sag = -.35 * u * u - .12 * Math.abs(t) * u;     // tip droops, edges curl
      return add(root, add(mul(d, WL * u), add(mul(across, -half * t * s), mul(lift, sag + .05 * t))));
    };
    const n = [24, 36, 56][L - 1]!, out: V[] = [];
    for (let k = 0; k <= n; k++) out.push(P(k / n, 1));
    for (let k = n; k >= 0; k--) out.push(P(k / n, -1));
    line(out, .7, true);
    const veins = [.78, .42, .08, -.3, -.66];
    const vein = (t: number) => { const pts: V[] = []; for (let k = 0; k <= n; k++) { const u = k / n * (.98 - .06 * Math.abs(t)); pts.push(P(u, t * Math.min(1, .25 + u * 1.4))); } return pts; };
    veins.forEach(t => line(vein(t), .62));
    for (const [u, a, b] of [[.36, .42, .08], [.58, .08, -.3], [.7, -.3, -.66]] as V[]) line([P(u, a * Math.min(1, .25 + u * 1.4)), P(u + .03, b * Math.min(1, .25 + (u + .03) * 1.4))], .62);
    const lat = [0, 6, 14][L - 1]!;                         // translucent lattice
    for (let i = 1; i <= lat; i++) { const u = i / (lat + 1), pts: V[] = []; for (let k = 0; k <= 12; k++) pts.push(P(u, -1 + 2 * k / 12)); line(pts, .28); }
    if (L === 3) for (let i = 1; i < 10; i++) { const t = -1 + i / 5, pts: V[] = []; for (let k = 2; k <= n; k++) pts.push(P(k / n, t)); line(pts, .2); }
    // haltere: stalk and knob behind the wing
    const h0: V = [.62 * s, .86, .08], h1: V = [.84 * s, .62, -.18];
    line([h0, h1], .9); icosphere(h1, [.1, .1, .1], 1, .7);
  }
  wing(1); wing(-1);

  // ---- Legs: coxa, femur, tibia, five tarsomeres, two claws. Angular, as a pinned specimen holds them.
  const legs: V[][] = [
    [[.5, -.42, 1.85], [.66, -1.0, 2.2], [1.55, -.62, 3.0], [1.86, -2.0, 3.6], [2.06, -2.26, 4.42]],
    [[.66, -.55, 1.05], [.92, -1.04, 1.1], [2.38, -.46, 1.02], [3.0, -2.0, .8], [3.64, -2.26, .66]],
    [[.6, -.5, .32], [.86, -1.0, .02], [1.98, -.52, -1.28], [2.48, -2.0, -2.4], [2.8, -2.26, -3.24]],
  ];
  const sides = [3, 4, 6][L - 1]!;
  for (const leg of legs) for (const s of [1, -1]) {
    const J = leg.map(p => s > 0 ? p : mirror(p));
    tube(J.slice(0, 4), [.12, .11, .085, .06], sides, .85);
    const t0 = J[3]!, t1 = J[4]!, tars: V[] = [];
    for (let k = 0; k <= 5; k++) tars.push(lerp(t0, t1, k / 5));
    line(tars, .9);
    if (L > 1) for (let k = 1; k < 5; k++) hoop(tars[k]!, sub(t1, t0), .045, 5, .6);
    const dir = norm(sub(t1, t0)), side = norm(cross(dir, [0, 1, 0]));
    seg(t1, add(add(t1, mul(dir, .16)), mul(side, .09)), .8);
    seg(t1, add(add(t1, mul(dir, .16)), mul(side, -.09)), .8);
  }

  // ---- Setae (density 3): short bristles along the thorax and abdomen normals.
  if (L === 3) {
    const r = rng(7);
    for (let i = 0; i < 140; i++) {
      const phi = (r() * .9 + .05) * Math.PI / 2, th = (r() * .8 + .1) * Math.PI, onThorax = i < 90;
      const c: V = onThorax ? [0, .32, 1.0] : [0, .08, -1.8], R: V = onThorax ? [1.12, 1.05, 1.42] : [1.3, 1.0, 1.6];
      const n0: V = [Math.cos(phi) * Math.cos(th), Math.sin(th) * Math.cos(phi) * .2 + Math.sin(phi) * .98, Math.cos(phi) * Math.sin(th) * .6 - .3];
      const p: V = [c[0] + R[0] * Math.cos(th) * Math.cos(phi), c[1] + R[1] * Math.sin(phi), c[2] + R[2] * (r() * 1.4 - .7)];
      seg(p, add(p, mul(norm(add(n0, [0, 0, -.6])), .28 + r() * .26)), .5);
    }
  }

  // Centre the specimen on its own bounds.
  const mn: V = [1e9, 1e9, 1e9], mx: V = [-1e9, -1e9, -1e9];
  for (const e of E) for (let o = 0; o < 6; o += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a]!, e[o + a]!); mx[a] = Math.max(mx[a]!, e[o + a]!); }
  const c = mul(add(mn, mx), .5);
  const out = new Float32Array(E.length * 8);
  E.forEach((e, i) => {
    for (let a = 0; a < 3; a++) { out[i * 8 + a] = e[a]! - c[a]!; out[i * 8 + 3 + a] = e[3 + a]! - c[a]!; }
    out[i * 8 + 6] = e[6]!;
    // reveal order: distance of the edge's midpoint from the thorax, so the wire draws outward from the body
    const m = [(e[0]! + e[3]!) / 2, (e[1]! + e[4]!) / 2, (e[2]! + e[5]!) / 2] as V;
    out[i * 8 + 7] = Math.min(1, Math.hypot(m[0], m[1] - .3, m[2] - 1) / 6.2);
  });
  return { edges: out, count: E.length, radius: Math.max(...mx.map((v, a) => v - c[a]!)) };
}
