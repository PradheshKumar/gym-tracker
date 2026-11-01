import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Field, Sheet, useToast } from '../components/ui';
import { db } from '../db';
import { useToday } from '../hooks';
import { diffDays, fmtDate, toKey } from '../lib/dates';
import type { DateKey, Media, Pose } from '../lib/types';

const POSES: { id: Pose | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
  { id: 'pose-video', label: 'Videos' },
];

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function MediaScreen() {
  const today = useToday();
  const toast = useToast();
  const [pose, setPose] = useState<Pose | 'all'>('all');
  const [detail, setDetail] = useState<Media | null>(null);
  const [staged, setStaged] = useState<Media[]>([]);
  const [camPose, setCamPose] = useState<Pose | null>(null);
  const [selecting, setSelecting] = useState<string[] | null>(null);
  const [compare, setCompare] = useState<[Media, Media] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const items = useLiveQuery(() => db.media.orderBy('date').reverse().toArray());

  if (!items) return null;
  const shown = items.filter((m) => pose === 'all' || m.pose === pose);
  const lastReal = items.filter((m) => m.type === 'photo' && m.blob)[0];
  const photoDue = !lastReal || diffDays(lastReal.date, today) >= 14;
  const lastVid = items.filter((m) => m.type === 'video' && m.blob)[0];
  const videoDue = !lastVid || diffDays(lastVid.date, today) >= 28;

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    // Browsers expose only lastModified, which for camera files is normally the capture time.
    setStaged(
      [...files].map((f) => {
        const isVideo = f.type.startsWith('video');
        return {
          date: toKey(new Date(f.lastModified)),
          type: isVideo ? 'video' : 'photo',
          pose: isVideo ? 'pose-video' : pose === 'all' || pose === 'pose-video' ? 'front' : pose,
          blob: f,
          mime: f.type,
          createdAtOriginal: f.lastModified,
        } as Media;
      }),
    );
  }

  async function saveStaged() {
    await db.media.bulkAdd(staged);
    toast(`${staged.length} item(s) saved locally`);
    setStaged([]);
  }

  function toggleSelect(m: Media) {
    if (!selecting) return;
    const next = selecting.includes(m.id!) ? selecting.filter((x) => x !== m.id) : [...selecting, m.id!].slice(-2);
    setSelecting(next);
    if (next.length === 2) {
      const [a, b] = next.map((id) => items!.find((x) => x.id === id)!).sort((x, y) => x.date.localeCompare(y.date));
      setCompare([a, b]);
      setSelecting(null);
    }
  }

  return (
    <>
      <header className="top">
        <h1>Progress media</h1>
        <small>stored on this device only</small>
      </header>

      {(photoDue || videoDue) && (
        <div className="banner info">
          {photoDue && <div>Photo day: front, side and back every 2-4 weeks.</div>}
          {videoDue && <div>Pose video: once a month.</div>}
          <p>Same light, about 2 m away, same time of day (morning), phone at chest height.</p>
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="btn primary grow" onClick={() => setCamPose(pose === 'all' || pose === 'pose-video' ? 'front' : pose)}>
          📷 Ghost camera
        </button>
        <button className="btn grow" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <button className={`btn ${selecting ? 'warn' : ''}`} onClick={() => setSelecting(selecting ? null : [])}>
          {selecting ? 'Pick 2…' : 'Compare'}
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      </div>

      <div className="chips" style={{ marginBottom: 12 }}>
        {POSES.map((p) => (
          <button key={p.id} className={`chip ${pose === p.id ? 'on' : ''}`} onClick={() => setPose(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted center">Nothing here yet.</p>
      ) : (
        <div className="gallery">
          {shown.map((m) => (
            <Thumb key={m.id} m={m} selected={selecting?.includes(m.id!)} onClick={() => (selecting ? toggleSelect(m) : setDetail(m))} />
          ))}
        </div>
      )}

      <Sheet open={staged.length > 0} onClose={() => setStaged([])} title={`Import ${staged.length} item(s)`}>
        <p className="fineprint" style={{ marginTop: 0 }}>
          Dates come from each file's timestamp. Check them before saving.
        </p>
        {staged.map((m, i) => (
          <div key={i} className="row" style={{ marginBottom: 8 }}>
            <span className="grow" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {(m.blob as File).name}
            </span>
            <input className="txt" type="date" value={m.date} onChange={(e) => setStaged(staged.map((s, j) => (j === i ? { ...s, date: e.target.value } : s)))} style={{ maxWidth: 150 }} />
            <select className="txt" value={m.pose} onChange={(e) => setStaged(staged.map((s, j) => (j === i ? { ...s, pose: e.target.value as Pose } : s)))} style={{ maxWidth: 110 }}>
              {POSES.filter((p) => p.id !== 'all').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        <button className="btn primary block" onClick={saveStaged}>
          Save
        </button>
      </Sheet>

      {detail && <Detail m={detail} onClose={() => setDetail(null)} />}
      {camPose && (
        <GhostCamera
          pose={camPose}
          onPose={setCamPose}
          ghost={items.find((m) => m.type === 'photo' && m.pose === camPose && m.blob)}
          onClose={() => setCamPose(null)}
          onCapture={async (blob) => {
            await db.media.add({ date: today, type: 'photo', pose: camPose, blob, mime: blob.type, createdAtOriginal: Date.now() });
            toast(`${camPose} photo saved`);
          }}
        />
      )}
      {compare && <Compare a={compare[0]} b={compare[1]} onClose={() => setCompare(null)} />}
    </>
  );
}

function Thumb({ m, onClick, selected }: { m: Media; onClick: () => void; selected?: boolean }) {
  const url = useObjectUrl(m.blob);
  return (
    <button className="thumb" onClick={onClick} style={selected ? { outline: '3px solid var(--accent)' } : undefined}>
      {!m.blob ? (
        <div className="ph">{m.baseline ? 'Baseline video · tap to attach' : 'No file'}</div>
      ) : m.type === 'video' ? (
        <video src={url} muted preload="metadata" playsInline />
      ) : (
        <img src={url} alt={`${m.pose} ${m.date}`} loading="lazy" />
      )}
      <div className="cap">
        {fmtDate(m.date, { day: 'numeric', month: 'short', year: '2-digit' })} · {m.type === 'video' ? '▶' : m.pose}
      </div>
    </button>
  );
}

function Detail({ m, onClose }: { m: Media; onClose: () => void }) {
  const url = useObjectUrl(m.blob);
  const [notes, setNotes] = useState(m.notes ?? '');
  const [date, setDate] = useState(m.date);
  const fileRef = useRef<HTMLInputElement>(null);
  const stats = useLiveQuery(async () => {
    const near = <T extends { date: DateKey }>(rows: T[]) =>
      rows.filter((r) => Math.abs(diffDays(r.date, m.date)) <= 7).sort((a, b) => Math.abs(diffDays(a.date, m.date)) - Math.abs(diffDays(b.date, m.date)))[0];
    const [w, ms, bf] = await Promise.all([db.weighins.toArray(), db.measurements.where('site').equals('waist (navel)').toArray(), db.bodyfat.toArray()]);
    return { w: near(w), waist: near(ms), bf: near(bf.filter((b) => b.method === 'navy')) };
  }, [m.date]);

  return (
    <Sheet open onClose={onClose} title={`${m.type === 'video' ? 'Video' : `${m.pose} photo`} · ${fmtDate(m.date, { day: 'numeric', month: 'short', year: 'numeric' })}`}>
      {m.blob ? (
        m.type === 'video' ? <video className="media-full" src={url} controls playsInline /> : <img className="media-full" src={url} alt="" />
      ) : (
        <button className="btn block" onClick={() => fileRef.current?.click()}>
          Attach file
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={m.type === 'video' ? 'video/*' : 'image/*'}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          await db.media.update(m.id!, { blob: f, mime: f.type, createdAtOriginal: f.lastModified });
          onClose();
        }}
      />
      {stats && (
        <div className="grid3" style={{ margin: '10px 0' }}>
          <div className="stat">
            <b>{stats.w ? stats.w.kg : '–'}</b>
            <span>kg{stats.w && stats.w.date !== m.date ? ` (${fmtDate(stats.w.date)})` : ''}</span>
          </div>
          <div className="stat">
            <b>{stats.waist ? stats.waist.cm : '–'}</b>
            <span>waist cm</span>
          </div>
          <div className="stat">
            <b>{stats.bf ? `${stats.bf.value}%` : '–'}</b>
            <span>BF (Navy, est.)</span>
          </div>
        </div>
      )}
      <Field label="Date">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="btn primary grow"
          onClick={async () => {
            await db.media.update(m.id!, { notes, date });
            onClose();
          }}
        >
          Save
        </button>
        <button
          className="btn danger"
          onClick={async () => {
            if (confirm('Delete this item from the device? This cannot be undone.')) {
              await db.media.delete(m.id!);
              onClose();
            }
          }}
        >
          Delete
        </button>
      </div>
    </Sheet>
  );
}

function GhostCamera({ pose, onPose, ghost, onClose, onCapture }: { pose: Pose; onPose: (p: Pose) => void; ghost?: Media; onClose: () => void; onCapture: (b: Blob) => Promise<void> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string>();
  const [opacity, setOpacity] = useState(0.35);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const ghostUrl = useObjectUrl(ghost?.blob);
  const timer = useRef<number>(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let stream: MediaStream | undefined;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1440 }, height: { ideal: 1920 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch((e) => setErr(String(e?.message ?? e)));
    if (!navigator.mediaDevices) setErr('Camera not available. Use Import instead.');
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [facing]);

  async function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d')!;
    if (facing === 'user') {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
    if (blob) await onCapture(blob);
  }

  function selfTimer() {
    let n = 10;
    setCount(n);
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      n -= 1;
      setCount(n);
      if (n <= 0) {
        window.clearInterval(timer.current);
        shoot();
      }
    }, 1000);
  }
  useEffect(() => () => window.clearInterval(timer.current), []);

  return (
    <div className="cam" role="dialog" aria-label="Ghost camera">
      <div className="cam-view">
        <video ref={video} autoPlay playsInline muted style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined} />
        {ghostUrl && <img src={ghostUrl} alt="" style={{ opacity }} />}
        <div className="cam-tips">
          {err ? `Camera error: ${err}` : ghost ? `Line up with your ${pose} photo from ${fmtDate(ghost.date)}.` : `No earlier ${pose} photo yet: this one becomes the guide.`} Same light, ~2 m, phone at chest height.
        </div>
        {count > 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 96, color: '#fff', fontWeight: 800 }}>{count}</div>
        )}
      </div>
      <div style={{ background: '#000', padding: '8px 16px', display: 'flex', gap: 6, justifyContent: 'center' }}>
        {(['front', 'side', 'back'] as Pose[]).map((p) => (
          <button key={p} className={`chip ${p === pose ? 'on' : ''}`} onClick={() => onPose(p)}>
            {p}
          </button>
        ))}
      </div>
      <div style={{ background: '#000', padding: '0 16px', color: '#fff', fontSize: 12 }} className="row">
        Ghost
        <input type="range" min={0} max={0.8} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="grow" aria-label="Ghost opacity" />
      </div>
      <div className="cam-bar">
        <button className="btn ghost" style={{ color: '#fff' }} onClick={onClose}>
          Close
        </button>
        <button className="shutter" onClick={shoot} aria-label="Take photo" />
        <div className="stack">
          <button className="btn small" onClick={selfTimer}>
            10 s
          </button>
          <button className="btn small" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}>
            Flip
          </button>
        </div>
      </div>
    </div>
  );
}

function Compare({ a, b, onClose }: { a: Media; b: Media; onClose: () => void }) {
  const ua = useObjectUrl(a.blob);
  const ub = useObjectUrl(b.blob);
  const [pos, setPos] = useState(50);
  const va = useRef<HTMLVideoElement>(null);
  const vb = useRef<HTMLVideoElement>(null);
  const stats = useLiveQuery(async () => {
    const w = await db.weighins.toArray();
    const near = (d: DateKey) => w.filter((x) => Math.abs(diffDays(x.date, d)) <= 7).sort((p, q) => Math.abs(diffDays(p.date, d)) - Math.abs(diffDays(q.date, d)))[0]?.kg;
    return { wa: near(a.date), wb: near(b.date) };
  });
  const videos = a.type === 'video' && b.type === 'video';
  const days = diffDays(a.date, b.date);

  return (
    <Sheet open onClose={onClose} title={`${fmtDate(a.date)} → ${fmtDate(b.date)} (${days} days)`}>
      {!a.blob || !b.blob ? (
        <p className="muted">Both items need a file attached.</p>
      ) : videos ? (
        <>
          <div className="grid2">
            <video ref={va} src={ua} playsInline muted className="media-full" />
            <video ref={vb} src={ub} playsInline muted className="media-full" />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            defaultValue={0}
            aria-label="Timestamp"
            style={{ width: '100%', marginTop: 8 }}
            onChange={(e) => {
              // Same relative timestamp in both clips, so poses line up even if lengths differ.
              const f = Number(e.target.value) / 100;
              if (va.current?.duration) va.current.currentTime = f * va.current.duration;
              if (vb.current?.duration) vb.current.currentTime = f * vb.current.duration;
            }}
          />
          <p className="fineprint">Scrub to compare the same point in both videos.</p>
        </>
      ) : (
        <>
          <div className="compare">
            <img src={ua} alt="before" />
            <img src={ub} alt="after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }} />
            <div className="divider" style={{ left: `${pos}%` }} />
          </div>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} style={{ width: '100%' }} aria-label="Slider" />
        </>
      )}
      {stats && (
        <div className="grid2" style={{ marginTop: 8 }}>
          <div className="stat">
            <b>{stats.wa ?? '–'} → {stats.wb ?? '–'}</b>
            <span>kg</span>
          </div>
          <div className="stat">
            <b>{stats.wa && stats.wb ? `${(stats.wb - stats.wa > 0 ? '+' : '') + (stats.wb - stats.wa).toFixed(1)} kg` : '–'}</b>
            <span>change</span>
          </div>
        </div>
      )}
    </Sheet>
  );
}
