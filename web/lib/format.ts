const TZ = "Asia/Bangkok";

export function hm(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso));
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const key = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(x);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (key(d) === key(today)) return "วันนี้";
  if (key(d) === key(tomorrow)) return "พรุ่งนี้";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: TZ }).format(d);
}

export function longDate(d = new Date()): string {
  return new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(d);
}

export function bangkokDayStart(d = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  return new Date(`${ymd}T00:00:00+07:00`).toISOString();
}

export function compact(n: number | null | undefined): string {
  if (n == null) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n);
}

/** Value for <input type="datetime-local"> in Bangkok time. */
export function toLocalInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600000);
  return d.toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): string {
  return new Date(`${v}:00+07:00`).toISOString();
}

export function shortTime(t: string): string {
  return t.slice(0, 5);
}
