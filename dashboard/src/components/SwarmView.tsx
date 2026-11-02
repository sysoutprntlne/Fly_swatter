import { time } from '../labels';
import type { ActionRecord, PlaceCluster } from '../socket';
import { Fly, Pin } from './Mascot';
// Places chat is converging on: one wire fly per distinct chatter, lined up toward the pin, the swarm
// threshold marked on the lane. Rendered only while a cluster exists. Place text is dashboard-only (rule §2.3).
const MAX_FLIES = 7;
export function SwarmView({ clusters, actions, minUsers }: { clusters: PlaceCluster[]; actions: ActionRecord[]; minUsers: number }) {
  const deletes = new Map(actions.filter(a => a.kind === 'delete_message' && a.targetMessageId).map(a => [a.targetMessageId!, a]));
  const sorted = [...clusters].sort((a, b) => b.score - a.score).slice(0, 3);
  return <section className="swarm" aria-labelledby="swarm-heading">
    <h2 id="swarm-heading" className="label">People guessing the same place</h2>
    <ul className="clusters">{sorted.map(c => {
      const users = [...new Map(c.mentions.map(m => [m.userId, m])).values()];
      const flies = users.map(u => {
        const own = c.mentions.filter(m => m.userId === u.userId).map(m => deletes.get(m.messageId)).filter(Boolean) as ActionRecord[];
        return { id: u.userId, login: u.userLogin, state: own.some(a => a.success && !a.dryRun) ? 'swatted' : own.some(a => a.dryRun) ? 'would' : 'live' } as const;
      });
      return <li key={c.id} className={`cluster${c.isSwarm ? ' is-swarm' : ''}`}>
        <p className="cluster-head"><span className="place">{c.canonical}</span>{c.isSwarm && <span className="pill negative">Danger</span>}
          <span className="meta num">{c.distinctUsers} {c.distinctUsers === 1 ? 'person' : 'people'} · since {time(c.firstSeen)}</span></p>
        <Lane flies={flies} minUsers={minUsers} />
      </li>;
    })}</ul>
    <p className="lane-note">Each fly is one person. The line marks the minimum of {minUsers} people; confidence also counts toward a swarm.</p>
  </section>;
}

function Lane({ flies, minUsers }: { flies: { id: string; login: string; state: 'live' | 'would' | 'swatted' }[]; minUsers: number }) {
  const shown = flies.slice(0, MAX_FLIES);
  const slots = Math.min(MAX_FLIES, Math.max(minUsers + 1, shown.length));
  const label = (state: string) => state === 'swatted' ? 'message deleted' : state === 'would' ? 'would be deleted (practice)' : 'message still in chat';
  return <div className="lane" role="img" aria-label={`${flies.length} people, swarm needs at least ${minUsers} people and enough confidence: ${flies.map(f => `${f.login} ${label(f.state)}`).join(', ')}`}>
    {Array.from({ length: slots }, (_, i) => {
      const fly = shown[i];
      return <span key={fly?.id ?? `slot-${i}`} style={{ display: 'contents' }}>
        {i === minUsers && <span className="threshold" />}
        {fly ? <span className={`slot fly ${fly.state}`} title={`${fly.login}: ${label(fly.state)}`}><Fly size={24} /></span> : <span className="slot empty" />}
      </span>;
    })}
    {flies.length > MAX_FLIES && <span className="meta num">+{flies.length - MAX_FLIES}</span>}
    <span className="pin"><Pin size={22} /></span>
  </div>;
}
