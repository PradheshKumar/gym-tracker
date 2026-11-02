import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Card, Field, Sheet, useToast } from '../components/ui';
import { db } from '../db';
import { useToday } from '../hooks';
import { addDays, fmtDate } from '../lib/dates';
import { parseReminder } from '../lib/parseReminder';
import type { CustomReminder } from '../lib/reminders';
import { pushActiveHere } from '../push';

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

type Rec = { new (): SpeechRec };
interface SpeechRec {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
const SpeechRecognition = (): Rec | undefined => (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

/** Your own reminders: type or say them, once or daily; delivered as notifications. */
export function RemindersScreen() {
  const today = useToday();
  const toast = useToast();
  const list = useLiveQuery(() => db.customReminders.toArray());
  const [draft, setDraft] = useState<CustomReminder | null>(null);
  const [said, setSaid] = useState('');
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRec | null>(null);

  function fromSentence(sentence: string) {
    const p = parseReminder(sentence, today, nowMinutes());
    setDraft({ text: p.text || sentence, time: p.time ?? '20:00', repeat: p.repeat, date: p.repeat === 'once' ? p.date : undefined });
  }

  function listen() {
    const R = SpeechRecognition();
    if (!R) return toast('Voice input is not available in this browser; type instead.');
    const r = new R();
    r.lang = 'en-IN';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setSaid(t);
      fromSentence(t);
    };
    r.onerror = (e) => toast(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice input: ${e.error}`);
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }
  useEffect(() => () => rec.current?.stop(), []);

  if (!list) return null;
  const active = list.filter((r) => !r.done).sort((a, b) => (a.repeat === b.repeat ? a.time.localeCompare(b.time) : a.repeat === 'daily' ? -1 : 1));
  const done = list.filter((r) => r.done);

  return (
    <>
      <header className="top">
        <div>
          <h1>Reminders</h1>
          <div className="sub">{pushActiveHere() ? 'Delivered as notifications, even with the app closed' : 'Turn on background reminders in Settings to get them with the app closed'}</div>
        </div>
      </header>

      <Card title="New reminder">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (said.trim()) fromSentence(said);
          }}
        >
          <input className="txt grow" value={said} onChange={(e) => setSaid(e.target.value)} placeholder='e.g. "order paneer at 6 pm" or "soak oats every night at 10"' aria-label="Reminder" />
          <button type="button" className={`btn ${listening ? 'warn' : ''}`} onClick={() => (listening ? rec.current?.stop() : listen())} aria-label={listening ? 'Stop listening' : 'Speak the reminder'}>
            {listening ? '■' : '🎤'}
          </button>
          <button className="btn primary" disabled={!said.trim()}>
            Next
          </button>
        </form>
        <p className="fineprint">Say or type what and when; you can adjust the time and once/daily on the next step.</p>
      </Card>

      <Card title="Active">
        {active.length === 0 ? (
          <p className="muted">No reminders yet.</p>
        ) : (
          <ul className="list">
            {active.map((r) => (
              <li key={r.id}>
                <div className="grow" onClick={() => setDraft(r)} role="button" style={{ cursor: 'pointer', opacity: r.paused ? 0.5 : 1 }}>
                  <div>{r.text}</div>
                  <small>
                    {r.time} · {r.repeat === 'daily' ? 'every day' : r.date === today ? 'today' : r.date === addDays(today, 1) ? 'tomorrow' : fmtDate(r.date!, { weekday: 'short', day: 'numeric', month: 'short' })}
                    {r.paused && ' · paused'}
                    {r.repeat === 'daily' && r.lastDone === today && ' · done today'}
                  </small>
                </div>
                <button className="btn small ghost" onClick={() => db.customReminders.update(r.id!, { paused: !r.paused })} aria-label={r.paused ? 'Resume' : 'Pause'}>
                  {r.paused ? '▶' : '⏸'}
                </button>
                <button className="btn small ghost" onClick={() => db.customReminders.delete(r.id!)} aria-label={`Delete ${r.text}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {done.length > 0 && (
        <Card title="Done" right={<button className="btn small ghost" onClick={() => db.customReminders.bulkDelete(done.map((d) => d.id!))}>Clear</button>}>
          <ul className="list">
            {done.slice(-10).map((r) => (
              <li key={r.id}>
                <span className="grow muted">{r.text}</span>
                <small>{r.date && fmtDate(r.date)}</small>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit reminder' : 'New reminder'}>
        {draft && (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const row: CustomReminder = { ...draft, text: draft.text.trim(), date: draft.repeat === 'once' ? draft.date ?? today : undefined, done: false };
              await db.customReminders.put(row);
              toast(`Reminder set: ${row.time}${row.repeat === 'daily' ? ' daily' : ''}`);
              setDraft(null);
              setSaid('');
            }}
          >
            <Field label="Remind me to">
              <input value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} required />
            </Field>
            <div className="chips">
              {(['once', 'daily'] as const).map((r) => (
                <button type="button" key={r} className={`chip ${draft.repeat === r ? 'on' : ''}`} onClick={() => setDraft({ ...draft, repeat: r, date: draft.date ?? today })}>
                  {r === 'once' ? 'Once' : 'Every day'}
                </button>
              ))}
            </div>
            <div className="grid2">
              <Field label="Time">
                <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} required />
              </Field>
              {draft.repeat === 'once' && (
                <Field label="Date">
                  <input type="date" min={today} value={draft.date ?? today} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required />
                </Field>
              )}
            </div>
            <button className="btn primary block" disabled={!draft.text.trim()}>
              Save reminder
            </button>
            {draft.id && (
              <button
                type="button"
                className="btn danger block"
                onClick={async () => {
                  await db.customReminders.delete(draft.id!);
                  setDraft(null);
                }}
              >
                Delete
              </button>
            )}
          </form>
        )}
      </Sheet>
    </>
  );
}
