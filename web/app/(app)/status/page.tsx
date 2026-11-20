"use client";

import Link from "next/link";
import { useMe } from "@/components/Shell";
import { api, Seg, useLoad, useToast } from "@/components/ui";
import { catShort } from "@/lib/categories";
import { bangkokDayStart, dayLabel, hm } from "@/lib/format";
import { saveSetting } from "@/lib/settings";
import { supabase } from "@/lib/supabase/client";

const FREE_GB = 5;
const GB = 1024 ** 3;
const SUPA_REF = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://x.supabase.co").hostname.split(".")[0];

interface Usage { cycle?: string; egress_bytes?: number; posts?: number; daily?: Record<string, number> }
interface WorkerState { last_tick?: string; usage?: Usage; throttled?: { date: string; planned: number; kept: number } }
interface Problem {
  id: string; category: string; topic: string | null; status: string; error: string | null; updated_at: string;
  clip_posts: { status: string; error: string | null; scheduled_at: string; pages: { name: string } | null }[];
}
interface Data {
  state: WorkerState; auto: boolean; budgetPct: number; billingDay: number;
  invalid: { fb_user_name: string | null; pages: { name: string } | null }[];
  today: { posted: number; failed: number; open: number };
  problems: Problem[];
}

async function load(): Promise<Data> {
  const db = supabase();
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const today = bangkokDayStart();
  const [settings, invalid, posts, problems] = await Promise.all([
    db.from("settings").select("key,value"),
    db.from("fb_connections").select("fb_user_name, pages(name)").eq("status", "invalid"),
    db.from("clip_posts").select("status").gte("scheduled_at", today),
    db.from("clips").select("id,category,topic,status,error,updated_at, clip_posts(status,error,scheduled_at,pages(name))")
      .gte("updated_at", since).order("updated_at", { ascending: false }).limit(60),
  ]);
  const s = Object.fromEntries((settings.data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const ps = (posts.data ?? []) as { status: string }[];
  const probs = ((problems.data ?? []) as unknown as Problem[])
    .filter((c) => c.status === "failed" || c.clip_posts.some((p) => p.status === "failed"));
  return {
    state: (s.worker_state as WorkerState) ?? {},
    auto: Boolean(s.automation_enabled),
    budgetPct: Number(s.egress_budget_pct ?? 70),
    billingDay: Number(s.billing_day ?? 18),
    invalid: (invalid.data ?? []) as unknown as Data["invalid"],
    today: {
      posted: ps.filter((p) => p.status === "posted").length,
      failed: ps.filter((p) => p.status === "failed").length,
      open: ps.filter((p) => ["pending", "scheduled", "notified", "awaiting_approval", "posting"].includes(p.status)).length,
    },
    problems: probs,
  };
}

const mb = (b: number) => (b >= GB ? `${(b / GB).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`);

function cycleEnd(start: string): Date {
  const d = new Date(`${start}T00:00:00+07:00`);
  return new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export default function Status() {
  const me = useMe();
  const toast = useToast();
  const owner = me.role === "owner";
  const { data, reload, setData } = useLoad(load, [], 60_000);

  if (!data) return <div className="page-wrap narrow"><div className="empty"><span className="spinner" /></div></div>;

  const last = data.state.last_tick ? new Date(data.state.last_tick) : null;
  const ago = last ? Math.round((Date.now() - last.getTime()) / 60000) : null;
  const workerOk = ago != null && ago <= 25;

  const u = data.state.usage ?? {};
  const used = u.egress_bytes ?? 0;
  const start = u.cycle;
  const end = start ? cycleEnd(start) : null;
  const daysIn = start ? Math.max(1, (Date.now() - new Date(`${start}T00:00:00+07:00`).getTime()) / 86400000) : 1;
  const daysTotal = start && end ? (end.getTime() - new Date(`${start}T00:00:00+07:00`).getTime()) / 86400000 : 30;
  const projected = (used / daysIn) * daysTotal;
  const budget = FREE_GB * GB * (data.budgetPct >= 100 ? 1 : data.budgetPct / 100);
  const pct = Math.min(100, (used / (FREE_GB * GB)) * 100);
  const projPct = Math.min(100, (projected / (FREE_GB * GB)) * 100);
  const daily = Object.entries(u.daily ?? {}).slice(-14);
  const maxDay = Math.max(1, ...daily.map(([, v]) => v));
  const throttled = data.state.throttled && data.state.throttled.date === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date())
    ? data.state.throttled : null;

  const issues = [
    !data.auto && "ระบบอัตโนมัติถูกปิดอยู่",
    !workerOk && "เครื่องผลิตคลิปไม่ได้ทำงานเกิน 25 นาที",
    data.invalid.length > 0 && `กุญแจ Facebook ใช้ไม่ได้ ${data.invalid.length} รายการ`,
    projected > budget && "แบนด์วิดท์เดือนนี้อาจเกินที่ตั้งไว้",
    data.problems.length > 0 && `มีงานล้มเหลว ${data.problems.length} คลิปใน 3 วัน`,
  ].filter(Boolean) as string[];

  async function setBudget(v: number) {
    setData((d) => d && { ...d, budgetPct: v });
    const err = await saveSetting("egress_budget_pct", v);
    if (err) { toast(err); reload(); } else toast("บันทึกแล้ว มีผลกับการวางแผนวันถัดไป");
  }

  async function retry(id: string) {
    try {
      toast((await api(`/api/clips/${id}/action`, "POST", { action: "retry" })).message ?? "สั่งแล้ว");
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="page-wrap narrow">
      <div className="title-row"><div><div className="eyebrow">อัปเดตทุก 1 นาที</div><h1>สถานะระบบ</h1></div></div>

      <div className={`hero ${issues.length ? "warn" : "ok"}`}>
        <span className="hero-dot" />
        <div className="grow">
          <b>{issues.length ? `ต้องดู ${issues.length} เรื่อง` : "ทุกอย่างปกติ"}</b>
          <div className="small">{issues.length ? issues.join(" · ") : "ผลิตและโพสต์ตามแผน ไม่มีอะไรต้องทำ"}</div>
        </div>
      </div>

      <div className="section-label">เครื่องผลิตคลิป</div>
      <div className="group">
        <div className="row"><div className="grow">ทำงานล่าสุด<div className="sub">ควรทำงานทุก 10 นาทีบน GitHub</div></div>
          <span className={`tag ${workerOk ? "green" : "red"}`}>{last ? `${dayLabel(last.toISOString())} ${hm(last.toISOString())} · ${ago} นาทีก่อน` : "ยังไม่เคย"}</span></div>
        <div className="row"><div className="grow">วันนี้</div>
          <span className="val">โพสต์แล้ว {data.today.posted} · รอ {data.today.open} · ล้มเหลว <span style={{ color: data.today.failed ? "var(--red)" : undefined }}>{data.today.failed}</span></span></div>
        <a className="row chev" href="https://github.com/akaradet04/reels-autopilot/actions" target="_blank" rel="noreferrer">
          <div className="grow">ดูการทำงานบน GitHub<div className="sub">ถ้าหยุดนาน ให้กด Run workflow ในหน้านั้น</div></div></a>
      </div>

      <div className="section-label">แบนด์วิดท์ Supabase (ฟรี {FREE_GB} GB/เดือน)</div>
      <div className="card">
        <div className="meter-head">
          <div><b className="big-num">{mb(used)}</b><span className="muted small"> ใช้ไปแล้วรอบนี้</span></div>
          <span className="muted small">{end ? `รีเซ็ต ${new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(end)}` : ""}</span>
        </div>
        <div className="meter">
          <i className="proj" style={{ width: `${projPct}%` }} />
          <i style={{ width: `${pct}%` }} />
          <span className="limit" style={{ left: `${Math.min(100, data.budgetPct)}%` }} title="เพดานที่ตั้งไว้" />
        </div>
        <div className="small muted">
          คาดว่าสิ้นรอบจะใช้ราว <b style={{ color: projected > budget ? "var(--red)" : "var(--fg)" }}>{mb(projected)}</b>
          {" "}({Math.round(projPct)}%) · โพสต์ไปแล้ว {u.posts ?? 0} ครั้ง
          {u.posts ? ` · เฉลี่ย ${mb(used / u.posts)}/โพสต์` : ""}
        </div>
        {throttled && <div className="banner warn small">วันนี้ระบบลดคลิปจาก {throttled.planned} เหลือ {throttled.kept} คลิป เพื่อไม่ให้เกินเพดาน</div>}
        {daily.length > 1 && (
          <div className="mini-bars" aria-label="แบนด์วิดท์รายวัน">
            {daily.map(([d, v]) => <i key={d} title={`${d}: ${mb(v)}`} style={{ height: `${Math.max(4, (v / maxDay) * 100)}%` }} />)}
          </div>
        )}
        <div className="row" style={{ padding: 0, minHeight: 0, boxShadow: "none" }}>
          <div className="grow small">ไม่ให้ใช้เกิน<div className="sub">ถ้าจะเกิน ระบบลดจำนวนคลิปของวันลงเอง</div></div>
          <Seg label="เพดานแบนด์วิดท์" value={data.budgetPct} onChange={(v) => owner && setBudget(v)}
            options={[{ value: 50, label: "50%" }, { value: 70, label: "70%" }, { value: 90, label: "90%" }, { value: 100, label: "ไม่จำกัด" }]} />
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          ตัวเลขนี้ระบบประเมินจากขนาดไฟล์ × จำนวนโพสต์ ตัวเลขจริงดูได้ที่{" "}
          <a href={`https://supabase.com/dashboard/project/${SUPA_REF}/settings/billing/usage`} target="_blank" rel="noreferrer">หน้า Usage ของ Supabase</a>
        </p>
      </div>

      <div className="section-label">กุญแจ Facebook</div>
      <div className="group">
        {data.invalid.length === 0 && <div className="row"><div className="grow">ใช้ได้ทุกเพจ</div><span className="tag green">ปกติ</span></div>}
        {data.invalid.map((c, i) => (
          <Link key={i} href="/pages" className="row chev"><div className="grow">{c.pages?.name}<div className="sub">ของ {c.fb_user_name} · กดเชื่อมต่อ Facebook ใหม่</div></div>
            <span className="tag red">ใช้ไม่ได้</span></Link>
        ))}
      </div>

      <div className="section-label">งานที่ล้มเหลว (3 วันล่าสุด)</div>
      <div className="group">
        {data.problems.length === 0 && <div className="row muted">ไม่มี</div>}
        {data.problems.map((c) => {
          const failedPosts = c.clip_posts.filter((p) => p.status === "failed");
          const why = c.status === "failed" ? c.error : failedPosts[0]?.error;
          return (
            <div key={c.id} className="row" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{c.topic || `คลิป${catShort(c.category)}`}</div>
                <div className="sub" style={{ whiteSpace: "normal" }}>
                  {c.status === "failed" ? "ผลิตไม่สำเร็จ" : `โพสต์ไม่สำเร็จ ${failedPosts.length} เพจ (${failedPosts.map((p) => p.pages?.name).join(", ")})`}
                  {why ? ` · ${why.slice(0, 160)}` : ""}
                </div>
              </div>
              {me.role !== "reviewer" && <button className="btn tint small" onClick={() => retry(c.id)}>ลองใหม่</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
