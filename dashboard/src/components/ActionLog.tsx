import { actionLabel, time } from '../labels';
import type { ActionRecord } from '../socket';
import { plainReason } from '../plain';
export function ActionLog({ actions }: { actions: ActionRecord[] }) {
  if (!actions.length) return <p className="empty">Nothing yet.</p>;
  return <ol className="ledger compact">{actions.slice(-60).reverse().map(a => <li key={a.id}>
    <time className="num">{time(a.at)}</time>
    <span className="who">{actionLabel[a.kind]}</span>
    <span className="msg muted">{plainReason(a.reason)}{a.error ? ` Error: ${a.error}` : ''}</span>
    <span className={`kind ${a.success ? '' : 'negative'}`}>{a.dryRun ? 'Practice' : a.success ? 'Done' : 'Failed'}</span>
  </li>)}</ol>;
}
