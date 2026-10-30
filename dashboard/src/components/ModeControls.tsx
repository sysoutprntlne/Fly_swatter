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
    <p><span className="who">{modeInfo[mode].name}.</span> {modeInfo[mode].detail}{demo ? ' In practice mode nothing is really deleted.' : ''}</p>
    <label className="switch-row"><input type="checkbox" role="switch" checked={settings.swatAllGuesses} onChange={e => { onError(''); post('/api/settings', { swatAllGuesses: e.target.checked }).catch((err: Error) => onError(err.message)); }} />
      <span><span className="who">Delete every guess</span><span className="muted">Deletes all guesses, even single ones, so viewers can't tell which guess was right from what gets deleted. Some harmless messages may go too.</span></span></label>
    <dl className="kv">
      <div><dt>Detection</dt><dd>{!ai ? '–' : !ai.enabled ? 'Basic word rules (no AI key added)' : ai.budgetReached ? 'AI limit reached for this minute, using basic rules' : ai.healthy ? 'AI' : 'AI unavailable, using basic rules'}</dd></div>
      <div><dt>Permission to delete</dt><dd>{demo ? 'Not needed for practice' : moderationAuthorized ? 'Given' : 'Not given yet'}</dd></div>
      {warnings.map(w => <div key={w}><dt>Setup</dt><dd>{w}</dd></div>)}
    </dl>
    {mode !== 'observe' && !demo && !moderationAuthorized && <p className="alert" role="alert">Fly Swatter can't delete messages until you give it permission. {loginUrl && <a href={loginUrl}>Reconnect Twitch</a>}</p>}
  </div>;
}
