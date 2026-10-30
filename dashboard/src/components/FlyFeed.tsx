import { useState } from 'react';
import { categoryLabel, categoryTone, time } from '../labels';
import { plainRationale, ruleLabel, sureness } from '../plain';
import { post, type ActionRecord, type Category, type ChatMessage, type Flagged, type Review } from '../socket';
// Flagged messages, newest first, and the mods' review board: open a row to see the chat around it, the words
// that set it off, and Fly Swatter's reasoning, then mark the call right or wrong. Private: contains place text.
const kinds: Category[] = ['benign', 'location_question', 'location_guess', 'location_confirmation', 'location_share', 'approach_intent', 'swat_or_threat'];

export function FlyFeed({ flagged, actions, reviews, chat, onError }: { flagged: Flagged[]; actions: ActionRecord[]; reviews: Map<string, Review>; chat: ChatMessage[]; onError: (message: string) => void }) {
  const [open, setOpen] = useState<string>();
  const swatted = new Map(actions.filter(a => a.kind === 'delete_message' && a.targetMessageId).map(a => [a.targetMessageId!, a]));
  const checked = flagged.filter(f => reviews.has(f.message.id)).length;
  return <section className="flies" aria-labelledby="flies-heading">
    <h2 id="flies-heading" className="label">Flagged messages <span className="num">{flagged.length ? `· ${flagged.length}` : ''}{checked ? ` · ${checked} checked` : ''}</span></h2>
    {!flagged.length ? <p className="empty">None yet. Messages that ask about, guess or share where you are show up here.</p> : <>
      <p className="hint">Open a message to check whether Fly Swatter got it right.</p>
      <ol className="review-list">{flagged.slice(-40).reverse().map(f => {
        const { message, classification: c } = f;
        const action = swatted.get(message.id), review = reviews.get(message.id), isOpen = open === message.id;
        const done = action?.success && !action.dryRun;
        return <li key={message.id} className={isOpen ? 'open' : undefined}>
          <button type="button" className="row" aria-expanded={isOpen} aria-controls={`review-${message.id}`} onClick={() => setOpen(isOpen ? undefined : message.id)}>
            <time className="num" dateTime={new Date(message.timestamp).toISOString()}>{time(message.timestamp)}</time>
            <span className="who">{message.userName}</span>
            <span className={`msg${done ? ' struck' : ''}`}>{message.text}</span>
            <span className={`kind ${categoryTone[c.category]}`}>{categoryLabel[c.category]}</span>
            <span className="act">{!action ? '' : action.dryRun ? 'Would delete' : action.success ? 'Deleted' : "Couldn't delete"}</span>
            <span className={`verdict ${review?.verdict ?? ''}`}>{review ? (review.verdict === 'right' ? 'Right' : 'Wrong') : ''}</span>
          </button>
          {isOpen && <ReviewPanel id={`review-${message.id}`} flagged={f} action={action} review={review} before={chat.filter(m => m.timestamp <= message.timestamp && m.id !== message.id).slice(-4)} onError={onError} />}
        </li>;
      })}</ol>
    </>}
  </section>;
}

function ReviewPanel({ id, flagged, action, review, before, onError }: { id: string; flagged: Flagged; action?: ActionRecord; review?: Review; before: ChatMessage[]; onError: (message: string) => void }) {
  const { message, prefilter, classification: c } = flagged;
  const send = (verdict: Review['verdict'] | null, shouldBe?: Category) => { onError(''); post('/api/review', { messageId: message.id, verdict, ...(shouldBe ? { shouldBe } : {}) }).catch((e: Error) => onError(e.message)); };
  const noticed = [...new Set(prefilter.matchedRules.map(r => ruleLabel[r]).filter(Boolean))];
  return <div className="review" id={id}>
    <div className="review-cols">
      <div>
        <h3 className="label">Chat before it</h3>
        <ol className="context">
          {before.length ? before.map(m => <li key={m.id}><span className="who">{m.userName}</span> <span className="muted">{m.text}</span></li>) : <li className="muted">Nothing earlier in this session.</li>}
          <li className="this"><span className="who">{message.userName}</span> <Highlighted text={message.text} part={c.place?.rawText} /></li>
        </ol>
      </div>
      <div>
        <h3 className="label">What Fly Swatter noticed</h3>
        <dl className="kv">
          {c.place && <div><dt>Place named</dt><dd><mark>{c.place.rawText}</mark></dd></div>}
          <div><dt>Signals</dt><dd>{noticed.length ? noticed.join('. ') + '.' : 'No word rules; the AI judged the meaning.'}</dd></div>
          <div><dt>Its call</dt><dd>{categoryLabel[c.category]}</dd></div>
          <div><dt>Why</dt><dd>{plainRationale(c.rationale)}.</dd></div>
          <div><dt>How sure</dt><dd>{sureness(c.confidence)}{c.source === 'rules_fallback' ? ', from word rules' : ', from the AI'}</dd></div>
          <div><dt>What it did</dt><dd>{!action ? 'Nothing. It only noted it.' : action.dryRun ? 'Would have deleted it (practice or Observe mode)' : action.success ? 'Deleted it' : `Tried to delete it, but couldn't: ${action.error ?? 'unknown error'}`}</dd></div>
        </dl>
      </div>
    </div>
    <div className="verdict-row">
      <span className="label">Was this the right call?</span>
      <button type="button" className="btn" aria-pressed={review?.verdict === 'right'} onClick={() => send(review?.verdict === 'right' ? null : 'right')}>Right call</button>
      <button type="button" className="btn" aria-pressed={review?.verdict === 'wrong'} onClick={() => send(review?.verdict === 'wrong' ? null : 'wrong', review?.shouldBe)}>Wrong call</button>
      {review?.verdict === 'wrong' && <label className="should-be">It was really
        <select className="field" value={review.shouldBe ?? ''} onChange={e => send('wrong', (e.target.value || undefined) as Category | undefined)}>
          <option value="">Choose…</option>
          {kinds.filter(k => k !== c.category).map(k => <option key={k} value={k}>{categoryLabel[k]}</option>)}
        </select>
      </label>}
    </div>
    <p className="note">Checks are kept until Fly Swatter stops, then cleared. Nothing is sent to Twitch.</p>
  </div>;
}

/** The message with the words that set it off marked. Matching is case-insensitive; no match, no mark. */
function Highlighted({ text, part }: { text: string; part?: string }) {
  const at = part ? text.toLowerCase().indexOf(part.toLowerCase()) : -1;
  if (!part || at < 0) return <span>{text}</span>;
  return <span>{text.slice(0, at)}<mark>{text.slice(at, at + part.length)}</mark>{text.slice(at + part.length)}</span>;
}
