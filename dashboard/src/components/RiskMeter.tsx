import { useLayoutEffect, useRef, useState } from 'react';
import type { RiskState } from '../socket';

export interface RiskSample { at: number; score: number }
export const HISTORY_MS = 5 * 60_000;
const parts: [keyof RiskState['components'], string][] = [['triangulation', 'Triangulation'], ['chat', 'Chat'], ['raid', 'Raid'], ['exposure', 'Exposure']];
// Gridlines sit on the level boundaries (§10), so the chart's bands are the levels themselves.
const bands = [{ at: 12.5, name: 'Quiet' }, { at: 37.5, name: 'Few flies' }, { at: 62.5, name: 'Buzzing' }, { at: 87.5, name: 'Swarm' }];

/** The breakdown behind the score: the last 5 minutes and the four components. Shown on request. */
export function RiskDetails({ risk, history, now, exposureConnected }: { risk: RiskState; history: RiskSample[]; now: number; exposureConnected: boolean }) {
  return <div className="risk-details">
    <Timeline history={history} now={now} />
    <dl className="parts">
      {parts.map(([key, label]) => {
        const off = key === 'exposure' && !exposureConnected;
        return <div key={key}><dt>{label}</dt><dd className={`track${off ? ' off' : ''}`} aria-hidden="true"><span style={{ width: `${risk.components[key]}%` }} /></dd><dd className="num">{off ? '–' : Math.round(risk.components[key])}</dd></div>;
      })}
    </dl>
    {risk.questionPressure > 1 && <p className="note">{risk.questionPressure} chatters asked where you are in the last 2 minutes.</p>}
    {!exposureConnected && <p className="note">Exposure needs OBS, which is not connected.</p>}
  </div>;
}

function Timeline({ history, now }: { history: RiskSample[]; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const height = 120, left = 24, right = 72, top = 6, bottom = 20;
  const plotW = Math.max(0, width - left - right), plotH = height - top - bottom;
  const x = (at: number) => left + plotW * (1 - (now - at) / HISTORY_MS);
  const y = (score: number) => top + plotH * (1 - score / 100);
  const points = history.filter(s => now - s.at <= HISTORY_MS);
  const path = points.map((s, i) => `${i ? 'L' : 'M'}${x(s.at).toFixed(1)},${y(s.score).toFixed(1)}`).join('');
  const last = points.at(-1);
  return <div className="timeline" ref={ref}>
    {width > 0 && <svg width={width} height={height} role="img" aria-label={last ? `Risk over the last 5 minutes, now ${Math.round(last.score)}` : 'No risk history yet'}>
      {[25, 50, 75, 100].map(v => <line key={v} x1={left} x2={left + plotW} y1={y(v)} y2={y(v)} stroke="var(--hair)" />)}
      <line x1={left} x2={left + plotW} y1={y(0)} y2={y(0)} stroke="var(--hair-2)" />
      {[0, 50, 100].map(v => <text key={v} x={left - 8} y={y(v) + 4} textAnchor="end">{v}</text>)}
      {bands.map(b => <text key={b.name} x={left + plotW + 12} y={y(b.at) + 4}>{b.name}</text>)}
      {(plotW < 360 ? [4, 2, 0] : [5, 4, 3, 2, 1, 0]).map(m => <text key={m} x={x(now - m * 60_000)} y={height - 4} textAnchor={m === 5 ? 'start' : m === 0 ? 'end' : 'middle'}>{m ? `−${m}m` : 'now'}</text>)}
      {path && <path d={path} fill="none" stroke="var(--level)" strokeWidth="1.2" strokeLinejoin="round" />}
      {last && <circle cx={x(last.at)} cy={y(last.score)} r="2.5" fill="var(--level)" />}
    </svg>}
  </div>;
}
