"use client";

import { useState } from "react";
import { useMe } from "@/components/Shell";
import { useLoad, useToast } from "@/components/ui";
import { CATEGORIES, catShort } from "@/lib/categories";
import { saveSetting } from "@/lib/settings";
import { supabase } from "@/lib/supabase/client";

interface Topic { id: string; topic: string; category: string; added_at: string }

async function load() {
  const { data } = await supabase().from("settings").select("key,value").in("key", ["topic_bank", "banned_terms"]);
  const s = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  return { bank: (s.topic_bank as Topic[] | undefined) ?? [], banned: (s.banned_terms as string[] | undefined) ?? [] };
}

export default function Topics() {
  const me = useMe();
  const toast = useToast();
  const owner = me.role === "owner";
  const { data, setData, reload } = useLoad(load);
  const [topic, setTopic] = useState("");
  const [cat, setCat] = useState(CATEGORIES[0].slug);
  const [word, setWord] = useState("");

  async function saveBank(bank: Topic[]) {
    setData((d) => d && { ...d, bank });
    const err = await saveSetting("topic_bank", bank);
    if (err) { toast(err); reload(); }
  }
  async function saveBanned(banned: string[]) {
    setData((d) => d && { ...d, banned });
    const err = await saveSetting("banned_terms", banned);
    if (err) { toast(err); reload(); }
  }

  function addTopic() {
    const lines = topic.split("\n").map((t) => t.trim()).filter(Boolean);
    if (!lines.length || !data) return;
    const now = new Date().toISOString();
    saveBank([...data.bank, ...lines.map((t, i) => ({ id: `${Date.now()}-${i}`, topic: t, category: cat, added_at: now }))]);
    setTopic("");
    toast(`เพิ่ม ${lines.length} หัวข้อแล้ว`);
  }
  function addWord() {
    const w = word.trim();
    if (!w || !data || data.banned.includes(w)) return setWord("");
    saveBanned([...data.banned, w]);
    setWord("");
  }

  if (!data) return <div className="page-wrap narrow"><div className="empty"><span className="spinner" /></div></div>;
  const byCat = CATEGORIES.map((c) => ({ ...c, items: data.bank.filter((t) => t.category === c.slug) })).filter((c) => c.items.length);

  return (
    <div className="page-wrap narrow">
      <div className="title-row"><div><div className="eyebrow">รอใช้ {data.bank.length} หัวข้อ</div><h1>คลังหัวข้อ</h1></div></div>
      <p className="muted small" style={{ margin: "-10px 4px 0" }}>
        จดหัวข้อที่อยากทำไว้ ระบบจะหยิบหัวข้อเก่าสุดของหมวดนั้นไปทำก่อน แทนการคิดหัวข้อเอง ใช้แล้วจะหายจากรายการ
      </p>

      {owner && (
        <div className="card">
          <b>เพิ่มหัวข้อ</b>
          <textarea className="field" style={{ background: "var(--fill)", minHeight: 90 }} value={topic}
            placeholder={"พิมพ์หัวข้อ 1 บรรทัดต่อ 1 คลิป เช่น\n5 นิสัยที่ทำให้เงินไม่เหลือ\nสิทธิ์ที่คนอายุ 60 ควรรู้"}
            onChange={(e) => setTopic(e.target.value)} />
          <div className="chips" style={{ padding: 0 }}>
            {CATEGORIES.map((c) => <button key={c.slug} type="button" aria-pressed={cat === c.slug} onClick={() => setCat(c.slug)}>{c.short}</button>)}
          </div>
          <button className="btn block" disabled={!topic.trim()} onClick={addTopic}>เพิ่มเข้าคลัง</button>
          {cat === "news" && <p className="muted small" style={{ margin: 0 }}>หัวข้อข่าว ระบบจะค้นข่าวจริงก่อนเขียน ถ้าไม่พบข่าวจะไม่ทำ</p>}
        </div>
      )}

      {byCat.length === 0 && <div className="empty"><b>คลังยังว่าง</b><span>ระบบคิดหัวข้อเองจากหมวดของแต่ละเพจ</span></div>}
      {byCat.map((c) => (
        <div key={c.slug} style={{ display: "contents" }}>
          <div className="section-label">{catShort(c.slug)} · {c.items.length}</div>
          <div className="group">
            {c.items.map((t, i) => (
              <div key={t.id} className="row">
                <span className="rank-n">{i + 1}</span>
                <div className="grow">{t.topic}</div>
                {owner && <button className="btn plain" aria-label={`ลบ ${t.topic}`} onClick={() => saveBank(data.bank.filter((x) => x.id !== t.id))}>ลบ</button>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="section-label">คำต้องห้าม</div>
      <div className="card">
        <p className="muted small" style={{ margin: 0 }}>
          ระบบจะไม่ทำคลิปที่มีคำเหล่านี้ ทั้งในหัวข้อ บทพากย์ และคำบรรยาย ข่าวที่มีคำเหล่านี้ถูกข้ามไปด้วย ข่าวสถาบันกษัตริย์ถูกกันไว้อยู่แล้ว
        </p>
        <div className="tags" style={{ gap: 6 }}>
          {data.banned.length === 0 && <span className="muted small">ยังไม่มี</span>}
          {data.banned.map((w) => (
            <span key={w} className="tag" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14, padding: "4px 10px" }}>
              {w}{owner && <button type="button" aria-label={`เอา ${w} ออก`} onClick={() => saveBanned(data.banned.filter((x) => x !== w))}
                style={{ border: 0, background: "none", cursor: "pointer", color: "var(--muted)", padding: 0 }}>✕</button>}
            </span>
          ))}
        </div>
        {owner && (
          <div style={{ display: "flex", gap: 8 }}>
            <input className="field" style={{ background: "var(--fill)" }} value={word} placeholder="เช่น หวย, การพนัน, ชื่อคนที่ไม่อยากพูดถึง"
              onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWord()} />
            <button className="btn" onClick={addWord} disabled={!word.trim()}>เพิ่ม</button>
          </div>
        )}
      </div>
    </div>
  );
}
