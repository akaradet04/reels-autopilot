"use client";

import { useState } from "react";
import { useMe } from "@/components/Shell";
import { useLoad, useToast } from "@/components/ui";
import { saveSetting } from "@/lib/settings";
import { supabase } from "@/lib/supabase/client";

const CHECKS: { id: string; title: string; how: string }[] = [
  { id: "key", title: "เก็บ ENCRYPTION_KEY ไว้ในที่ส่วนตัว",
    how: "เปิดไฟล์ D:\\content-pipeline\\.env คัดลอกค่าหลัง ENCRYPTION_KEY= ไปเก็บในโน้ตส่วนตัวหรือโปรแกรมเก็บรหัสผ่าน ถ้าหาย ต้องใส่กุญแจทุกบริการใหม่หมด" },
  { id: "file", title: "ดาวน์โหลดไฟล์สำรองการตั้งค่า", how: "กดปุ่มด้านบน เก็บไฟล์ไว้ใน Google Drive หรืออีเมลส่วนตัว" },
  { id: "web", title: "เว็บออนไลน์แล้ว เปิดจากมือถือได้", how: "เว็บอยู่บน Vercel ไม่ใช่ localhost บนคอมนี้" },
  { id: "worker", title: "เครื่องผลิตคลิปรันบน GitHub", how: "หน้าสถานะระบบขึ้นว่าทำงานล่าสุดไม่เกิน 10–20 นาที แม้ปิดคอมนี้" },
  { id: "accounts", title: "ทุกบัญชีเป็นของส่วนตัวและกู้คืนได้",
    how: "GitHub, Supabase, Google AI Studio (Gemini), Facebook Developer, Pixabay, Groq, Vercel ใช้อีเมลส่วนตัว เปิดยืนยันตัวตน 2 ขั้น และเก็บรหัสกู้คืนไว้" },
  { id: "admins", title: "มีแอดมินสำรองอย่างน้อย 1 คน", how: "เพิ่มคนที่ไว้ใจเป็นแอดมินเพจและเพิ่มในหน้าตั้งค่า → ทีม เผื่อบัญชีคุณมีปัญหา" },
  { id: "cleanup", title: "ก่อนคืนคอมบริษัท: ลบข้อมูลลับออกจากเครื่อง",
    how: "ลบไฟล์ .env และ web\\.env.local, ลบโฟลเดอร์ D:\\tools, ออกจากระบบ GitHub/Supabase/Facebook ในเบราว์เซอร์ และลบรหัสที่บันทึกไว้ในเบราว์เซอร์" },
];

async function load() {
  const { data } = await supabase().from("settings").select("value").eq("key", "handover_checklist").maybeSingle();
  return ((data?.value as Record<string, string> | null) ?? {});
}

export default function Backup() {
  const me = useMe();
  const toast = useToast();
  const owner = me.role === "owner";
  const { data, setData, reload } = useLoad(load);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const db = supabase();
      const [settings, pages, styles, team] = await Promise.all([
        db.from("settings").select("key,value"),
        db.from("pages").select("fb_page_id,name,enabled,categories,clips_per_day,post_window_start,post_window_end,style_id,require_approval"),
        db.from("styles").select("id,name,config"),
        db.from("profiles").select("email,display_name,role"),
      ]);
      const skip = new Set(["worker_state", "telegram_link_code"]);
      const file = {
        app: "reels-autopilot", exported_at: new Date().toISOString(),
        note: "ไม่มีกุญแจ API หรือกุญแจ Facebook ในไฟล์นี้ ต้องใส่ใหม่หรือเชื่อมต่อใหม่ถ้าย้ายระบบ",
        settings: (settings.data ?? []).filter((r: { key: string }) => !skip.has(r.key)),
        pages: pages.data ?? [], styles: styles.data ?? [], team: team.data ?? [],
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `reels-autopilot-backup-${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(url);
      await tick("file", true);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function tick(id: string, on: boolean) {
    const next = { ...(data ?? {}) };
    if (on) next[id] = new Date().toISOString(); else delete next[id];
    setData(next);
    const err = await saveSetting("handover_checklist", next);
    if (err) { toast(err); reload(); }
  }

  if (!owner) return <div className="page-wrap narrow"><div className="empty"><b>เฉพาะเจ้าของระบบ</b></div></div>;
  const done = CHECKS.filter((c) => data?.[c.id]).length;

  return (
    <div className="page-wrap narrow">
      <div className="title-row"><div><div className="eyebrow">ทำครบแล้ว {done}/{CHECKS.length}</div><h1>สำรองและย้ายระบบ</h1></div></div>

      <div className="card">
        <b>ไฟล์สำรองการตั้งค่า</b>
        <p className="muted small" style={{ margin: 0 }}>
          เก็บเพจ หมวด เวลาโพสต์ สไตล์ ทีม และการตั้งค่าทั้งหมด ไม่มีรหัสลับอยู่ในไฟล์ โค้ดของระบบอยู่บน GitHub ของคุณแล้ว
        </p>
        <button className="btn block" disabled={busy} onClick={download}>{busy ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลดไฟล์สำรอง"}</button>
      </div>

      <div className="section-label">เช็กลิสต์ก่อนไม่ใช้คอมเครื่องนี้</div>
      <div className="group">
        {CHECKS.map((c) => {
          const at = data?.[c.id];
          return (
            <label key={c.id} className="row check-row">
              <input type="checkbox" checked={Boolean(at)} onChange={(e) => tick(c.id, e.target.checked)} />
              <span className="checkmark" aria-hidden="true" />
              <div className="grow">
                <div style={{ fontWeight: 600, textDecoration: at ? "line-through" : undefined, color: at ? "var(--muted)" : undefined }}>{c.title}</div>
                <div className="sub" style={{ whiteSpace: "normal" }}>{c.how}</div>
              </div>
            </label>
          );
        })}
      </div>
      <p className="note">ถ้าวันหนึ่งต้องย้ายไปเครื่องหรือบัญชีใหม่ ใช้โค้ดจาก GitHub + ENCRYPTION_KEY เดิม ฐานข้อมูลและกุญแจทั้งหมดยังอยู่ใน Supabase ใช้ต่อได้ทันที</p>
    </div>
  );
}
