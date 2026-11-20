"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/* ── Toast ── */

const ToastCtx = createContext<(msg: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ── Data helpers ── */

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    reload();
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const t = refreshMs ? setInterval(reload, refreshMs) : undefined;
    return () => {
      window.removeEventListener("focus", onFocus);
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, reload, setData };
}

export async function api<T = { message?: string }>(url: string, method = "POST", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
  return data as T;
}

/** Throws the Supabase error so callers can show it. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/* ── Controls ── */

export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min, max, onChange, label }: {
  value: number; min: number; max: number; onChange: (v: number) => void; label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="ลด" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <output>{value}</output>
      <button type="button" aria-label="เพิ่ม" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

export function Sheet({ title, onClose, left, right, children }: {
  title: string; onClose: () => void; left?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grabber" />
        <div className="sheet-head">
          <div>{left ?? <button type="button" className="btn plain" onClick={onClose}>ปิด</button>}</div>
          <h2>{title}</h2>
          <div>{right}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ name, src, color }: { name: string; src?: string | null; color?: string }) {
  return (
    <span className="avatar" style={color ? { background: color } : undefined}>
      {src ? <img src={src} alt="" /> : (name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/* ── Icons (SF Symbols-like strokes) ── */

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Icon = {
  home: () => (<svg viewBox="0 0 24 24" {...s}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>),
  queue: () => (<svg viewBox="0 0 24 24" {...s}><rect x="5" y="3" width="14" height="18" rx="3" /><path d="m10.5 9 4 3-4 3z" fill="currentColor" /></svg>),
  pages: () => (<svg viewBox="0 0 24 24" {...s}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M8 4v5" /></svg>),
  style: () => (<svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><circle cx="8.5" cy="10" r="1.2" fill="currentColor" /><circle cx="12" cy="7.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="10" r="1.2" fill="currentColor" /><path d="M12 21a3 3 0 0 1 0-6h2" /></svg>),
  settings: () => (<svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>),
  chart: () => (<svg viewBox="0 0 24 24" {...s}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>),
  pulse: () => (<svg viewBox="0 0 24 24" {...s}><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>),
  backup: () => (<svg viewBox="0 0 24 24" {...s}><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>),
  play: () => (<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>),
  logo: () => (<svg viewBox="0 0 24 24" width="22" height="22" {...s}><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="m10.5 9.5 3.5 2.5-3.5 2.5z" fill="currentColor" /></svg>),
};
