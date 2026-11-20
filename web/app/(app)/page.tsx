"use client";

import Link from "next/link";
import { STATUS } from "@/components/ClipCard";
import { useMe } from "@/components/Shell";
import { api, must, Switch, useLoad, useToast } from "@/components/ui";
import { bangkokDayStart, compact, dayLabel, hm, longDate } from "@/lib/format";
import { supabase } from "@/lib/supabase/client";
import type { ClipPost } from "@/lib/types";

const OPEN = ["pending", "scheduled", "notified", "awaiting_approval", "posting"];

interface HomeData {
  auto: boolean;
  telegram: boolean;
  lastTick: string | null;
  pagesOn: number;
  followers: number;
  invalid: number;
  producedToday: number;
  plannedToday: number;
  postedToday: number;
  openToday: number;
  failedToday: number;
  next: (ClipPost & { clips: { topic: string | null; category: string } | null })[];
  week: number;
}

async function load(): Promise<HomeData> {
  const db = supabase();
  const today = bangkokDayStart();
  const tomorrow = new Date(new Date(today).getTime() + 86400000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

  const [settings, pages, conns, clipsToday, postsToday, next, week] = await Promise.all([
    db.from("settings").select("key,value"),
    db.from("pages").select("enabled,followers"),
    db.from("fb_connections").select("status"),
    db.from("clips").select("status").eq("plan_date", ymd),
    db.from("clip_posts").select("status").gte("scheduled_at", today).lt("scheduled_at", tomorrow),
    db.from("clip_posts").select("*, pages(name), clips(topic,category)").in("status", OPEN)
      .order("scheduled_at").limit(6),
    db.from("clip_posts").select("id", { count: "exact", head: true }).eq("status", "posted").gte("posted_at", weekAgo),
  ]);
  const s = Object.fromEntries(must(settings).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const p = must(pages) as { enabled: boolean; followers: number | null }[];
  const ct = must(clipsToday) as { status: string }[];
  const pt = must(postsToday) as { status: string }[];
  return {
    auto: Boolean(s.automation_enabled),
    telegram: Boolean(s.telegram_chat_id),
    lastTick: (s.worker_state as { last_tick?: string } | undefined)?.last_tick ?? null,
    pagesOn: p.filter((x) => x.enabled).length,
    followers: p.reduce((a, x) => a + (x.followers ?? 0), 0),
    invalid: (must(conns) as { status: string }[]).filter((c) => c.status === "invalid").length,
    producedToday: ct.filter((c) => c.status === "ready").length,
    plannedToday: ct.filter((c) => c.status !== "cancelled").length,
    postedToday: pt.filter((x) => x.status === "posted").length,
    openToday: pt.filter((x) => OPEN.includes(x.status)).length,
    failedToday: pt.filter((x) => x.status === "failed").length,
    next: must(next) as HomeData["next"],
    week: week.count ?? 0,
  };
}

export default function Home() {
  const me = useMe();
  const toast = useToast();
  const { data, reload, setData } = useLoad(load, [], 60_000);

  async function setAuto(v: boolean) {
    setData((d) => (d ? { ...d, auto: v } : d));
    const { error } = await supabase().from("settings").update({ value: v }).eq("key", "automation_enabled");
    if (error) {
      toast(error.message);
      reload();
    } else toast(v ? "เปิดระบบอัตโนมัติแล้ว" : "หยุดระบบชั่วคราวแล้ว ไม่มีการผลิตหรือโพสต์จนกว่าจะเปิด");
  }

  async function runNow() {
    try {
      toast((await api("/api/run")).message ?? "สั่งแล้ว");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const pct = data && data.plannedToday ? Math.round((data.producedToday / data.plannedToday) * 100) : 0;

  return (
    <div className="page-wrap narrow">
      <div className="title-row">
        <div>
          <div className="eyebrow">{longDate()}</div>
          <h1>สวัสดี{me.display_name ? ` ${me.display_name}` : ""}</h1>
        </div>
        {me.role !== "reviewer" && <button className="btn tint small" onClick={runNow}>ให้ระบบทำงานตอนนี้</button>}
      </div>

      {data && <>
        {me.role === "owner" && !data.telegram && (
          <Link href="/settings" className="banner warn">
            <div className="grow"><b>ยังไม่ได้เชื่อม Telegram</b><div className="small muted">เชื่อมเพื่อรับแจ้งเตือนก่อนโพสต์ และกดโพสต์เลย เลื่อน หรือยกเลิกจากมือถือ</div></div>
            <span className="chev" />
          </Link>
        )}
        {data.pagesOn === 0 && (
          <Link href="/pages" className="banner warn">
            <div className="grow"><b>ยังไม่มีเพจที่เปิดใช้งาน</b><div className="small muted">เชื่อมต่อ Facebook แล้วเปิดเพจ เลือกหมวด และจำนวนคลิปต่อวัน</div></div>
            <span className="chev" />
          </Link>
        )}
        {data.invalid > 0 && (
          <Link href="/settings" className="banner error">
            <div className="grow"><b>กุญแจ Facebook ใช้ไม่ได้ {data.invalid} รายการ</b><div className="small muted">กดเชื่อมต่อ Facebook ใหม่ในหน้าตั้งค่า</div></div>
            <span className="chev" />
          </Link>
        )}

        <div className="group">
          <div className="row">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>ระบบอัตโนมัติ</div>
              <div className="sub">
                {data.auto ? "กำลังทำงาน" : "หยุดชั่วคราว"}
                {data.lastTick ? ` · ทำงานล่าสุด ${dayLabel(data.lastTick)} ${hm(data.lastTick)}` : " · ยังไม่เคยทำงาน"}
              </div>
            </div>
            <Switch label="เปิดปิดระบบอัตโนมัติ" checked={data.auto} onChange={setAuto} disabled={me.role !== "owner"} />
          </div>
          <Link href="/status" className="row chev">
            <div className="grow">สถานะระบบ<div className="sub">เครื่องผลิตคลิป แบนด์วิดท์ งานที่ล้มเหลว</div></div>
            {(() => {
              const ago = data.lastTick ? (Date.now() - new Date(data.lastTick).getTime()) / 60000 : 999;
              return <span className={`tag ${ago <= 25 && data.failedToday === 0 ? "green" : "orange"}`}>{ago <= 25 ? (data.failedToday ? `ล้มเหลว ${data.failedToday}` : "ปกติ") : "เครื่องหยุด"}</span>;
            })()}
          </Link>
        </div>

        <div className="stats">
          <div className="stat"><b>{data.producedToday}<span style={{ fontSize: 15 }}>/{data.plannedToday}</span></b><span>ผลิตแล้ววันนี้</span></div>
          <div className="stat"><b>{data.postedToday}</b><span>โพสต์แล้ววันนี้</span></div>
          <div className="stat"><b>{data.openToday}</b><span>รอโพสต์วันนี้</span></div>
        </div>
        <div className="progress" aria-label={`ผลิตแล้ว ${pct}%`}><i style={{ width: `${pct}%` }} /></div>

        <div className="section-label">โพสต์ถัดไป</div>
        <div className="group">
          {data.next.length === 0 && <div className="row muted">ยังไม่มีโพสต์ที่รออยู่ ระบบวางแผนวันใหม่ตอน 00:30</div>}
          {data.next.map((p) => (
            <Link key={p.id} href="/queue" className="row">
              <span className="mono muted" style={{ width: 64, fontSize: 14 }}>{dayLabel(p.scheduled_at) === "วันนี้" ? "" : dayLabel(p.scheduled_at) + " "}{hm(p.scheduled_at)}</span>
              <div className="grow">
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.clips?.topic || "รอผลิต"}</div>
                <div className="sub">{p.pages?.name}</div>
              </div>
              <span className={`tag ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
            </Link>
          ))}
        </div>

        <div className="section-label">ภาพรวม</div>
        <div className="group">
          <div className="row"><div className="grow">เพจที่เปิดใช้งาน</div><span className="val">{data.pagesOn}</span></div>
          <div className="row"><div className="grow">ผู้ติดตามรวมทุกเพจ</div><span className="val">{compact(data.followers)}</span></div>
          <div className="row"><div className="grow">โพสต์ 7 วันล่าสุด</div><span className="val">{data.week}</span></div>
          <div className="row"><div className="grow">ไม่สำเร็จวันนี้</div><span className="val" style={{ color: data.failedToday ? "var(--red)" : undefined }}>{data.failedToday}</span></div>
        </div>
      </>}
      {!data && <div className="empty"><span className="spinner" /></div>}
    </div>
  );
}
