"use client";

import { useState } from "react";
import { catShort } from "@/lib/categories";
import { dayLabel, fromLocalInput, hm, toLocalInput } from "@/lib/format";
import { publicUrl } from "@/lib/supabase/client";
import type { Clip, ClipPost, PostStatus } from "@/lib/types";
import { useMe } from "./Shell";
import { api, Icon, Sheet, useToast } from "./ui";

export const STATUS: Record<PostStatus, { label: string; tone: string }> = {
  pending: { label: "รอผลิต", tone: "" },
  scheduled: { label: "ตั้งเวลา", tone: "blue" },
  notified: { label: "แจ้งแล้ว", tone: "blue" },
  awaiting_approval: { label: "รออนุมัติ", tone: "orange" },
  posting: { label: "กำลังโพสต์", tone: "blue" },
  posted: { label: "โพสต์แล้ว", tone: "green" },
  failed: { label: "ไม่สำเร็จ", tone: "red" },
  cancelled: { label: "ยกเลิก", tone: "" },
  delete_requested: { label: "กำลังลบ", tone: "orange" },
  deleted: { label: "ลบแล้ว", tone: "" },
};

const OPEN: PostStatus[] = ["pending", "scheduled", "notified", "awaiting_approval"];

export function ClipThumb({ clip, onOpen }: { clip: Clip; onOpen: () => void }) {
  const thumb = publicUrl(clip.thumb_path);
  return (
    <button type="button" className="thumb" onClick={onOpen} aria-label="ดูคลิป" disabled={!clip.video_path}>
      {thumb ? <img src={thumb} alt="" /> : clip.status === "producing" ? <span className="spinner" /> :
        <span className="ph">{clip.status === "failed" ? "ผลิตไม่สำเร็จ" : clip.video_path ? "วิดีโอ" : "รอผลิต"}</span>}
      {clip.video_path && <span className="play"><Icon.play /></span>}
    </button>
  );
}

export default function ClipCard({ clip, posts, onChange }: { clip: Clip; posts: ClipPost[]; onChange: () => void }) {
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [watching, setWatching] = useState(false);

  const open = posts.filter((p) => OPEN.includes(p.status));
  const posted = posts.filter((p) => p.status === "posted");
  const waiting = posts.some((p) => p.status === "awaiting_approval");
  const title = clip.topic || (clip.status === "producing" ? `กำลังผลิตคลิป${catShort(clip.category)}`
    : clip.status === "planned" ? `คลิป${catShort(clip.category)} · ระบบจะเลือกหัวข้อตอนผลิต` : `คลิป${catShort(clip.category)}`);

  async function act(action: string) {
    setBusy(true);
    try {
      const res = await api(`/api/clips/${clip.id}/action`, "POST", { action });
      toast(res.message ?? "เรียบร้อย");
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <article className="clip">
      <ClipThumb clip={clip} onOpen={() => setWatching(true)} />
      <div className="body">
        <div className="title">{title}</div>
        <div className="meta">
          {catShort(clip.category)}
          {clip.duration_sec ? ` · ${Math.round(clip.duration_sec)} วินาที` : ""}
          {clip.source_url && <> · <a href={clip.source_url} target="_blank" rel="noreferrer">ข่าวต้นทาง</a></>}
        </div>
        <div className="posts">
          {posts.map((p) => (
            <div key={p.id}>
              <span className="mono muted">{dayLabel(p.scheduled_at)} {hm(p.posted_at || p.scheduled_at)}</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.pages?.name}</span>
              <span className={`tag ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
            </div>
          ))}
        </div>
        {posts.some((p) => p.error && p.status !== "posted") && (
          <div className="small" style={{ color: "var(--red)" }}>{posts.find((p) => p.error)?.error}</div>
        )}
        {clip.status === "failed" && clip.error && <div className="small" style={{ color: "var(--red)" }}>{clip.error.slice(0, 200)}</div>}
        {me.role && (open.length > 0 || posted.length > 0) && (
          <div className="actions">
            {waiting && <button className="btn small" disabled={busy} onClick={() => act("approve")}>อนุมัติ</button>}
            {open.length > 0 && <>
              <button className={`btn small ${waiting ? "tint" : ""}`} disabled={busy} onClick={() => act("post")}>โพสต์เลย</button>
              <button className="btn small tint" disabled={busy} onClick={() => setEditing(true)}>แก้ไข</button>
              <button className="btn small tint" disabled={busy} onClick={() => act("delay")}>เลื่อน 1 ชม.</button>
              <button className="btn small danger" disabled={busy} onClick={() => act("cancel")}>ยกเลิก</button>
            </>}
            {posted.length > 0 && open.length === 0 && (confirmDelete
              ? <button className="btn small danger" disabled={busy} onClick={() => act("delete")}>ยืนยันลบจาก Facebook</button>
              : <button className="btn small danger" onClick={() => setConfirmDelete(true)}>ลบโพสต์</button>)}
          </div>
        )}
      </div>

      {watching && clip.video_path && (
        <Sheet title={clip.topic || "คลิป"} onClose={() => setWatching(false)}>
          <video className="video-full" src={publicUrl(clip.video_path)!} controls autoPlay playsInline />
          {clip.script?.hook && <p className="small muted" style={{ margin: 0 }}>หัวเรื่อง: {clip.script.hook}</p>}
        </Sheet>
      )}
      {editing && <EditSheet posts={open} onClose={() => setEditing(false)} onSaved={onChange} />}
    </article>
  );
}

function EditSheet({ posts, onClose, onSaved }: { posts: ClipPost[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => posts.map((p) => ({ id: p.id, name: p.pages?.name ?? "", caption: p.caption ?? "", at: toLocalInput(p.scheduled_at) })));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      for (const d of draft) {
        await api(`/api/posts/${d.id}`, "PATCH", { caption: d.caption, scheduled_at: fromLocalInput(d.at) });
      }
      toast("บันทึกแล้ว");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="แก้ไขโพสต์" onClose={onClose} right={<button className="btn plain" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>บันทึก</button>}>
      {draft.map((d, i) => (
        <div key={d.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>{d.name}</div>
          <div className="group">
            <div className="row">
              <label className="grow" htmlFor={`at-${d.id}`}>เวลาโพสต์</label>
              <input id={`at-${d.id}`} type="datetime-local" value={d.at}
                onChange={(e) => setDraft((x) => x.map((y, j) => (j === i ? { ...y, at: e.target.value } : y)))} />
            </div>
          </div>
          <textarea className="field" aria-label={`คำบรรยาย ${d.name}`} value={d.caption}
            placeholder="คำบรรยายจะถูกเขียนให้อัตโนมัติเมื่อผลิตคลิปเสร็จ"
            onChange={(e) => setDraft((x) => x.map((y, j) => (j === i ? { ...y, caption: e.target.value } : y)))} />
        </div>
      ))}
    </Sheet>
  );
}
