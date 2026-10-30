import type { RiskLevel } from '../socket';
// Original artwork, drawn for Fly Swatter. Everything takes currentColor so it follows the theme.

/** Swatty: a fly swatter with a mesh head and a face, drawn as hairline wire. One pose per risk level. */
export function Mascot({ mood, size = 64 }: { mood: RiskLevel; size?: number }) {
  const tilt = mood === 'swarm' ? -14 : mood === 'buzzing' ? -6 : 0;
  const open = mood !== 'quiet';
  const look = mood === 'few_flies' ? 2 : 0;
  const sw = size < 40 ? 2.2 : 1.4;   // keep the line near one device pixel at every size
  return <svg className={`mascot mood-${mood}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`Swatty is ${mood === 'quiet' ? 'relaxed' : mood === 'few_flies' ? 'watching' : mood === 'buzzing' ? 'ready to swat' : 'swatting'}`}
    fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {mood === 'swarm' && <path d="M6 14h7M4 22h8M6 30h6" opacity=".5" />}
    <g transform={`rotate(${tilt} 32 50)`}>
      <path d="M30 39v20h4V39" />
      <rect x="15" y="5" width="34" height="34" rx="13" />
      <clipPath id={`mesh-${mood}-${size}`}><rect x="16" y="6" width="32" height="32" rx="12" /></clipPath>
      <g clipPath={`url(#mesh-${mood}-${size})`} strokeWidth={sw * .5} opacity=".35">
        <path d="M23 5v34M29 5v34M35 5v34M41 5v34M15 13h34M15 19h34M15 25h34M15 31h34" />
      </g>
      {open
        ? <g fill="currentColor" stroke="none"><circle cx={25 + look} cy="21" r="2.2" /><circle cx={39 + look} cy="21" r="2.2" /></g>
        : <path d="M22 21q3 2.5 6 0M36 21q3 2.5 6 0" />}
      {(mood === 'buzzing' || mood === 'swarm') && <path d="M21 15l7 2.5M43 15l-7 2.5" />}
      {mood === 'swarm' ? <ellipse cx="32" cy="30" rx="3" ry="2.4" /> : <path d={mood === 'quiet' ? 'M28 29q4 3 8 0' : 'M28.5 30h7'} />}
      <path d={mood === 'buzzing' || mood === 'swarm' ? 'M30 46l-7-7M34 46l7-5' : 'M30 47l-6 3M34 47l6 3'} />
    </g>
  </svg>;
}

/** A snoop fly in wire: two lattice wings, a segmented body, two eyes, six legs. */
export function Fly({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth=".8" strokeLinecap="round">
    <ellipse cx="7.2" cy="8.6" rx="5.2" ry="3" transform="rotate(-30 7.2 8.6)" opacity=".7" />
    <ellipse cx="16.8" cy="8.6" rx="5.2" ry="3" transform="rotate(30 16.8 8.6)" opacity=".7" />
    <path d="M4.6 9.8l5-1.6M19.4 9.8l-5-1.6" opacity=".45" />
    <ellipse cx="12" cy="14.6" rx="3.2" ry="5" />
    <path d="M9.2 13.4h5.6M9 15.6h6M9.5 17.8h5" opacity=".6" />
    <circle cx="10.4" cy="9.6" r="1.5" /><circle cx="13.6" cy="9.6" r="1.5" />
    <path d="M9 12.6l-3-1.4-1 1.6M9 14.8l-3.4.6-.8 1.6M9.4 17l-2.6 2-.2 1.6M15 12.6l3-1.4 1 1.6M15 14.8l3.4.6.8 1.6M14.6 17l2.6 2 .2 1.6" opacity=".75" />
  </svg>;
}

export function Pin({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
    <path d="M12 2.5a7 7 0 0 0-7 7c0 5.2 7 12 7 12s7-6.8 7-12a7 7 0 0 0-7-7z" />
    <circle cx="12" cy="9.5" r="2.4" />
    <path d="M12 1v3M12 15v2M3 9.5h2M19 9.5h2" opacity=".5" />
  </svg>;
}

/** One shape per level: ring, dot, diamond, triangle. */
export function LevelMark({ level }: { level: RiskLevel }) {
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
    {level === 'quiet' && <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />}
    {level === 'few_flies' && <circle cx="6" cy="6" r="4.5" />}
    {level === 'buzzing' && <path d="M6 .8 11.2 6 6 11.2.8 6z" />}
    {level === 'swarm' && <path d="M6 .8 11.5 11H.5z" />}
  </svg>;
}
