"use client";

import { useEffect, useState } from "react";
import { useMe } from "@/components/Shell";
import StylePreview from "@/components/StylePreview";
import { must, Seg, Switch, useLoad, useToast } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import type { Page, Style, StyleConfig } from "@/lib/types";

const DEFAULTS: StyleConfig = {
  hook_color: "#FF2A2A", keyword_color: "#FF9500", body_color: "#FFFFFF", cta_color: "#FFE066",
  background: "video", background_hint: "", voice: "female", voice_rate: "+0%", duration: 45,
  show_logo: false, logo_path: null, dim: 0.3,
};

const SWATCHES = ["#FF2A2A", "#FF9500", "#FFD60A", "#FFFFFF", "#30D158", "#5AC8FA"];

async function load() {
  const db = supabase();
  const [styles, pages] = await Promise.all([
    db.from("styles").select("*").order("created_at"),
    db.from("pages").select("id,name,style_id"),
  ]);
  return { styles: must(styles) as Style[], pages: must(pages) as Pick<Page, "id" | "name" | "style_id">[] };
}

function ColorRow({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="row">
      <div className="grow">{label}</div>
      <div className="swatches" role="group" aria-label={label}>
        {SWATCHES.slice(0, 4).map((c) => (
          <button key={c} type="button" aria-label={c} aria-pressed={value.toUpperCase() === c} disabled={disabled}
            style={{ background: c }} onClick={() => onChange(c)} />
        ))}
        <input type="color" aria-label={`${label} สีอื่น`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      </div>
    </div>
  );
}

export default function Styles() {
  const me = useMe();
  const toast = useToast();
  const canEdit = me.role === "owner" || me.role === "admin";
  const { data, reload } = useLoad(load);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState<StyleConfig>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const current = data?.styles.find((s) => s.id === currentId) ?? data?.styles[0];
  useEffect(() => {
    if (current) {
      setCurrentId(current.id);
      setName(current.name);
      setCfg({ ...DEFAULTS, ...current.config });
      setDirty(false);
    }
  }, [current?.id, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof StyleConfig>(k: K, v: StyleConfig[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setDirty(true);
  };
  const usedBy = data?.pages.filter((p) => p.style_id === current?.id).map((p) => p.name) ?? [];

  async function save() {
    if (!current) return;
    setBusy(true);
    const { error } = await supabase().from("styles").update({ name: name.trim() || current.name, config: cfg }).eq("id", current.id);
    setBusy(false);
    if (error) return toast(error.message);
    toast("บันทึกสไตล์แล้ว คลิปที่ผลิตหลังจากนี้ใช้สไตล์ใหม่");
    reload();
  }

  async function create() {
    const { data: row, error } = await supabase().from("styles")
      .insert({ name: "สไตล์ใหม่", config: current ? { ...current.config, logo_path: null, show_logo: false } : DEFAULTS })
      .select("id").single();
    if (error) return toast(error.message);
    setCurrentId(row.id);
    reload();
  }

  async function remove() {
    if (!current) return;
    if (usedBy.length) return toast(`ยังมีเพจใช้สไตล์นี้อยู่: ${usedBy.join(", ")}`);
    const { error } = await supabase().from("styles").delete().eq("id", current.id);
    if (error) return toast(error.message);
    setCurrentId(null);
    reload();
  }

  async function uploadLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) return toast("ไฟล์โลโก้ต้องไม่เกิน 2MB");
    const path = `logos/${crypto.randomUUID()}.png`;
    const { error } = await supabase().storage.from("clips").upload(path, file, { contentType: file.type || "image/png" });
    if (error) return toast(`อัปโหลดไม่สำเร็จ: ${error.message}`);
    set("logo_path", path);
    set("show_logo", true);
  }

  return (
    <div className="page-wrap">
      <div className="title-row">
        <div><div className="eyebrow">หน้าตาคลิปที่แต่ละเพจเลือกใช้</div><h1>สไตล์</h1></div>
        {canEdit && <button className="btn tint small" onClick={create}>+ สไตล์ใหม่</button>}
      </div>

      {data && data.styles.length > 1 && (
        <Seg label="เลือกสไตล์" value={current?.id ?? ""} onChange={(id) => setCurrentId(id)}
          options={data.styles.map((s) => ({ value: s.id, label: s.name }))} />
      )}

      {current && (
        <div className="style-layout">
          <StylePreview config={cfg} />
          <div className="controls">
            <div className="group">
              <div className="row">
                <label className="grow" htmlFor="sname">ชื่อสไตล์</label>
                <input id="sname" type="text" value={name} disabled={!canEdit} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
              </div>
            </div>

            <div className="section-label">ข้อความ</div>
            <div className="group">
              <ColorRow label="หัวเรื่อง" value={cfg.hook_color} onChange={(v) => set("hook_color", v)} disabled={!canEdit} />
              <ColorRow label="คำสำคัญ" value={cfg.keyword_color} onChange={(v) => set("keyword_color", v)} disabled={!canEdit} />
              <ColorRow label="เนื้อหา" value={cfg.body_color} onChange={(v) => set("body_color", v)} disabled={!canEdit} />
              <ColorRow label="ข้อความปิด" value={cfg.cta_color} onChange={(v) => set("cta_color", v)} disabled={!canEdit} />
            </div>

            <div className="section-label">พื้นหลัง</div>
            <div className="group">
              <div className="row"><div className="grow">ชนิด</div>
                <Seg label="ชนิดพื้นหลัง" value={cfg.background} onChange={(v) => set("background", v)}
                  options={[{ value: "video", label: "วิดีโอ" }, { value: "photo", label: "ภาพนิ่ง" }]} /></div>
              <div className="row">
                <label className="grow" htmlFor="hint">คำค้นเพิ่มเติม<div className="sub">ภาษาอังกฤษ เช่น sunset sky clouds</div></label>
                <input id="hint" type="text" value={cfg.background_hint} disabled={!canEdit} placeholder="ไม่บังคับ"
                  onChange={(e) => set("background_hint", e.target.value)} />
              </div>
              <div className="row">
                <label className="grow" htmlFor="dim">ความมืดของพื้นหลัง</label>
                <input id="dim" type="range" min={0} max={0.6} step={0.05} value={cfg.dim} disabled={!canEdit}
                  onChange={(e) => set("dim", Number(e.target.value))} style={{ width: 140 }} />
              </div>
            </div>

            <div className="section-label">เสียงพากย์และความยาว</div>
            <div className="group">
              <div className="row"><div className="grow">เสียง</div>
                <Seg label="เสียง" value={cfg.voice} onChange={(v) => set("voice", v)}
                  options={[{ value: "female", label: "ผู้หญิง" }, { value: "male", label: "ผู้ชาย" }]} /></div>
              <div className="row"><div className="grow">ความเร็ว</div>
                <Seg label="ความเร็วเสียง" value={cfg.voice_rate} onChange={(v) => set("voice_rate", v)}
                  options={[{ value: "-10%", label: "ช้า" }, { value: "+0%", label: "ปกติ" }, { value: "+10%", label: "เร็ว" }]} /></div>
              <div className="row"><div className="grow">ความยาว</div>
                <Seg label="ความยาวคลิป" value={cfg.duration} onChange={(v) => set("duration", v)}
                  options={[{ value: 30, label: "30 วิ" }, { value: 45, label: "45 วิ" }, { value: 60, label: "60 วิ" }]} /></div>
            </div>

            <div className="section-label">โลโก้</div>
            <div className="group">
              <div className="row"><div className="grow">แสดงโลโก้มุมขวาบน</div>
                <Switch label="แสดงโลโก้" checked={cfg.show_logo} disabled={!canEdit} onChange={(v) => set("show_logo", v)} /></div>
              {canEdit && (
                <label className="row" style={{ cursor: "pointer", color: "var(--blue)" }}>
                  {cfg.logo_path ? "เปลี่ยนไฟล์โลโก้" : "อัปโหลดโลโก้ (PNG พื้นใส)"}
                  <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                </label>
              )}
            </div>
            <p className="note">โลโก้จะติดในคลิปทุกเพจที่ใช้สไตล์นี้ ถ้าบางเพจไม่ควรมีโลโก้ ให้สร้างสไตล์แยก</p>

            <p className="small muted" style={{ margin: 0 }}>ใช้กับ: {usedBy.length ? usedBy.join(", ") : "ยังไม่มีเพจใช้"}</p>
            {canEdit && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn" disabled={busy || !dirty} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึกสไตล์"}</button>
                {me.role === "owner" && data && data.styles.length > 1 && <button className="btn danger" onClick={remove}>ลบสไตล์นี้</button>}
              </div>
            )}
          </div>
        </div>
      )}
      {!data && <div className="empty"><span className="spinner" /></div>}
    </div>
  );
}
