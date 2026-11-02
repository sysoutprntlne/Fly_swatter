import { useEffect, useState, type FormEvent } from 'react';
import { post, type DemoScenarioSummary, type DemoSpeed, type DemoState, type RaidEvent } from '../socket';

const speeds: DemoSpeed[] = [0.5, 1, 2];
/** Slim strip under the top bar: scenario playback and "type as a viewer", kept on the first screen for live pitches. */
export function DemoControls({ state, raid, onError }: { state: DemoState; raid?: RaidEvent; onError: (message: string) => void }) {
  const [scenarios, setScenarios] = useState<DemoScenarioSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [speed, setSpeed] = useState<DemoSpeed>(state.speed);
  const [user, setUser] = useState('curious_viewer');
  const [text, setText] = useState('');
  useEffect(() => {
    fetch('/api/demo/scenarios').then(r => r.json()).then((data: { scenarios: DemoScenarioSummary[] }) => {
      setScenarios(data.scenarios);
      setSelected(current => current || data.scenarios.find(s => s.name === 'IRL triangulation')?.name || data.scenarios[0]?.name || '');
    }).catch(() => onError('Could not load demo scenarios.'));
  }, [onError]);
  // Follow the scenario the server is playing, so the picker never names a different one.
  useEffect(() => { if (state.scenario) setSelected(state.scenario); }, [state.scenario]);
  useEffect(() => { setSpeed(state.speed); }, [state.speed]);
  const run = (url: string, body: unknown) => { onError(''); post(url, body).catch((e: Error) => onError(e.message)); };
  const changeSpeed = (next: DemoSpeed) => { setSpeed(next); if (state.playing && state.scenario) run('/api/demo/play', { name: state.scenario, speed: next }); };
  const inject = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onError('');
    post('/api/demo/inject', { user, text }).then(() => setText('')).catch((e: Error) => onError(e.message));
  };
  const resuming = state.scenario === selected && !state.playing && !state.finished && state.position > 0;
  return <section className="demo-strip" aria-label="Demo controls">
    <p className="demo-notice">Fictional chat. All moderation actions are practice; Twitch stays unchanged.</p>
    <select className="field" aria-label="Scenario" value={selected} onChange={e => setSelected(e.target.value)}>
      {scenarios.map(s => <option key={s.name} value={s.name}>{s.name} · {Math.round(s.durationMs / 1000)} s</option>)}
    </select>
    <div role="group" aria-label="Playback speed" className="tabs">
      {speeds.map(s => <button type="button" key={s} aria-pressed={speed === s} onClick={() => changeSpeed(s)}>{s}×</button>)}
    </div>
    {state.playing
      ? <button type="button" className="btn" onClick={() => run('/api/demo/pause', {})}>Pause</button>
      : <button type="button" className="btn" disabled={!selected} onClick={() => run('/api/demo/play', { name: selected, speed })}>{resuming ? 'Resume' : 'Play'}</button>}
    <button type="button" className="btn" onClick={() => run('/api/demo/reset', {})}>Reset</button>
    <span className="demo-progress num" role="status">{state.scenario ? `${state.finished ? 'Finished' : state.playing ? 'Playing' : 'Paused'}: ${state.position} of ${state.total} steps` : 'Pick a practice scenario'}{raid ? ` · a raid brought ${raid.viewers} viewers` : ''}</span>
    <form onSubmit={inject}>
      <input className="field name" aria-label="Viewer name" value={user} onChange={e => setUser(e.target.value)} maxLength={25} pattern="[A-Za-z0-9_]{1,25}" required />
      <input className="field text" aria-label="Type as a viewer" value={text} onChange={e => setText(e.target.value)} maxLength={500} placeholder="Type as a viewer" />
      <button type="submit" className="btn" disabled={!text.trim()}>Send</button>
    </form>
  </section>;
}
