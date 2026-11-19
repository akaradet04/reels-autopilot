"use client";

import { useEffect, useState } from "react";
import { useMe } from "@/components/Shell";
import Link from "next/link";
import { api, Avatar, must, Sheet, Stepper, Switch, useLoad, useToast } from "@/components/ui";
import { CATEGORIES, catShort } from "@/lib/categories";
import { compact, shortTime } from "@/lib/format";
import { supabase } from "@/lib/supabase/client";
import type { Page, Style } from "@/lib/types";

interface Conn { id: string; page_id: string; fb_user_name: string | null; role: string; status: string }

async function load() {
  const db = supabase();
  const [pages, styles, conns] = await Promise.all([
    db.from("pages").select("*").order("created_at"),
    db.from("styles").select("id,name,config").order("created_at"),
    db.from("fb_connections").select("id,page_id,fb_user_name,role,status"),
  ]);
  return { pages: must(pages) as Page[], styles: must(styles) as Style[], conns: (conns.data ?? []) as Conn[] };
}

export default function Pages() {
  const me = useMe();
  const toast = useToast();
  const { data, reload, setData } = useLoad(load);
  const [editing, setEditing] = useState<Page | null>(null);
  const [adding, setAdding] = useState(false);
  const canEdit = me.role === "owner" || me.role === "admin";
  const fb = useLoad(() => api<{ configured: boolean }>("/api/facebook/status", "GET"));
  const connectButton = fb.data && !fb.data.configured ? (
    me.role === "owner"
      ? <Link className="btn block" href="/settings">ตั้งค่า Facebook App ก่อน</Link>
      : <p className="muted" style={{ margin: 0 }}>รอเจ้าของระบบตั้งค่า Facebook App ในหน้าตั้งค่าก่อน</p>
  ) : <a className="btn fb block" href="/api/facebook/login">เชื่อมต่อด้วย Facebook</a>;

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("fb_error")) toast(`เชื่อมต่อไม่สำเร็จ: ${q.get("fb_error")}`);
    else if (q.has("fb_connected")) {
      const added = Number(q.get("fb_added") || 0);
      const conn = Number(q.get("fb_connected") || 0);
      toast(added ? `เพิ่ม ${added} เพจใหม่ เปิดใช้งานและตั้งหมวดได้เลย` : `อัปเดตการเชื่อมต่อ ${conn} เพจแล้ว`);
    }
    if (q.toString()) window.history.replaceState(null, "", "/pages");
  }, [toast]);

  async function toggle(p: Page, enabled: boolean) {
    if (enabled && !p.categories.length) {
      setEditing({ ...p, enabled: true });
      return toast("เลือกหมวดเนื้อหาก่อนเปิดใช้งาน");
    }
    setData((d) => d && { ...d, pages: d.pages.map((x) => (x.id === p.id ? { ...x, enabled } : x)) });
    const { error } = await supabase().from("pages").update({ enabled }).eq("id", p.id);
    if (error) {
      toast(error.message);
      reload();
    }
  }

  const on = data?.pages.filter((p) => p.enabled).length ?? 0;

  return (
    <div className="page-wrap">
      <div className="title-row">
        <div>
          <div className="eyebrow">{data ? `${data.pages.length} เพจ · เปิดอยู่ ${on}` : " "}</div>
          <h1>เพจ</h1>
        </div>
        {canEdit && <button className="btn small" onClick={() => setAdding(true)}>+ เพิ่มเพจ</button>}
      </div>

      {data && data.pages.length === 0 && (
        <div className="empty">
          <b>ยังไม่มีเพจในระบบ</b>
          <span>กดเชื่อมต่อ Facebook แล้วเลือกเพจที่ต้องการให้ระบบดูแล</span>
          {canEdit && <div style={{ width: "100%", maxWidth: 320 }}>{connectButton}</div>}
        </div>
      )}

      {data && data.pages.length > 0 && (
        <div className="group">
          {data.pages.map((p) => {
            const conns = data.conns.filter((c) => c.page_id === p.id);
            const broken = conns.length > 0 && conns.every((c) => c.status !== "ok");
            return (
              <div key={p.id} className="row">
                <button type="button" className="row chev" style={{ padding: 0, minHeight: 0, flex: 1, minWidth: 0 }}
                  onClick={() => setEditing(p)} disabled={!canEdit}>
                  <Avatar name={p.name} src={p.picture_url} />
                  <div className="grow">
                    <div>{p.name} {broken && <span className="tag red">กุญแจใช้ไม่ได้</span>}</div>
                    <div className="sub">
                      {compact(p.followers)} · {p.clips_per_day} คลิป/วัน · {p.categories.length ? p.categories.map(catShort).join(", ") : "ยังไม่ได้เลือกหมวด"}
                    </div>
                  </div>
                </button>
                <Switch label={`เปิดใช้งาน ${p.name}`} checked={p.enabled} disabled={!canEdit} onChange={(v) => toggle(p, v)} />
              </div>
            );
          })}
        </div>
      )}
      {data && data.pages.length > 0 && (
        <p className="note">คลิปหนึ่งตัวถูกส่งไปทุกเพจที่ใช้สไตล์เดียวกันและเลือกหมวดเดียวกัน จึงไม่ต้องผลิตซ้ำ ระบบเขียนคำบรรยายไม่ซ้ำกันให้แต่ละเพจ</p>
      )}

      {editing && data && (
        <PageSheet page={editing} styles={data.styles} conns={data.conns.filter((c) => c.page_id === editing.id)}
          onClose={() => setEditing(null)} onSaved={reload} />
      )}
      {adding && (
        <Sheet title="เพิ่มเพจ" onClose={() => setAdding(false)}>
          <p style={{ margin: 0 }}>ระบบจะพาไปหน้า Facebook ให้คุณเลือกเพจที่จะให้ระบบดูแล เพจใหม่จะเข้ามาแบบปิดไว้ก่อน แล้วค่อยตั้งหมวดและเปิดใช้งาน</p>
          {connectButton}
          <div className="group">
            <div className="row small muted">ระบบโพสต์ในนามเพจ ไม่ใช่โปรไฟล์ของคุณ และไม่ล็อกอินเข้าบัญชีของคุณ</div>
            <div className="row small muted">ถ้าคุณเป็นแอดมินสำรอง กดปุ่มเดียวกันนี้ ระบบจะเก็บกุญแจของคุณไว้ใช้เมื่อกุญแจหลักใช้ไม่ได้</div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function PageSheet({ page, styles, conns, onClose, onSaved }: {
  page: Page; styles: Style[]; conns: Conn[]; onClose: () => void; onSaved: () => void;
}) {
  const me = useMe();
  const toast = useToast();
  const [p, setP] = useState(page);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Page>(k: K, v: Page[K]) => setP((x) => ({ ...x, [k]: v }));

  async function save() {
    if (p.enabled && !p.categories.length) return toast("เลือกหมวดเนื้อหาอย่างน้อย 1 หมวด");
    if (shortTime(p.post_window_end) <= shortTime(p.post_window_start)) return toast("เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
    setBusy(true);
    const { error } = await supabase().from("pages").update({
      enabled: p.enabled, categories: p.categories, clips_per_day: p.clips_per_day,
      post_window_start: shortTime(p.post_window_start), post_window_end: shortTime(p.post_window_end),
      style_id: p.style_id, require_approval: p.require_approval,
    }).eq("id", p.id);
    setBusy(false);
    if (error) return toast(error.message);
    toast("บันทึกแผนของเพจแล้ว มีผลตั้งแต่รอบวางแผนถัดไป");
    onSaved();
    onClose();
  }

  async function remove() {
    const { error } = await supabase().from("pages").delete().eq("id", p.id);
    if (error) return toast(error.message);
    toast("ลบเพจออกจากระบบแล้ว");
    onSaved();
    onClose();
  }

  return (
    <Sheet title={page.name} onClose={onClose}
      left={<button className="btn plain" onClick={onClose}>ยกเลิก</button>}
      right={<button className="btn plain" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>บันทึก</button>}>
      <div className="group">
        <div className="row"><div className="grow">เปิดใช้งานเพจนี้</div><Switch label="เปิดใช้งาน" checked={p.enabled} onChange={(v) => set("enabled", v)} /></div>
      </div>

      <div className="section-label">หมวดเนื้อหา</div>
      <div className="group">
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button key={c.slug} type="button" aria-pressed={p.categories.includes(c.slug)}
              onClick={() => set("categories", p.categories.includes(c.slug) ? p.categories.filter((x) => x !== c.slug) : [...p.categories, c.slug])}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="section-label">แผนการโพสต์</div>
      <div className="group">
        <div className="row"><div className="grow">คลิปต่อวัน</div><Stepper label="คลิปต่อวัน" value={p.clips_per_day} min={1} max={8} onChange={(v) => set("clips_per_day", v)} /></div>
        <div className="row"><label className="grow" htmlFor="ws">เริ่มโพสต์</label><input id="ws" type="time" value={shortTime(p.post_window_start)} onChange={(e) => set("post_window_start", e.target.value)} /></div>
        <div className="row"><label className="grow" htmlFor="we">โพสต์สุดท้าย</label><input id="we" type="time" value={shortTime(p.post_window_end)} onChange={(e) => set("post_window_end", e.target.value)} /></div>
        <div className="row">
          <label className="grow" htmlFor="st">สไตล์คลิป</label>
          <select id="st" value={p.style_id ?? ""} onChange={(e) => set("style_id", e.target.value || null)}>
            <option value="">ค่าเริ่มต้น</option>
            {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="row">
          <div className="grow">ต้องอนุมัติก่อนโพสต์<div className="sub">ปิดไว้ = โพสต์อัตโนมัติตามเวลา</div></div>
          <Switch label="ต้องอนุมัติก่อนโพสต์" checked={p.require_approval} onChange={(v) => set("require_approval", v)} />
        </div>
      </div>
      <p className="note">Facebook แนะนำไม่เกิน 8 Reels ต่อเพจต่อวัน ระบบจำกัดไว้ที่ 8</p>

      <div className="section-label">การเชื่อมต่อ Facebook</div>
      <div className="group">
        {conns.length === 0 && <div className="row muted">ยังไม่มีกุญแจของเพจนี้ กดเชื่อมต่อ Facebook ใหม่</div>}
        {conns.sort((a, b) => (a.role === "primary" ? -1 : 1) - (b.role === "primary" ? -1 : 1)).map((c) => (
          <div key={c.id} className="row">
            <div className="grow">{c.role === "primary" ? "กุญแจหลัก" : "แอดมินสำรอง"}<div className="sub">จากบัญชี {c.fb_user_name}</div></div>
            <span className={`tag ${c.status === "ok" ? "green" : "red"}`}>{c.status === "ok" ? "ใช้งานได้" : "ใช้ไม่ได้"}</span>
          </div>
        ))}
        <a className="row" href="/api/facebook/login" style={{ color: "var(--blue)" }}>เชื่อมต่อ Facebook ใหม่หรือเพิ่มแอดมินสำรอง</a>
      </div>

      {me.role === "owner" && (confirmDelete
        ? <button className="btn danger block" onClick={remove}>ยืนยันลบ {page.name} และคิวทั้งหมดของเพจนี้</button>
        : <button className="btn plain" style={{ color: "var(--red)", alignSelf: "center" }} onClick={() => setConfirmDelete(true)}>ลบเพจออกจากระบบ</button>)}
    </Sheet>
  );
}
