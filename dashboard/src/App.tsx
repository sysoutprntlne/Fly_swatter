import { useEffect, useRef, useState } from 'react';
import { connectDashboard, post, type ActionRecord, type AiStatus, type ChatMessage, type ChatStatus, type DemoState, type Flagged, type Mode, type PipelineSnapshot, type PlaceCluster, type RaidEvent, type RiskState, type Settings } from './socket';
import { DemoControls } from './components/DemoControls';
import { HISTORY_MS, RiskDetails, type RiskSample } from './components/RiskMeter';
import { FlyFeed } from './components/FlyFeed';
import { SwarmView } from './components/SwarmView';
import { ActionLog } from './components/ActionLog';
import { ModeSwitch, ResponsePanel } from './components/ModeControls';
import { LevelMark, Mascot } from './components/Mascot';
import { SpecimenFly } from './components/SpecimenFly';
import { levelInfo, time } from './labels';
interface Health { ok: boolean; warnings: string[]; mascotName: string; loginUrl: string; swarmMinUsers: number; swarmMinScore: number }
interface AuthStatus { configured: boolean; connected: boolean; chatAuthorized: boolean; moderationAuthorized: boolean; login?: string; message: string }
const initialRisk: RiskState = { score: 0, level: 'quiet', components: { chat: 0, triangulation: 0, exposure: 0, raid: 0 }, questionPressure: 0, updatedAt: 0 };
type Tone = 'ok' | 'warn' | 'bad' | '';
export default function App() {
  const [health, setHealth] = useState<Health>();
  const [error, setError] = useState('');
  const [controlError, setControlError] = useState('');
  const [auth, setAuth] = useState<AuthStatus>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>({ state: 'waiting', message: 'Waiting for chat connection…' });
  const [socketConnected, setSocketConnected] = useState(false);
  const [demo, setDemo] = useState<DemoState>();
  const [raid, setRaid] = useState<RaidEvent>();
  const [risk, setRisk] = useState<RiskState>(initialRisk);
  const [flagged, setFlagged] = useState<Flagged[]>([]);
  const [clusters, setClusters] = useState<PlaceCluster[]>([]);
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [mode, setMode] = useState<Mode>('observe');
  const [settings, setSettings] = useState<Settings>({ swatAllGuesses: false });
  const [ai, setAi] = useState<AiStatus>();
  const [announcement, setAnnouncement] = useState('');
  // Risk history for the 5-minute timeline: sampled once a second from the latest score, kept in this tab only.
  const [now, setNow] = useState(() => Date.now());
  const [history, setHistory] = useState<RiskSample[]>([]);
  const latestScore = useRef(0);
  useEffect(() => { latestScore.current = risk.score; }, [risk.score]);
  useEffect(() => {
    const tick = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setHistory(previous => [...previous.filter(s => at - s.at <= HISTORY_MS), { at, score: latestScore.current }]);
    }, 1000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    const applyPipeline = (p: PipelineSnapshot) => { setRisk(p.risk); setFlagged(p.flagged); setClusters(p.clusters); setActions(p.actions); setMode(p.mode); setAi(p.ai); setSettings(p.settings); };
    return connectDashboard({
      onSnapshot: snapshot => { setMessages(snapshot.messages); setChatStatus(snapshot.status); setDemo(snapshot.demo); setRaid(snapshot.demo?.lastRaid); if (snapshot.pipeline) applyPipeline(snapshot.pipeline); },
      onMessage: message => setMessages(previous => [...previous.filter(item => item.id !== message.id), message].slice(-4000)),
      onStatus: setChatStatus,
      onReset: () => setMessages(previous => previous.filter(item => item.source === 'demo')),
      onConnection: setSocketConnected,
      onDemoState: state => { setDemo(state); if (!state.lastRaid) setRaid(undefined); },
      onDemoCleared: () => { setMessages(previous => previous.filter(item => item.source !== 'demo')); setRaid(undefined); },
      onRaid: setRaid,
      onFlagged: item => setFlagged(previous => [...previous, item].slice(-1000)),
      onClusters: setClusters,
      onRisk: setRisk,
      onAction: record => setActions(previous => [...previous, record].slice(-500)),
      onMode: setMode,
      onSettings: setSettings,
      onAiStatus: setAi,
      onPipelineReset: p => { applyPipeline(p); setHistory([]); },
    });
  }, []);
  useEffect(() => { setAnnouncement(`Risk level ${levelInfo[risk.level].name}`); }, [risk.level]);
  // After a click, a faint glow dissipates from the button's frame.
  useEffect(() => {
    const pulse = (e: MouseEvent) => { const b = (e.target as HTMLElement).closest('.btn'); if (!b) return; b.classList.remove('pulse'); void (b as HTMLElement).offsetWidth; b.classList.add('pulse'); };
    document.addEventListener('click', pulse);
    return () => document.removeEventListener('click', pulse);
  }, []);
  // The local session cookie authorizes dashboard controls (demo mode works without a Twitch login).
  useEffect(() => { void fetch('/api/session').catch(() => {}); }, []);
  const demoOn = Boolean(demo?.enabled);
  const feed = messages.filter(message => (message.source === 'demo') === demoOn);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Server unavailable');
      setHealth(await response.json() as Health);
    }).catch(() => { if (!controller.signal.aborted) setError('Cannot reach the local server. Start it with npm run dev.'); });
    const poll = async () => {
      try {
        const response = await fetch('/auth/status', { signal: controller.signal });
        if (!response.ok) throw new Error();
        setAuth(await response.json() as AuthStatus);
        setError('');
      } catch { if (!controller.signal.aborted) { setAuth(undefined); setError('Cannot reach the local server. Check that it is running.'); } }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 5000);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  const minUsers = health?.swarmMinUsers ?? 3;
  const connectLabel = !auth?.connected ? 'Connect Twitch' : !auth.chatAuthorized ? 'Enable chat reading' : !auth.moderationAuthorized ? 'Enable moderation' : undefined;
  // Connection state as one quiet line of words; only a problem earns a tone.
  const statuses: { label: string; tone: Tone }[] = [
    ...(demoOn ? [{ label: 'Demo', tone: 'warn' as Tone }] : []),
    !auth?.configured ? { label: 'Twitch off', tone: '' } : auth.connected ? { label: `@${auth.login}`, tone: '' } : { label: 'Twitch signed out', tone: 'warn' },
    !socketConnected ? { label: 'Offline', tone: 'bad' } : chatStatus.state === 'connected' ? { label: 'Chat live', tone: '' } : chatStatus.state === 'revoked' ? { label: 'Chat revoked', tone: 'bad' } : chatStatus.state === 'reconnecting' ? { label: 'Reconnecting', tone: 'warn' } : { label: 'Chat waiting', tone: '' },
    !ai ? { label: 'Classifier', tone: '' } : ai.budgetReached ? { label: 'AI budget reached', tone: 'warn' } : !ai.enabled ? { label: 'Rules only', tone: '' } : ai.healthy ? { label: 'AI', tone: '' } : { label: 'AI fallback', tone: 'warn' },
  ];
  // Shield Mode state is the last successful shield action (dry runs count in demo, and are labelled).
  const shield = [...actions].reverse().find(a => (a.kind === 'shield_mode_on' || a.kind === 'shield_mode_off') && a.success);
  const shieldOn = shield?.kind === 'shield_mode_on';
  const toggleShield = () => { setControlError(''); post('/api/shield', { active: !shieldOn }).catch((e: Error) => setControlError(e.message)); };

  // The screen's finding: what chat is doing right now, then what Fly Swatter did about it.
  const top = [...clusters].sort((a, b) => b.score - a.score)[0];
  const recent = flagged.filter(f => now - f.message.timestamp <= HISTORY_MS).length;
  const deletes = actions.filter(a => a.kind === 'delete_message');
  const swatted = deletes.filter(a => a.success && !a.dryRun).length, wouldSwat = deletes.filter(a => a.dryRun).length;
  const what = top?.isSwarm ? `${top.distinctUsers} chatters are converging on one ${top.granularity} guess.`
    : top && top.distinctUsers >= 2 ? `${top.distinctUsers} chatters named the same ${top.granularity}; a swarm needs ${minUsers}.`
    : recent ? `${recent} location message${recent === 1 ? '' : 's'} in the last 5 minutes, none converging.`
    : 'Chat is quiet: nobody has asked where you are in the last 5 minutes.';
  const did = swatted ? ` ${swatted} message${swatted === 1 ? '' : 's'} swatted this session.` : wouldSwat ? ` ${wouldSwat} would have been swatted this session (dry run).` : '';

  const info = levelInfo[risk.level];
  return <div className={`app lv-${risk.level}`}>
    <div className="sr-only" aria-live="polite">{announcement}</div>
    <header className="top">
      <a className="brand" href="/" aria-label="Fly Swatter, home"><Mascot mood={risk.level} size={20} /></a>
      <p className="status" aria-label="Connections">{statuses.map(s => <span key={s.label} className={s.tone}>{s.label}</span>)}</p>
      <div className="top-actions">
        {health && auth?.configured && connectLabel && <a className="text-btn" href={health.loginUrl}>{connectLabel}</a>}
        {demo && <button type="button" className="text-btn" aria-pressed={demoOn} onClick={() => { setControlError(''); post('/api/demo/mode', { enabled: !demoOn }).catch((e: Error) => setControlError(e.message)); }}>{demoOn ? 'End demo' : 'Demo'}</button>}
      </div>
    </header>
    {demo?.enabled && <DemoControls state={demo} raid={raid} onError={setControlError} />}

    <main>
      <SpecimenFly risk={risk} />

      <section className="readout" aria-labelledby="level-heading">
        <p className="score num" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(risk.score)} aria-valuetext={`${Math.round(risk.score)} out of 100, ${info.name}`}>{Math.round(risk.score)}</p>
        <h1 id="level-heading" className="level"><LevelMark level={risk.level} />{info.name}</h1>
        <p className="finding" role="status">{what}{did}</p>
        <div className="actions">
          <ModeSwitch mode={mode} onError={setControlError} />
          <button type="button" className={`btn${!shieldOn && risk.level === 'swarm' ? ' primary' : ''}`} onClick={toggleShield}>{shieldOn ? `Shield off${shield?.dryRun ? ' (dry run)' : ''}` : 'Shield Mode'}</button>
        </div>
        {(error || controlError) && <p className="alert" role="alert">{error || controlError}</p>}
      </section>

      <div className="segments">
        <section className="segment" aria-labelledby="risk-seg">
          <h2 id="risk-seg" className="label">Risk <span className="muted">· last 5 min</span></h2>
          <RiskDetails risk={risk} history={history} now={now} exposureConnected={false} />
        </section>
        <section className="segment" aria-labelledby="chat-seg">
          <h2 id="chat-seg" className="label">{demoOn ? 'Simulated chat' : 'Live chat'} <span className="muted num">{feed.length || ''}</span></h2>
          {!feed.length ? <p className="empty">{!socketConnected ? 'Reconnecting to the local server…' : demoOn ? 'Press Play, or type as a viewer.' : auth?.chatAuthorized ? 'Send a message in your channel to test the connection.' : 'Connect Twitch to read chat.'}</p> :
            <ol className="chat" aria-label="Recent chat messages">{feed.slice(-100).reverse().map(message => <li key={message.id}>
              <p><span className="who">{message.userName}{message.isBroadcaster ? ' (you)' : message.isModerator ? ' (mod)' : ''}</span><time className="num" dateTime={new Date(message.timestamp).toISOString()}>{time(message.timestamp)}</time></p>
              <p className="muted">{message.text}</p>
            </li>)}</ol>}
        </section>
      </div>

      {clusters.length > 0 && <SwarmView clusters={clusters} actions={actions} minUsers={minUsers} />}
      <FlyFeed flagged={flagged} actions={actions} />

      <div className="more">
        <details><summary>Actions <span className="num">{actions.length || ''}</span><Plus /></summary><ActionLog actions={actions} /></details>
        <details><summary>Settings<Plus /></summary><ResponsePanel mode={mode} settings={settings} ai={ai} moderationAuthorized={Boolean(auth?.moderationAuthorized)} demo={demoOn} loginUrl={health?.loginUrl} warnings={health?.warnings ?? []} onError={setControlError} /></details>
      </div>
    </main>
    <footer className="foot"><span>Private. Never show on stream.</span><span>Built with OpenAI Codex</span></footer>
  </div>;
}

const Plus = () => <svg className="plus" width="9" height="9" viewBox="0 0 9 9" aria-hidden="true" stroke="currentColor" strokeWidth="1"><path d="M4.5 0v9M0 4.5h9" /></svg>;
