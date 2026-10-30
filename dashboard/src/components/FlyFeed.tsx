import { categoryLabel, categoryTone, time } from '../labels';
import type { ActionRecord, Flagged } from '../socket';
// Flagged messages, newest first. Private: contains place text, so never show this on stream.
// The classifier's reasoning stays one hover away so the list reads as a ledger.
export function FlyFeed({ flagged, actions }: { flagged: Flagged[]; actions: ActionRecord[] }) {
  const swatted = new Map(actions.filter(a => a.kind === 'delete_message' && a.targetMessageId).map(a => [a.targetMessageId!, a]));
  return <section className="flies" aria-labelledby="flies-heading">
    <h2 id="flies-heading" className="label">Flies <span className="num">{flagged.length || ''}</span></h2>
    {!flagged.length ? <p className="empty">None yet.</p> :
      <ol className="ledger">{flagged.slice(-40).reverse().map(({ message, classification: c }) => {
        const action = swatted.get(message.id);
        const done = action?.success && !action.dryRun;
        const why = `${c.rationale}${c.place ? ` Place: ${c.place.canonical} (${c.place.granularity}).` : ''} ${Math.round(c.confidence * 100)}% sure${c.source === 'rules_fallback' ? ', rules' : ''}.`;
        return <li key={message.id} title={why}>
          <time className="num" dateTime={new Date(message.timestamp).toISOString()}>{time(message.timestamp)}</time>
          <span className="who">{message.userName}</span>
          <span className={`msg${done ? ' struck' : ''}`}>{message.text}</span>
          <span className={`kind ${categoryTone[c.category]}`}>{categoryLabel[c.category]}</span>
          <span className="act">{!action ? '' : action.dryRun ? 'Would swat' : action.success ? 'Swatted' : 'Failed'}</span>
        </li>;
      })}</ol>}
  </section>;
}
