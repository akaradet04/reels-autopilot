"use client";

import { useState } from "react";
import ClipCard from "@/components/ClipCard";
import CreateClipSheet from "@/components/CreateClipSheet";
import { useMe } from "@/components/Shell";
import { must, Seg, useLoad } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import type { Clip, ClipPost, PostStatus } from "@/lib/types";

type Filter = "open" | "posted" | "problem";
const FILTERS: Record<Filter, PostStatus[]> = {
  open: ["pending", "scheduled", "notified", "awaiting_approval", "posting"],
  posted: ["posted", "delete_requested", "deleted"],
  problem: ["failed", "cancelled"],
};

async function load(filter: Filter) {
  let q = supabase().from("clip_posts")
    .select("*, pages(name), clips(id,category,topic,source_url,source_title,status,video_path,thumb_path,duration_sec,error,script,created_at)")
    .in("status", FILTERS[filter]);
  if (filter === "open") q = q.order("scheduled_at", { ascending: true }).limit(200);
  else q = q.gte("scheduled_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("scheduled_at", { ascending: false }).limit(200);
  const rows = must(await q) as (ClipPost & { clips: Clip })[];
  const groups = new Map<string, { clip: Clip; posts: ClipPost[] }>();
  for (const r of rows) {
    if (!r.clips) continue;
    const g = groups.get(r.clip_id) ?? { clip: r.clips, posts: [] };
    g.posts.push(r);
    groups.set(r.clip_id, g);
  }
  return Array.from(groups.values());
}

export default function Queue() {
  const me = useMe();
  const [filter, setFilter] = useState<Filter>("open");
  const [creating, setCreating] = useState(false);
  const { data, reload } = useLoad(() => load(filter), [filter], 30_000);

  return (
    <div className="page-wrap">
      <div className="title-row">
        <div>
          <div className="eyebrow">คลิปโพสต์เองตามเวลา กดเพื่อเปลี่ยนได้</div>
          <h1>คิวคลิป</h1>
        </div>
        {me.role !== "reviewer" && <button className="btn tint small" onClick={() => setCreating(true)}>+ สร้างเอง</button>}
      </div>
      <Seg label="ตัวกรอง" value={filter} onChange={setFilter}
        options={[{ value: "open", label: "รอโพสต์" }, { value: "posted", label: "โพสต์แล้ว" }, { value: "problem", label: "ไม่สำเร็จ/ยกเลิก" }]} />

      {!data && <div className="empty"><span className="spinner" /></div>}
      {data && data.length === 0 && (
        <div className="empty">
          <b>{filter === "open" ? "ไม่มีคลิปรอโพสต์" : filter === "posted" ? "ยังไม่มีโพสต์ใน 7 วันนี้" : "ไม่มีรายการที่มีปัญหา"}</b>
          {filter === "open" && <span>ระบบวางแผนคลิปของวันใหม่ตอน 00:30 หรือกด “สร้างเอง” เพื่อทำคลิปตอนนี้</span>}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data?.map(({ clip, posts }) => <ClipCard key={clip.id} clip={clip} posts={posts} onChange={reload} />)}
      </div>
      {creating && <CreateClipSheet onClose={() => setCreating(false)} onCreated={reload} />}
    </div>
  );
}
