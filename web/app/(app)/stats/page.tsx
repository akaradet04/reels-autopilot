"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, Seg, useLoad } from "@/components/ui";
import { catShort } from "@/lib/categories";
import { compact, dayLabel, hm } from "@/lib/format";
import { publicUrl, supabase } from "@/lib/supabase/client";

interface PageRow { id: string; name: string; picture_url: string | null; followers: number | null; enabled: boolean }
interface DayRow { page_id: string; day: string; followers: number | null }
interface StatRow {
  post_id: string; page_id: string; fetched_at: string; plays: number | null; reach: number | null;
  avg_watch_sec: number | null; likes: number | null; comments: number | null; shares: number | null;
  follows: number | null; error: string | null;
  clip_posts: { posted_at: string | null; clip_id: string; clips: { topic: string | null; category: string; thumb_path: string | null; duration_sec: number | null } | null } | null;
}
interface Data { pages: PageRow[]; days: DayRow[]; stats: StatRow[]; posted: number; missing: boolean }

async function load(range: number): Promise<Data> {
  const db = supabase();
  const since = new Date(Date.now() - range * 86400000);
  const sinceDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(since);
  const [pages, days, stats, posted] = await Promise.all([
    db.from("pages").select("id,name,picture_url,followers,enabled").order("followers", { ascending: false }),
    db.from("page_stats").select("page_id,day,followers").gte("day", sinceDay).order("day"),
    db.from("post_stats")
      .select("*, clip_posts!inner(posted_at,clip_id,clips(topic,category,thumb_path,duration_sec))")
      .gte("clip_posts.posted_at", since.toISOString()).limit(1000),
    db.from("clip_posts").select("id", { count: "exact", head: true }).eq("status", "posted").gte("posted_at", since.toISOString()),
  ]);
  if (pages.error) throw new Error(pages.error.message);
  // Tables missing = the stats SQL has not been run yet. Show a friendly note instead of an error.
  const missing = Boolean(days.error || stats.error);
  return {
    pages: (pages.data ?? []) as PageRow[],
    days: (days.data ?? []) as DayRow[],
    stats: ((stats.data ?? []) as StatRow[]).filter((s) => !s.error),
    posted: posted.count ?? 0,
    missing,
  };
}

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
};

const SLOTS = [
  { label: "เช้า", sub: "06–11", from: 6, to: 11 },
  { label: "กลางวัน", sub: "11–15", from: 11, to: 15 },
  { label: "เย็น", sub: "15–19", from: 15, to: 19 },
  { label: "ค่ำ", sub: "19–24", from: 19, to: 24 },
];
const bkkHour = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date(iso)));

