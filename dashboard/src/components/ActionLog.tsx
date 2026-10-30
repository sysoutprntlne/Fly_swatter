import { actionLabel, time } from '../labels';
import type { ActionRecord } from '../socket';
export function ActionLog({ actions }: { actions: ActionRecord[] }) {
  if (!actions.length) return <p className="empty">Nothing yet.</p>;
  return <ol className="ledger compact">{actions.slice(-60).reverse().map(a => <li key={a.id}>
    <time className="num">{time(a.at)}</time>
    <span className="who">{actionLabel[a.kind]}</span>
    <span className="msg muted">{a.reason}{a.error ? ` · ${a.error}` : ''}</span>
    <span className={`kind ${a.success ? '' : 'negative'}`}>{a.dryRun ? 'Dry run' : a.success ? 'Done' : 'Failed'}</span>
  </li>)}</ol>;
}
