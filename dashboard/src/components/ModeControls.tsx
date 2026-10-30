import { modeInfo } from '../labels';
import { post, type AiStatus, type Mode, type Settings } from '../socket';
const modes: Mode[] = ['observe', 'assist', 'guardian'];

/** Mode switch: the most frequent job, one click away. Each mode's meaning is its tooltip and in Settings. */
export function ModeSwitch({ mode, onError }: { mode: Mode; onError: (message: string) => void }) {
  return <div role="radiogroup" aria-label="Mode" className="tabs">
    {modes.map(m => <button key={m} type="button" role="radio" aria-checked={mode === m} title={modeInfo[m].detail}
      onClick={() => { onError(''); post('/api/mode', { mode: m }).catch((e: Error) => onError(e.message)); }}>{modeInfo[m].name}</button>)}
  </div>;
}

/** Settings, shown on request: what the mode does, the swat-all switch, and the connections behind it. */
export function ResponsePanel({ mode, settings, ai, moderationAuthorized, demo, loginUrl, warnings, onError }: { mode: Mode; settings: Settings; ai?: AiStatus; moderationAuthorized: boolean; demo: boolean; loginUrl?: string; warnings: string[]; onError: (message: string) => void }) {
  return <div className="settings">
    <p><span className="who">{modeInfo[mode].name}.</span> {modeInfo[mode].detail}{demo ? ' In demo, every action is a dry run.' : ''}</p>
    <label className="switch-row"><input type="checkbox" role="switch" checked={settings.swatAllGuesses} onChange={e => { onError(''); post('/api/settings', { swatAllGuesses: e.target.checked }).catch((err: Error) => onError(err.message)); }} />
      <span><span className="who">Swat all guesses</span><span className="muted">Delete every guess, so deletions never hint which one chat agrees on. More false deletions.</span></span></label>
    <dl className="kv">
      <div><dt>Classifier</dt><dd>{ai?.message ?? '–'}</dd></div>
      <div><dt>Moderation</dt><dd>{demo ? 'Not needed in demo' : moderationAuthorized ? 'Granted' : 'Missing'}</dd></div>
      {warnings.map(w => <div key={w}><dt>Note</dt><dd>{w}</dd></div>)}
    </dl>
    {mode !== 'observe' && !demo && !moderationAuthorized && <p className="alert" role="alert">Without moderation permission, deletions will fail. {loginUrl && <a href={loginUrl}>Reconnect Twitch</a>}</p>}
  </div>;
}
