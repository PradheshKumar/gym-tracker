import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="card-h">
          <h2>{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Ring({ value, max, label, sub, size = 84, color = 'var(--accent)' }: { value: number; max: number; label: ReactNode; sub?: ReactNode; size?: number; color?: string }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="ring" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={8} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-label">
        <strong>{label}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

export function Bar({ value, max, color = 'var(--accent)', marks }: { value: number; max: number; color?: string; marks?: number[] }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="bar">
      <div style={{ width: `${pct * 100}%`, background: color }} />
      {marks?.map((m, i) => <span key={i} className="bar-mark" style={{ left: `${Math.min(100, (m / max) * 100)}%` }} />)}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="card-h">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function NumInput({ value, onChange, step = 1, min, placeholder, className = '', ariaLabel }: { value: number | '' | undefined; onChange: (v: number | '') => void; step?: number; min?: number; placeholder?: string; className?: string; ariaLabel?: string }) {
  return (
    <input
      className={`num ${className}`}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      value={value ?? ''}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    />
  );
}

export function Scale({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="scale">
      <span>{label}</span>
      <div className="scale-btns" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={value === n} className={value === n ? 'on' : ''} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Estimate({ children = 'estimate' }: { children?: ReactNode }) {
  return (
    <span className="est" title="Estimated from a standard formula; real values vary.">
      {children}
    </span>
  );
}

export function Tier({ tier }: { tier: 'C' | 'O' }) {
  return <span className={`tier tier-${tier}`}>{tier === 'C' ? 'Core' : 'Optional'}</span>;
}

// ---------- Toasts ----------
interface Toast {
  id: number;
  text: string;
  kind: 'pr' | 'info';
}
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'pr' ? 4000 : 2500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'pr' && <span aria-hidden>🏆 </span>}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const fmt = (n: number | undefined | null, d = 1) => (n === undefined || n === null || Number.isNaN(n) ? '–' : n.toFixed(d).replace(/\.0+$/, ''));