export default function Stats() {
  const [range, setRange] = useState(7);
  const [pageId, setPageId] = useState<string>("all");
  const [sort, setSort] = useState<"plays" | "follows" | "watch">("plays");
  const { data } = useLoad(() => load(range), [range], 300_000);

  const view = useMemo(() => {
    if (!data) return null;
    const pages = data.pages.filter((p) => p.enabled || data.stats.some((s) => s.page_id === p.id));
    const stats = pageId === "all" ? data.stats : data.stats.filter((s) => s.page_id === pageId);
    const scope = pageId === "all" ? pages : pages.filter((p) => p.id === pageId);

    // Follower series: total per day over the chosen pages.
    const byDay = new Map<string, number>();
    data.days.filter((d) => scope.some((p) => p.id === d.page_id))
      .forEach((d) => byDay.set(d.day, (byDay.get(d.day) ?? 0) + (d.followers ?? 0)));
    const series = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const followersNow = sum(scope.map((p) => p.followers));
    const gained = series.length >= 2 ? series[series.length - 1][1] - series[0][1] : null;

    const ranked = [...stats].sort((a, b) =>
      sort === "plays" ? (b.plays ?? 0) - (a.plays ?? 0)
        : sort === "follows" ? (b.follows ?? 0) - (a.follows ?? 0)
          : (b.avg_watch_sec ?? 0) - (a.avg_watch_sec ?? 0));

    const cats = new Map<string, StatRow[]>();
    stats.forEach((s) => { const c = s.clip_posts?.clips?.category ?? "?"; cats.set(c, [...(cats.get(c) ?? []), s]); });
    const catRows = [...cats.entries()].map(([c, xs]) => ({ c, n: xs.length, plays: avg(xs.map((x) => x.plays)) ?? 0 }))
      .sort((a, b) => b.plays - a.plays);

    const slotRows = SLOTS.map((sl) => {
      const xs = stats.filter((s) => { const at = s.clip_posts?.posted_at; if (!at) return false; const h = bkkHour(at); return h >= sl.from && h < sl.to; });
      return { ...sl, n: xs.length, plays: avg(xs.map((x) => x.plays)) ?? 0 };
    });

    const perPage = pages.map((p) => {
      const xs = data.stats.filter((s) => s.page_id === p.id);
      const ds = data.days.filter((d) => d.page_id === p.id);
      const g = ds.length >= 2 ? (ds[ds.length - 1].followers ?? 0) - (ds[0].followers ?? 0) : null;
      return { p, n: xs.length, plays: sum(xs.map((x) => x.plays)), avgPlays: avg(xs.map((x) => x.plays)), gained: g };
    });

    return {
      pages, stats, series, followersNow, gained, ranked, catRows, slotRows, perPage,
      plays: sum(stats.map((s) => s.plays)), reach: sum(stats.map((s) => s.reach)),
      follows: sum(stats.map((s) => s.follows)), watch: avg(stats.map((s) => s.avg_watch_sec)),
      engage: sum(stats.map((s) => (s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0))),
    };
  }, [data, pageId, sort]);

  const pageName = (id: string) => data?.pages.find((p) => p.id === id)?.name ?? "";

  return (
    <div className="page-wrap">
      <div className="title-row">
        <div>
          <div className="eyebrow">ข้อมูลจาก Facebook · อัปเดตทุก 3 ชั่วโมง</div>
          <h1>ผลงาน</h1>
        </div>
        <Seg label="ช่วงเวลา" value={range} onChange={setRange}
          options={[{ value: 7, label: "7 วัน" }, { value: 30, label: "30 วัน" }, { value: 90, label: "90 วัน" }]} />
      </div>

      {!data || !view ? <div className="empty"><span className="spinner" /></div> : <>
        {data.missing && (
          <div className="banner warn"><div className="grow"><b>ยังไม่ได้เปิดที่เก็บสถิติ</b>
            <div className="small muted">ต้องรันไฟล์ supabase/migrations/0002_stats.sql ใน Supabase หนึ่งครั้ง</div></div></div>
        )}
        {!data.missing && data.posted > 0 && data.stats.length === 0 && (
          <Link href="/pages" className="banner warn"><div className="grow"><b>ยังไม่มีสถิติคลิป</b>
            <div className="small muted">ถ้าโพสต์ไปแล้วเกิน 3 ชั่วโมงยังว่าง ให้กด + เพิ่มเพจ แล้วเชื่อมต่อ Facebook ใหม่ เพื่ออนุญาตให้ระบบดูสถิติ</div></div>
            <span className="chev" /></Link>
        )}

        <div className="chips-scroll" role="group" aria-label="เลือกเพจ">
          <button type="button" className="page-chip" aria-pressed={pageId === "all"} onClick={() => setPageId("all")}>ทุกเพจ</button>
          {view.pages.map((p) => (
            <button key={p.id} type="button" className="page-chip" aria-pressed={pageId === p.id} onClick={() => setPageId(p.id)}>
              <Avatar name={p.name} src={p.picture_url} />{p.name}
            </button>
          ))}
        </div>

        <div className="kpis">
          <Kpi label="ผู้ติดตาม" value={compact(view.followersNow)} delta={view.gained} />
          <Kpi label="ยอดเล่นคลิป" value={compact(view.plays)} hint={`${view.stats.length} คลิปที่มีสถิติ`} />
          <Kpi label="ผู้ติดตามใหม่จากคลิป" value={compact(view.follows)} />
          <Kpi label="ดูเฉลี่ยต่อคลิป" value={view.watch != null ? `${view.watch.toFixed(1)} วิ` : "–"} hint={`ไลก์ คอมเมนต์ แชร์ ${compact(view.engage)}`} />
        </div>

        <div className="dash">
          <div className="dash-main">
            <div className="card">
              <div className="card-head"><b>ผู้ติดตาม</b><span className="muted small">{view.series.length ? `${view.series.length} วันที่บันทึก` : ""}</span></div>
              <Line series={view.series} />
            </div>

            <div className="card">
              <div className="card-head">
                <b>คลิปที่วิ่งดีที่สุด</b>
                <Seg label="เรียงตาม" value={sort} onChange={setSort}
                  options={[{ value: "plays", label: "ยอดเล่น" }, { value: "follows", label: "ผู้ติดตาม" }, { value: "watch", label: "ดูนาน" }]} />
              </div>
              {view.ranked.length === 0 && <p className="muted small" style={{ margin: 0 }}>ยังไม่มีข้อมูล สถิติจะขึ้นหลังโพสต์ราว 3 ชั่วโมง</p>}
              <ol className="rank">
                {view.ranked.slice(0, 10).map((s, i) => {
                  const c = s.clip_posts?.clips;
                  const thumb = publicUrl(c?.thumb_path ?? null);
                  const top = view.ranked[0]?.[sort === "watch" ? "avg_watch_sec" : sort] ?? 0;
                  const val = (sort === "watch" ? s.avg_watch_sec : s[sort]) ?? 0;
                  return (
                    <li key={s.post_id}>
                      <span className="rank-n">{i + 1}</span>
                      <span className="rank-thumb">{thumb ? <img src={thumb} alt="" /> : null}</span>
                      <div className="grow">
                        <div className="rank-title">{c?.topic || "ไม่มีชื่อหัวข้อ"}</div>
                        <div className="sub">{pageId === "all" ? `${pageName(s.page_id)} · ` : ""}{catShort(c?.category ?? "")}
                          {s.clip_posts?.posted_at ? ` · ${dayLabel(s.clip_posts.posted_at)} ${hm(s.clip_posts.posted_at)}` : ""}</div>
                        <div className="bar"><i style={{ width: `${top ? Math.max(4, (val / top) * 100) : 0}%` }} /></div>
                      </div>
                      <div className="rank-val">
                        <b>{sort === "watch" ? `${(s.avg_watch_sec ?? 0).toFixed(1)}วิ` : compact(val)}</b>
                        <span>{sort === "plays" ? "เล่น" : sort === "follows" ? "ติดตาม" : "เฉลี่ย"}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          <div className="dash-side">
            <div className="card">
              <div className="card-head"><b>หมวดที่ได้ผล</b><span className="muted small">ยอดเล่นเฉลี่ยต่อคลิป</span></div>
              <Bars rows={view.catRows.map((r) => ({ label: catShort(r.c), sub: `${r.n} คลิป`, v: r.plays }))} />
            </div>
            <div className="card">
              <div className="card-head"><b>เวลาที่ได้ผล</b><span className="muted small">ยอดเล่นเฉลี่ยต่อคลิป</span></div>
              <Bars rows={view.slotRows.map((r) => ({ label: r.label, sub: `${r.sub} น. · ${r.n} คลิป`, v: r.plays }))} />
            </div>
            {pageId === "all" && (
              <div className="card">
                <div className="card-head"><b>เทียบเพจ</b></div>
                <div className="cmp">
                  {view.perPage.map(({ p, n, plays, avgPlays, gained }) => (
                    <button key={p.id} type="button" className="cmp-row" onClick={() => setPageId(p.id)}>
                      <Avatar name={p.name} src={p.picture_url} />
                      <div className="grow">
                        <div className="rank-title">{p.name}</div>
                        <div className="sub">{n} คลิป · เฉลี่ย {avgPlays != null ? compact(Math.round(avgPlays)) : "–"} เล่น/คลิป</div>
                      </div>
                      <div className="rank-val"><b>{compact(plays)}</b>
                        <span className={gained && gained > 0 ? "up" : undefined}>{gained != null ? `${gained >= 0 ? "+" : ""}${compact(gained)} คน` : "–"}</span></div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </>}
    </div>
  );
}

function Kpi({ label, value, delta, hint }: { label: string; value: string; delta?: number | null; hint?: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b>{value}</b>
      {delta != null ? <em className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "▲" : "▼"} {compact(Math.abs(delta))} ในช่วงนี้</em>
        : <em>{hint ?? " "}</em>}
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; sub: string; v: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  if (!rows.some((r) => r.v > 0)) return <p className="muted small" style={{ margin: 0 }}>ยังไม่มีข้อมูล</p>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className="bars-row">
          <div className="bars-label"><span>{r.label}</span><span className="muted small">{r.sub}</span></div>
          <div className="bar big"><i style={{ width: `${(r.v / max) * 100}%` }} /></div>
          <b className="bars-v">{compact(Math.round(r.v))}</b>
        </div>
      ))}
    </div>
  );
}

function Line({ series }: { series: [string, number][] }) {
  if (series.length < 2) {
    return <p className="muted small" style={{ margin: 0 }}>ระบบเริ่มบันทึกยอดผู้ติดตามวันละครั้ง กราฟจะขึ้นเมื่อมีข้อมูลอย่างน้อย 2 วัน</p>;
  }
  const W = 600, H = 180, P = 8;
  const vs = series.map(([, v]) => v);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (i: number) => P + (i / (series.length - 1)) * (W - P * 2);
  const y = (v: number) => H - P - ((v - lo) / span) * (H - P * 2 - 10);
  const pts = series.map(([, v], i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const last = series[series.length - 1];
  return (
    <div className="line">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="กราฟผู้ติดตาม">
        <defs>
          <linearGradient id="lf" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--blue)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${x(0)},${H} ${pts.join(" ")} ${x(series.length - 1)},${H}`} fill="url(#lf)" />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--blue)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="line-axis">
        <span>{fmtDay(series[0][0])}</span>
        <span><b>{compact(last[1])}</b> ล่าสุด</span>
        <span>{fmtDay(last[0])}</span>
      </div>
    </div>
  );
}

const fmtDay = (ymd: string) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(new Date(`${ymd}T12:00:00+07:00`));
