"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { supabase } from "@/lib/supabase/client";
import type { Page } from "@/lib/types";
import { api, must, Seg, Sheet, useLoad, useToast } from "./ui";

export default function CreateClipSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const { data: pages } = useLoad(async () => must(await supabase().from("pages").select("id,name,enabled").order("name")) as Page[]);
  const [mode, setMode] = useState<"auto" | "upload">("auto");
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("news");
  const [picked, setPicked] = useState<string[]>([]);
  const [when, setWhen] = useState<"asap" | "at">("asap");
  const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 3600000).toISOString()));
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!picked.length) return toast("เลือกอย่างน้อย 1 เพจ");
    setBusy(true);
    try {
      let video_path: string | undefined;
      if (mode === "upload") {
        if (!file) throw new Error("เลือกไฟล์วิดีโอก่อน");
        if (file.size > 200 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 200MB");
        video_path = `uploads/${crypto.randomUUID()}.mp4`;
        const { error } = await supabase().storage.from("clips").upload(video_path, file, { contentType: "video/mp4" });
        if (error) throw new Error(`อัปโหลดไม่สำเร็จ: ${error.message}`);
      }
      const res = await api("/api/clips", "POST", {
        mode, topic, category, page_ids: picked, caption, video_path,
        when: when === "asap" ? "asap" : fromLocalInput(at),
      });
      toast(res.message ?? "เรียบร้อย");
      onCreated();
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="สร้างคลิปเอง" onClose={onClose}
      right={<button className="btn plain" style={{ fontWeight: 600 }} disabled={busy} onClick={submit}>{busy ? "กำลังส่ง…" : "สร้าง"}</button>}>
      <Seg label="วิธีสร้าง" value={mode} onChange={setMode}
        options={[{ value: "auto", label: "ให้ระบบทำทั้งหมด" }, { value: "upload", label: "อัปโหลดวิดีโอเอง" }]} />

      {mode === "auto" ? <>
        <input className="field" placeholder="หัวข้อ เช่น วิธีขอคืนภาษีออนไลน์" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="หัวข้อ" />
        <div className="group">
          <div className="row">
            <label className="grow" htmlFor="cat">หมวด</label>
            <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <p className="note" style={{ marginTop: -14 }}>ระบบเขียนบท ทำเสียง และตัดต่อตามสไตล์ของเพจแรกที่เลือก ใช้เวลาราว 5 นาที</p>
      </> : <>
        <input className="field" type="file" accept="video/mp4,video/quicktime" aria-label="ไฟล์วิดีโอ"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <textarea className="field" placeholder="คำบรรยายโพสต์" value={caption} onChange={(e) => setCaption(e.target.value)} aria-label="คำบรรยาย" />
        <p className="note" style={{ marginTop: -14 }}>วิดีโอแนวตั้ง 9:16 ยาว 3–90 วินาที ใช้คำบรรยายนี้กับทุกเพจที่เลือก</p>
      </>}

      <div className="section-label">ลงเพจ</div>
      <div className="group">
        {pages?.map((p) => (
          <label key={p.id} className="row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={picked.includes(p.id)} style={{ width: 22, height: 22, accentColor: "var(--blue)" }}
              onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((id) => id !== p.id)))} />
            <span className="grow">{p.name}</span>
            {!p.enabled && <span className="tag">ปิดอยู่</span>}
          </label>
        ))}
        {pages?.length === 0 && <div className="row muted">ยังไม่มีเพจ</div>}
      </div>

      <div className="section-label">เวลาโพสต์</div>
      <div className="group">
        <div className="row">
          <div className="grow"><Seg label="เวลาโพสต์" value={when} onChange={setWhen}
            options={[{ value: "asap", label: "เร็วที่สุด" }, { value: "at", label: "ตั้งเวลา" }]} /></div>
        </div>
        {when === "at" && (
          <div className="row">
            <label className="grow" htmlFor="at">เวลา</label>
            <input id="at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
        )}
      </div>
      <p className="note">ถ้าเลือกหลายเพจ ระบบโพสต์ห่างกันเพจละ 20–40 นาที</p>
    </Sheet>
  );
}
