import { useEffect, useRef } from 'react';
import type { RiskState } from '../socket';
import { buildFly } from './flyGeometry';

// The specimen: a wireframe housefly that stands for the snoops in chat. It is ghostly and slow when
// chat is quiet, and its wire brightens and it turns faster as the risk score climbs. Under the
// pointer the plate lifts like a lamp, and the corner readout reports the real pixel beneath it.
const CAM = 26, BUCKETS = 26, LIFT = 1.3, A_FAR = .04;
const DEFAULT = { yaw: -.62, pitch: .32 };
const HINT = '';   // the grab cursor says it; nothing shows until the pointer is over the fly

export function SpecimenFly({ risk }: { risk: RiskState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const scoreRef = useRef(risk.score);
  useEffect(() => { scoreRef.current = risk.score; }, [risk.score]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const fly = buildFly(2);
    if (probeRef.current) probeRef.current.textContent = HINT;
    const paths: Path2D[] = [];
    const s = { yaw: DEFAULT.yaw, pitch: DEFAULT.pitch, userPitch: 0, yawVel: 0, pitchVel: 0, par: [0, 0], parT: [0, 0], t: 0, reveal: reduce.matches ? 1 : 0, aNear: .26 };
    const light = { x: 0, y: 0, tx: 0, ty: 0, on: 0, onT: 0 };
    let W = 0, H = 0, dpr = 1, scale = 1, ink = '229,228,224', ground = '#121211';
    let pointer: { x: number; y: number } | null = null, dragging = false, px = 0, py = 0, pt = 0, raf = 0, last = performance.now(), lastReadout = 0;

    const readTheme = () => {
      const cs = getComputedStyle(canvas);
      ink = cs.getPropertyValue('--ink-rgb').trim() || ink;
      ground = cs.getPropertyValue('--ground').trim() || ground;
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scale = Math.min(W * .84, H * 1.0) / (fly.radius * 2);   // the side-on view, wings and legs included, stays inside the plate
      readTheme();
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const scheme = matchMedia('(prefers-color-scheme: light)');
    scheme.addEventListener('change', readTheme);

    const draw = () => {
      const { edges, count, radius } = fly;
      const yaw = s.yaw + s.par[0]!, pitch = s.pitch + s.userPitch + s.par[1]!;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cx0 = W / 2, cy0 = H * .52, f = scale * CAM, aMax = s.aNear * 1.15 * (1 + LIFT);
      const ease = 1 - Math.pow(1 - Math.min(1, s.reveal), 4);
      ctx.fillStyle = ground; ctx.fillRect(0, 0, W, H);
      const R = Math.min(W, H) * .36, s2 = 2 * (R * .42) ** 2;
      if (light.on > .002) {
        const g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, R);
        g.addColorStop(0, `rgba(${ink},${(.056 * light.on).toFixed(4)})`);
        g.addColorStop(.45, `rgba(${ink},${(.022 * light.on).toFixed(4)})`);
        g.addColorStop(1, `rgba(${ink},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      for (let b = 0; b < BUCKETS; b++) paths[b] = new Path2D();
      for (let i = 0; i < count; i++) {
        const o = i * 8, w = edges[o + 6]!;
        const vis = Math.min(1, Math.max(0, (ease * 1.25 - edges[o + 7]!) * 5));
        if (vis <= 0) continue;
        const x1 = edges[o]! * cy + edges[o + 2]! * sy, z1 = -edges[o]! * sy + edges[o + 2]! * cy, y1 = edges[o + 1]!;
        const x2 = edges[o + 3]! * cy + edges[o + 5]! * sy, z2 = -edges[o + 3]! * sy + edges[o + 5]! * cy, y2 = edges[o + 4]!;
        const Y1 = y1 * cp - z1 * sp, Z1 = y1 * sp + z1 * cp, Y2 = y2 * cp - z2 * sp, Z2 = y2 * sp + z2 * cp;
        const k1 = f / (CAM - Z1), k2 = f / (CAM - Z2);
        const sx1 = cx0 + x1 * k1, sy1 = cy0 - Y1 * k1, sx2 = cx0 + x2 * k2, sy2 = cy0 - Y2 * k2;
        const depth = Math.min(1, Math.max(0, ((Z1 + Z2) / 2 + radius) / (2 * radius)));
        let a = (A_FAR + (s.aNear - A_FAR) * Math.pow(depth, 1.5)) * w * vis;
        if (light.on > .002) { const dx = (sx1 + sx2) / 2 - light.x, dy = (sy1 + sy2) / 2 - light.y; a *= 1 + LIFT * light.on * Math.exp(-(dx * dx + dy * dy) / s2); }
        const b = Math.min(BUCKETS - 1, Math.floor(a / aMax * BUCKETS));
        if (b < 0) continue;
        paths[b]!.moveTo(sx1, sy1); paths[b]!.lineTo(sx2, sy2);
      }
      ctx.lineWidth = .7; ctx.lineCap = 'round';
      for (let b = 0; b < BUCKETS; b++) { ctx.strokeStyle = `rgba(${ink},${((b + .5) / BUCKETS * aMax).toFixed(3)})`; ctx.stroke(paths[b]!); }
    };

    const readout = () => {
      if (pointer && probeRef.current) {
        const [r, g, b] = ctx.getImageData(Math.min(canvas.width - 1, Math.round(pointer.x * dpr)), Math.min(canvas.height - 1, Math.round(pointer.y * dpr)), 1, 1).data;
        const hex = '#' + [r, g, b].map(v => (v ?? 0).toString(16).padStart(2, '0')).join('').toUpperCase();
        const pad = (v: number) => String(Math.round(v)).padStart(4, '0');
        probeRef.current.textContent = `X ${pad(pointer.x)}  Y ${pad(pointer.y)}  |  PX_VAL ${hex}`;
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now; s.t += dt;
      const score = scoreRef.current, still = reduce.matches;
      if (s.reveal < 1) s.reveal = Math.min(1, s.reveal + dt / 2.2);
      // risk drives the specimen: brighter wire and a faster turn as chat closes in
      s.aNear += (.26 + .3 * score / 100 - s.aNear) * (1 - Math.exp(-dt * 1.5));
      if (!still && !dragging) s.yaw += (.12 + .5 * score / 100) * dt;
      if (!still) s.pitch = DEFAULT.pitch + .12 * Math.sin(s.t * .27);
      if (!dragging) {
        s.yaw += s.yawVel * dt; s.userPitch += s.pitchVel * dt;
        const damp = Math.exp(-dt * 2.6); s.yawVel *= damp; s.pitchVel *= damp;
      }
      s.userPitch = Math.max(-.9, Math.min(.9, s.userPitch));
      const k = 1 - Math.exp(-dt * 2.2);
      s.par[0]! += (s.parT[0]! - s.par[0]!) * k; s.par[1]! += (s.parT[1]! - s.par[1]!) * k;
      const kl = 1 - Math.exp(-dt * 9), ko = 1 - Math.exp(-dt * 3.5);
      light.x += (light.tx - light.x) * kl; light.y += (light.ty - light.y) * kl; light.on += (light.onT - light.on) * ko;
      draw();
      if (now - lastReadout > 100) { lastReadout = now; readout(); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(t => { last = t; raf = requestAnimationFrame(frame); });

    const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const move = (e: PointerEvent) => {
      pointer = local(e);
      light.tx = pointer.x; light.ty = pointer.y; light.onT = 1;
      if (light.on < .01) { light.x = light.tx; light.y = light.ty; }
      if (!reduce.matches) s.parT = [(pointer.x / W - .5) * .42, (pointer.y / H - .5) * .22];
      if (!dragging) return;
      const now = performance.now(), dt = Math.max(.008, (now - pt) / 1000);
      const dx = (e.clientX - px) * .0085, dy = (e.clientY - py) * .0065;
      s.yaw += dx; s.userPitch = Math.max(-.9, Math.min(.9, s.userPitch + dy));
      s.yawVel = s.yawVel * .6 + dx / dt * .4; s.pitchVel = s.pitchVel * .6 + dy / dt * .4;
      px = e.clientX; py = e.clientY; pt = now;
    };
    const leave = () => { pointer = null; light.onT = 0; s.parT = [0, 0]; if (probeRef.current) probeRef.current.textContent = HINT; };
    const down = (e: PointerEvent) => { dragging = true; px = e.clientX; py = e.clientY; pt = performance.now(); s.yawVel = s.pitchVel = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); };
    const up = () => { dragging = false; canvas.classList.remove('dragging'); };
    const key = (e: KeyboardEvent) => {
      const step = e.shiftKey ? .35 : .12;
      if (e.key === 'ArrowLeft') s.yaw -= step; else if (e.key === 'ArrowRight') s.yaw += step;
      else if (e.key === 'ArrowUp') s.userPitch = Math.max(-.9, s.userPitch - step);
      else if (e.key === 'ArrowDown') s.userPitch = Math.min(.9, s.userPitch + step);
      else return;
      e.preventDefault();
    };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); scheme.removeEventListener('change', readTheme);
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('keydown', key);
    };
  }, []);

  return <section className="hero" aria-labelledby="specimen-heading">
    <div className="specimen-title">
      <h2 id="specimen-heading">Fly Swatter</h2>
      <p>Twitch × Codex Hackathon 2026</p>
    </div>
    <canvas ref={canvasRef} tabIndex={0} role="img" aria-label={`Wireframe housefly turning ${risk.score >= 50 ? 'quickly' : 'slowly'}; its wire brightens as the risk score rises. Drag or use the arrow keys to turn it.`} />
    <p className="num probe" ref={probeRef} aria-hidden="true" />
  </section>;
}
