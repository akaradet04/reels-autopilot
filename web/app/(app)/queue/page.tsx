"use client";

import { useState } from "react";
import ClipCard from "@/components/ClipCard";
import CreateClipSheet from "@/components/CreateClipSheet";
import { useMe } from "@/components/Shell";
import { must, Seg, useLoad } from "@/components/ui";
import { catShort } from "@/lib/categories";
import { hm } from "@/lib/format";
import { supabase } from "@/lib/supabase/client";
import type { Clip, ClipPost, PostStatus } from "@/lib/types";

type Filter = "open" | "posted" | "problem" | "calendar";
const FILTERS: Record<Filter, PostStatus[]> = {
  open: ["pending", "scheduled", "notified", "awaiting_approval", "posting"],
  posted: ["posted", "delete_requested", "deleted"],
  problem: ["failed", "cancelled"],
  calendar: ["pending", "scheduled", "notified", "awaiting_approval", "posting", "posted", "failed"],
};

async function load(filter: Filter) {
  let q = supabase().from("clip_posts")
    .select("*, pages(name), clips(id,category,topic,source_url,source_title,status,video_path,thumb_path,duration_sec,error,script,created_at)")
    .in("status", FILTERS[filter]);
  if (filter === "open") q = q.order("scheduled_at", { ascending: true }).limit(200);
  else if (filter === "calendar") q = q.gte("scheduled_at", new Date(Date.now() - 6 * 86400000).toISOString()).order("scheduled_at").limit(600);
  else q = q.gte("scheduled_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("scheduled_at", { ascending: false }).limit(200);
  const rows = must(await q) as (ClipPost & { clips: Clip })[];
  const groups = new Map<string, { clip: Clip; posts: ClipPost[] }>();
  for (const r of rows) {
    if (!r.clips) continue;
    const g = groups.get(r.clip_id) ?? { clip: r.clips, posts: [] };
    g.posts.push(r);
    groups.set(r.clip_id, g);
  }
  return { groups: Array.from(groups.values()), rows };
}

const DOT: Partial<Record<PostStatus, string>> = {
  posted: "var(--green)", failed: "var(--red)", awaiting_approval: "var(--orange)", posting: "var(--blue)",
};

function Calendar({ rows }: { rows: (ClipPost & { clips: Clip })[] }) {
  const key = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso));
  const days = new Map<string, (ClipPost & { clips: Clip })[]>();
  for (let i = 6; i >= -1; i--) days.set(key(new Date(Date.now() - i * 86400000).toISOString()), []);
  rows.forEach((r) => days.get(key(r.scheduled_at))?.push(r));
  const today = key(new Date().toISOString());
  return (
    <div className="cal">
      {[...days.entries()].reverse().map(([d, list]) => (
        <div key={d} className={`cal-day${d === today ? " today" : ""}`}>
          <div className="cal-head">
            <b>{d === today ? "วันนี้" : new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00+07:00`))}</b>
            <span className="muted small">{list.filter((x) => x.status === "posted").length}/{list.length} โพสต์</span>
          </div>
          {list.length === 0 && <div className="muted small">ไม่มีโพสต์</div>}
          {list.map((r) => (
            <div key={r.id} className="cal-item">
              <span className="mono muted">{hm(r.scheduled_at)}</span>
              <i style={{ background: DOT[r.status] ?? "var(--muted)" }} title={r.status} />
              <div className="grow">
                <div className="cal-topic">{r.clips?.topic || `คลิป${catShort(r.clips?.category ?? "")} · รอผลิต`}</div>
                <div className="sub">{r.pages?.name} · {catShort(r.clips?.category ?? "")}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Queue() {
  const me = useMe();
  const [filter, setFilter] = useState<Filter>("open");
  const [creating, setCreating] = useState(false);
  const { data, reload } = useLoad(() => load(filter), [filter], 30_000);

  return (
    <div className="page-wrap narrow">
      <div className="title-row">
        <div>
          <div className="eyebrow">คลิปโพสต์เองตามเวลา กดเพื่อเปลี่ยนได้</div>
          <h1>คิวคลิป</h1>
        </div>
        {me.role !== "reviewer" && <button className="btn tint small" onClick={() => setCreating(true)}>+ สร้างเอง</button>}
      </div>
      <Seg label="ตัวกรอง" value={filter} onChange={setFilter}
        options={[{ value: "open", label: "รอโพสต์" }, { value: "calendar", label: "ปฏิทิน" }, { value: "posted", label: "โพสต์แล้ว" }, { value: "problem", label: "ไม่สำเร็จ" }]} />

      {!data && <div className="empty"><span className="spinner" /></div>}
      {data && filter === "calendar" && <Calendar rows={data.rows} />}
      {data && filter !== "calendar" && data.groups.length === 0 && (
        <div className="empty">
          <b>{filter === "open" ? "ไม่มีคลิปรอโพสต์" : filter === "posted" ? "ยังไม่มีโพสต์ใน 7 วันนี้" : "ไม่มีรายการที่มีปัญหา"}</b>
          {filter === "open" && <span>ระบบวางแผนคลิปของวันใหม่ตอน 00:30 หรือกด “สร้างเอง” เพื่อทำคลิปตอนนี้</span>}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filter !== "calendar" && data?.groups.map(({ clip, posts }) => <ClipCard key={clip.id} clip={clip} posts={posts} onChange={reload} />)}
      </div>
      {creating && <CreateClipSheet onClose={() => setCreating(false)} onCreated={reload} />}
    </div>
  );
}
