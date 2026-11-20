"use client";

import Link from "next/link";

import { useState } from "react";
import { useMe } from "@/components/Shell";
import SignOut from "@/components/SignOut";
import { api, Avatar, must, Seg, Sheet, Stepper, Switch, useLoad, useToast } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import type { Page, Profile, Role } from "@/lib/types";

type Settings = Record<string, any>;
interface Member extends Profile { pages: string[] }
interface Conn { id: string; page_id: string; user_id: string; fb_user_name: string | null; role: string; status: string; last_checked_at: string | null }

const ROLE_LABEL: Record<Role, string> = { owner: "เจ้าของ", admin: "แอดมิน", reviewer: "ผู้ตรวจ" };

async function load(isOwner: boolean) {
  const db = supabase();
  const [settings, pages, conns, profiles, members, invites] = await Promise.all([
    db.from("settings").select("key,value"),
    db.from("pages").select("id,name").order("name"),
    db.from("fb_connections").select("id,page_id,user_id,fb_user_name,role,status,last_checked_at"),
    db.from("profiles").select("id,email,display_name,role").not("role", "is", null).order("created_at"),
    isOwner ? db.from("page_members").select("user_id,page_id") : Promise.resolve({ data: [], error: null }),
    isOwner ? db.from("invitations").select("email,role") : Promise.resolve({ data: [], error: null }),
  ]);
  const s: Settings = Object.fromEntries(must(settings).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const pm = (members.data ?? []) as { user_id: string; page_id: string }[];
  return {
    s,
    pages: must(pages) as Pick<Page, "id" | "name">[],
    conns: (conns.data ?? []) as Conn[],
    team: (must(profiles) as Profile[]).map((p) => ({ ...p, pages: pm.filter((m) => m.user_id === p.id).map((m) => m.page_id) })),
    invites: (invites.data ?? []) as { email: string; role: Role }[],
  };
}

export default function SettingsPage() {
  const me = useMe();
  const toast = useToast();
  const owner = me.role === "owner";
  const { data, reload, setData } = useLoad(() => load(owner));
  const [sheet, setSheet] = useState<null | "password" | "telegram" | "fbapp" | "add" | { member: Member } | { secret: string }>(null);
  const fb = useLoad(() => api<{ configured: boolean; redirect_uri: string }>("/api/facebook/status", "GET"));
  const bot = useLoad(() => (owner ? api<{ bot: string | null }>("/api/telegram/setup", "GET") : Promise.resolve({ bot: null })));

  async function setSetting(key: string, value: unknown) {
    setData((d) => d && { ...d, s: { ...d.s, [key]: value } });
    const { error } = await supabase().from("settings").update({ value }).eq("key", key);
    if (error) {
      toast(error.message);
      reload();
    }
  }

  if (!data) return <div className="page-wrap narrow"><div className="empty"><span className="spinner" /></div></div>;
  const { s, pages, conns, team } = data;
  const providers = s.providers ?? {};
  const pageName = (id: string) => pages.find((p) => p.id === id)?.name ?? "เพจที่ไม่มีสิทธิ์ดู";
  const connsByUser = new Map<string, Conn[]>();
  conns.forEach((c) => connsByUser.set(c.user_id, [...(connsByUser.get(c.user_id) ?? []), c]));

  return (
    <div className="page-wrap narrow">
      <div className="title-row"><div><div className="eyebrow">{me.email} · {ROLE_LABEL[me.role!]}</div><h1>ตั้งค่า</h1></div></div>

      <div className="group">
        <Link href="/status" className="row chev"><div className="grow">สถานะระบบ<div className="sub">เครื่องผลิตคลิป แบนด์วิดท์ งานที่ล้มเหลว</div></div></Link>
        <Link href="/styles" className="row chev"><div className="grow">สไตล์คลิป<div className="sub">สี เสียง พื้นหลัง โลโก้</div></div></Link>
        {owner && <Link href="/backup" className="row chev"><div className="grow">สำรองและย้ายระบบ<div className="sub">ไฟล์สำรอง และเช็กลิสต์ก่อนเลิกใช้คอมนี้</div></div></Link>}
      </div>

      {/* ── Posting ── */}
      <div className="section-label">การโพสต์</div>
      <div className="group">
        <div className="row"><div className="grow">โพสต์อัตโนมัติตามเวลา<div className="sub">ปิด = หยุดผลิตและโพสต์ทั้งหมด</div></div>
          <Switch label="โพสต์อัตโนมัติ" checked={Boolean(s.automation_enabled)} disabled={!owner} onChange={(v) => setSetting("automation_enabled", v)} /></div>
        <div className="row"><div className="grow">แจ้งเตือนก่อนโพสต์</div>
          <Seg label="แจ้งเตือนก่อนโพสต์" value={Number(s.notify_minutes_before ?? 30)} onChange={(v) => owner && setSetting("notify_minutes_before", v)}
            options={[{ value: 15, label: "15 นาที" }, { value: 30, label: "30 นาที" }, { value: 60, label: "1 ชม." }]} /></div>
        <div className="row"><label className="grow" htmlFor="sum">สรุปผลประจำวัน</label>
          <select id="sum" value={Number(s.summary_hour ?? 22)} disabled={!owner} onChange={(e) => setSetting("summary_hour", Number(e.target.value))}>
            {[18, 19, 20, 21, 22, 23].map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select></div>
        <div className="row"><div className="grow">โพสต์สูงสุดต่อเพจต่อวัน</div>
          <Stepper label="โพสต์สูงสุดต่อเพจ" value={Number(s.max_posts_per_page ?? 8)} min={1} max={8} onChange={(v) => owner && setSetting("max_posts_per_page", v)} /></div>
      </div>
      <p className="note">ต้องการให้บางเพจรออนุมัติก่อนโพสต์ ตั้งได้ที่หน้าเพจ</p>

      {/* ── Telegram ── */}
      <div className="section-label">Telegram</div>
      <div className="group">
        {owner && (
          <div className="row">
            <div className="grow">บอท<div className="sub">{bot.data?.bot ? `@${bot.data.bot}` : "ยังไม่ได้ใส่ token ของบอท"}</div></div>
            <span className={`tag ${bot.data?.bot ? "green" : "orange"}`}>{bot.data?.bot ? "พร้อม" : "ยังไม่ตั้งค่า"}</span>
          </div>
        )}
        <div className="row">
          <div className="grow">แชทที่รับแจ้งเตือน<div className="sub">{s.telegram_chat_id ? "เชื่อมต่อแล้ว" : "ยังไม่ได้เชื่อมต่อ"}</div></div>
          <span className={`tag ${s.telegram_chat_id ? "green" : "orange"}`}>{s.telegram_chat_id ? "ใช้งานได้" : "ยังไม่เชื่อม"}</span>
        </div>
        {owner && <button className="row chev" style={{ color: "var(--blue)" }} onClick={() => setSheet("telegram")}>
          <span className="grow">{bot.data?.bot && s.telegram_chat_id ? "ตั้งค่า Telegram ใหม่" : "ตั้งค่า Telegram"}</span></button>}
      </div>

      {/* ── Facebook ── */}
      <div className="section-label">Facebook</div>
      {owner && (
        <div className="group">
          <button className="row chev" onClick={() => setSheet("fbapp")}>
            <div className="grow">Facebook App<div className="sub">{fb.data?.configured ? "ตั้งค่าแล้ว" : "ต้องตั้งค่าก่อนเชื่อมต่อเพจ"}</div></div>
            <span className={`tag ${fb.data?.configured ? "green" : "orange"}`}>{fb.data?.configured ? "พร้อม" : "ยังไม่ตั้งค่า"}</span>
          </button>
        </div>
      )}
      <div className="section-label">บัญชี Facebook ที่เชื่อมต่อ</div>
      <div className="group">
        {connsByUser.size === 0 && <div className="row muted">ยังไม่ได้เชื่อมต่อ</div>}
        {Array.from(connsByUser.entries()).map(([uid, list]) => {
          const bad = list.filter((c) => c.status !== "ok").length;
          const primary = list.some((c) => c.role === "primary");
          return (
            <div key={uid} className="row">
              <Avatar name={list[0].fb_user_name ?? "?"} color={primary ? "var(--blue)" : "#af52de"} />
              <div className="grow">
                <div>{list[0].fb_user_name} · {primary ? "กุญแจหลัก" : "สำรอง"}</div>
                <div className="sub">{list.map((c) => pageName(c.page_id)).join(", ")}</div>
              </div>
              <span className={`tag ${bad ? "red" : "green"}`}>{bad ? `ใช้ไม่ได้ ${bad} เพจ` : "ใช้งานได้"}</span>
            </div>
          );
        })}
        {me.role !== "reviewer" && fb.data?.configured && <a className="row chev" href="/api/facebook/login" style={{ color: "var(--blue)" }}>
          <span className="grow">เชื่อมต่อ Facebook {connsByUser.size ? "ใหม่ / เพิ่มแอดมินสำรอง" : ""}</span></a>}
        {me.role !== "reviewer" && fb.data && !fb.data.configured && <div className="row small muted">
          {owner ? "ตั้งค่า Facebook App ด้านบนก่อน แล้วปุ่มเชื่อมต่อจะขึ้นที่นี่" : "รอเจ้าของตั้งค่า Facebook App ก่อน"}</div>}
      </div>
      <p className="note">ระบบตรวจกุญแจทุกเช้า 06:00 ถ้ากุญแจหลักใช้ไม่ได้จะสลับไปใช้แอดมินสำรองเอง แอดมินสำรองต้องเป็นคนจริงที่เป็นแอดมินของเพจใน Facebook</p>

      {/* ── Team ── */}
      <div className="section-label">ทีมงาน</div>
      <div className="group">
        {team.map((m) => (
          <button key={m.id} className={`row ${owner && m.id !== me.id ? "chev" : ""}`} disabled={!owner || m.id === me.id}
            onClick={() => setSheet({ member: m })}>
            <Avatar name={m.display_name || m.email} color={m.role === "owner" ? "var(--blue)" : m.role === "admin" ? "#af52de" : "#ff2d55"} />
            <div className="grow">
              <div>{m.display_name || m.email}{m.id === me.id ? " (คุณ)" : ""}</div>
              <div className="sub">{m.role === "owner" ? "ทุกเพจ" : m.pages.map(pageName).join(", ") || "ยังไม่ได้รับมอบหมายเพจ"}</div>
            </div>
            <span className="tag">{ROLE_LABEL[m.role!]}</span>
          </button>
        ))}
        {data.invites.map((i) => (
          <div key={i.email} className="row">
            <Avatar name={i.email} color="#8e8e93" />
            <div className="grow"><div>{i.email}</div><div className="sub">ยังไม่เคยเข้าสู่ระบบ</div></div>
            <span className="tag orange">{ROLE_LABEL[i.role]}</span>
          </div>
        ))}
        {owner && <button className="row chev" style={{ color: "var(--blue)" }} onClick={() => setSheet("add")}><span className="grow">เพิ่มคนในทีม</span></button>}
      </div>
      <p className="note">แอดมิน: แก้แผนเพจ สไตล์ สร้างคลิปเอง และอนุมัติ · ผู้ตรวจ: โพสต์เลย เลื่อน ยกเลิก และแก้คำบรรยาย เฉพาะเพจที่ได้รับมอบหมาย</p>

      {/* ── Services ── */}
      {owner && <>
        <div className="section-label">บริการที่ใช้</div>
        <div className="group">
          <div className="row"><label className="grow" htmlFor="llm">เขียนบท</label>
            <select id="llm" value={providers.llm ?? "gemini"}
              onChange={(e) => setSetting("providers", { ...providers, llm: e.target.value, llm_model: "" })}>
              <option value="gemini">Gemini (ฟรี)</option><option value="groq">Groq (ฟรี)</option><option value="openai">OpenAI (เสียเงิน)</option>
            </select></div>
          <div className="row"><label className="grow" htmlFor="model">รุ่นโมเดล<div className="sub">เว้นว่าง = ใช้รุ่นแนะนำ</div></label>
            <input id="model" type="text" placeholder="อัตโนมัติ" defaultValue={providers.llm_model ?? ""}
              onBlur={(e) => e.target.value !== (providers.llm_model ?? "") && setSetting("providers", { ...providers, llm_model: e.target.value.trim() })} /></div>
          <div className="row"><label className="grow" htmlFor="tts">เสียงพากย์</label>
            <select id="tts" value={providers.tts ?? "gemini"} onChange={(e) => setSetting("providers", { ...providers, tts: e.target.value })}>
              <option value="gemini">Gemini เสียง (ฟรี ใช้คีย์เดียวกับเขียนบท)</option>
              <option value="edge">Edge TTS (ฟรี ไม่เสถียร)</option><option value="azure">Azure Speech (ฟรี 500K ตัวอักษร/เดือน)</option><option value="openai">OpenAI TTS (เสียเงิน)</option>
            </select></div>
        </div>
        <SecretList onEdit={(key) => setSheet({ secret: key })} />
        <div className="section-label">แหล่งข่าว RSS</div>
        <textarea className="field" aria-label="แหล่งข่าว RSS" defaultValue={(s.news_feeds ?? []).join("\n")}
          onBlur={(e) => setSetting("news_feeds", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} />
        <p className="note">บรรทัดละ 1 ลิงก์ ใช้คู่กับ Google Trends ประเทศไทยในการเลือกข่าวกระแส</p>
      </>}

      {/* ── Account ── */}
      <div className="section-label">บัญชี</div>
      <div className="group">
        <button className="row chev" onClick={() => setSheet("password")}><span className="grow">เปลี่ยนรหัสผ่าน</span></button>
      </div>
      <SignOut />

      {sheet === "password" && <PasswordSheet onClose={() => setSheet(null)} />}
      {sheet === "telegram" && <TelegramSheet bot={bot.data?.bot ?? null} linked={Boolean(s.telegram_chat_id)}
        onClose={() => { setSheet(null); reload(); bot.reload(); }} />}
      {sheet === "fbapp" && fb.data && <FacebookAppSheet redirectUri={fb.data.redirect_uri} configured={fb.data.configured}
        onClose={() => { setSheet(null); fb.reload(); }} />}
      {sheet === "add" && <MemberSheet pages={pages} onClose={() => setSheet(null)} onSaved={reload} />}
      {sheet && typeof sheet === "object" && "member" in sheet && <MemberSheet member={sheet.member} pages={pages} onClose={() => setSheet(null)} onSaved={reload} />}
      {sheet && typeof sheet === "object" && "secret" in sheet && <SecretSheet name={sheet.secret} onClose={() => setSheet(null)} />}
    </div>
  );
}

const SECRETS: { key: string; label: string; hint: string; link?: string }[] = [
  { key: "gemini_api_key", label: "Gemini API key", hint: "เขียนบท", link: "https://aistudio.google.com/app/apikey" },
  { key: "pixabay_api_key", label: "Pixabay API key", hint: "วิดีโอและภาพพื้นหลัง", link: "https://pixabay.com/api/docs/" },
  { key: "pexels_api_key", label: "Pexels API key", hint: "พื้นหลังสำรอง (Pexels ปิดรับคีย์ใหม่ชั่วคราว)", link: "https://www.pexels.com/api/" },
  { key: "azure_speech_key", label: "Azure Speech key", hint: "เสียงสำรอง", link: "https://portal.azure.com" },
  { key: "azure_speech_region", label: "Azure Speech region", hint: "เช่น southeastasia" },
  { key: "groq_api_key", label: "Groq API key", hint: "เขียนบทสำรอง", link: "https://console.groq.com/keys" },
  { key: "openai_api_key", label: "OpenAI API key", hint: "ใช้เมื่อเลือก OpenAI" },
];

function SecretList({ onEdit }: { onEdit: (key: string) => void }) {
  const { data } = useLoad(() => api<Record<string, boolean>>("/api/secrets", "GET"));
  return (
    <>
      <div className="section-label">คีย์ของบริการ</div>
      <div className="group">
        {SECRETS.map((k) => (
          <button key={k.key} className="row chev" onClick={() => onEdit(k.key)}>
            <div className="grow">{k.label}<div className="sub">{k.hint}</div></div>
            <span className={`tag ${data?.[k.key] ? "green" : ""}`}>{data?.[k.key] ? "บันทึกแล้ว" : "ยังไม่ได้ใส่"}</span>
          </button>
        ))}
      </div>
      <p className="note">คีย์ถูกเข้ารหัสก่อนเก็บ และไม่แสดงกลับมาบนหน้าเว็บ</p>
    </>
  );
}

function SecretSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const toast = useToast();
  const meta = SECRETS.find((s) => s.key === name)!;
  const [value, setValue] = useState("");
  async function save(v: string) {
    try {
      toast((await api("/api/secrets", "POST", { key: name, value: v })).message ?? "บันทึกแล้ว");
      window.location.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <Sheet title={meta.label} onClose={onClose} right={<button className="btn plain" style={{ fontWeight: 600 }} disabled={!value} onClick={() => save(value)}>บันทึก</button>}>
      <input className="field" type={name.endsWith("region") ? "text" : "password"} autoComplete="off" value={value}
        placeholder={name.endsWith("region") ? "southeastasia" : "วางคีย์ที่นี่"} onChange={(e) => setValue(e.target.value)} aria-label={meta.label} />
      {meta.link && <p className="small muted" style={{ margin: 0 }}>ขอคีย์ได้ที่ <a href={meta.link} target="_blank" rel="noreferrer">{meta.link.replace("https://", "")}</a></p>}
      <button className="btn danger" style={{ alignSelf: "flex-start" }} onClick={() => save("")}>ลบคีย์นี้</button>
    </Sheet>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState("");
  async function save() {
    if (pw.length < 8) return toast("รหัสผ่านต้องยาวอย่างน้อย 8 ตัว");
    const { error } = await supabase().auth.updateUser({ password: pw });
    if (error) return toast(error.message);
    toast("เปลี่ยนรหัสผ่านแล้ว");
    onClose();
  }
  return (
    <Sheet title="เปลี่ยนรหัสผ่าน" onClose={onClose} right={<button className="btn plain" style={{ fontWeight: 600 }} onClick={save}>บันทึก</button>}>
      <input className="field" type="password" autoComplete="new-password" placeholder="รหัสผ่านใหม่ อย่างน้อย 8 ตัว" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="รหัสผ่านใหม่" />
    </Sheet>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <div className="group">
      {items.map((it, i) => (
        <div key={i} className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <span className="mono muted" style={{ width: 18 }}>{i + 1}.</span>
          <div className="grow" style={{ minWidth: 0 }}>{it}</div>
        </div>
      ))}
    </div>
  );
}

function CopyText({ text }: { text: string }) {
  const toast = useToast();
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", maxWidth: "100%" }}>
      <code className="mono" style={{ userSelect: "all", background: "var(--fill)", padding: "2px 8px", borderRadius: 6, wordBreak: "break-all" }}>{text}</code>
      <button type="button" className="btn small tint"
        onClick={() => navigator.clipboard.writeText(text).then(() => toast("คัดลอกแล้ว"), () => toast("คัดลอกไม่ได้ เลือกข้อความแล้วกด Ctrl+C แทน"))}>คัดลอก</button>
    </span>
  );
}

function TelegramSheet({ bot, linked, onClose }: { bot: string | null; linked: boolean; onClose: () => void }) {
  const toast = useToast();
  const [botName, setBotName] = useState(bot);
  const [changing, setChanging] = useState(!bot);
  const [token, setToken] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveToken() {
    setBusy(true);
    try {
      toast((await api("/api/secrets", "POST", { key: "telegram_bot_token", value: token })).message ?? "บันทึกแล้ว");
      const res = await api<{ bot: string | null }>("/api/telegram/setup", "GET");
      setBotName(res.bot);
      setChanging(false);
      setToken("");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function makeCode() {
    setBusy(true);
    try {
      setCode((await api<{ bot: string; code: string }>("/api/telegram/setup", "POST")).code);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="ตั้งค่า Telegram" onClose={onClose} right={<button className="btn plain" style={{ fontWeight: 600 }} onClick={onClose}>เสร็จ</button>}>
      <div className="section-label">ขั้นที่ 1 · บอทของคุณ</div>
      {changing ? <>
        <Steps items={[
          <>เปิด Telegram ค้นหา <b>@BotFather</b> (มีเครื่องหมายถูกสีฟ้า) แล้วกด Start</>,
          <>พิมพ์ <code className="mono">/newbot</code> ตั้งชื่อบอท แล้วตั้ง username ที่ลงท้ายด้วย <code className="mono">bot</code></>,
          <>คัดลอกรหัสหลังข้อความ <i>Use this token to access the HTTP API</i> มาวางด้านล่าง</>,
        ]} />
        <input className="field" type="password" autoComplete="off" placeholder="วาง token เช่น 1234567890:AAH..." aria-label="Telegram bot token"
          value={token} onChange={(e) => setToken(e.target.value)} />
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" disabled={busy || token.trim().length < 20} onClick={saveToken}>{busy ? "กำลังตรวจ…" : "บันทึก token"}</button>
          {botName && <button className="btn gray" onClick={() => setChanging(false)}>ใช้บอทเดิม</button>}
        </div>
        <p className="note">Token เป็นความลับ ถูกเข้ารหัสก่อนเก็บ และไม่แสดงกลับมาบนหน้าเว็บ</p>
      </> : (
        <div className="group">
          <div className="row"><div className="grow">@{botName}</div><span className="tag green">พร้อม</span></div>
          <button className="row" style={{ color: "var(--blue)" }} onClick={() => { setChanging(true); setCode(null); }}>เปลี่ยนบอท</button>
        </div>
      )}

      {!changing && botName && <>
        <div className="section-label">ขั้นที่ 2 · แชทที่รับแจ้งเตือน {linked && !code ? "(เชื่อมแล้ว)" : ""}</div>
        {!code ? (
          <button className="btn block" disabled={busy} onClick={makeCode}>{busy ? "กำลังตั้งค่า…" : linked ? "เชื่อมแชทใหม่" : "สร้างรหัสเชื่อมแชท"}</button>
        ) : (
          <Steps items={[
            <>เปิดบอท <a href={`https://t.me/${botName}?start=${code}`} target="_blank" rel="noreferrer">@{botName}</a> ใน Telegram</>,
            <>ส่งข้อความนี้ <CopyText text={`/start ${code}`} /></>,
            <>บอทจะตอบว่า <i>เชื่อมต่อ Reels Autopilot แล้ว</i> จากนั้นกดเสร็จ</>,
          ]} />
        )}
      </>}
    </Sheet>
  );
}

function FacebookAppSheet({ redirectUri, configured, onClose }: { redirectUri: string; configured: boolean; onClose: () => void }) {
  const toast = useToast();
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api("/api/secrets", "POST", { key: "fb_app_id", value: appId });
      await api("/api/secrets", "POST", { key: "fb_app_secret", value: secret });
      toast("บันทึก Facebook App แล้ว ไปที่หน้าเพจเพื่อเชื่อมต่อได้เลย");
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Facebook App" onClose={onClose}
      right={<button className="btn plain" style={{ fontWeight: 600 }} disabled={busy || !appId.trim() || !secret.trim()} onClick={save}>บันทึก</button>}>
      <p style={{ margin: 0 }}>
        {configured ? "ตั้งค่าไว้แล้ว ใส่ใหม่เฉพาะเมื่อต้องการเปลี่ยนแอป" : "แอปนี้เป็นทางที่ระบบใช้ขออนุญาตโพสต์ลงเพจของคุณ ทดสอบแล้วว่าแอปแบบ Development mode โพสต์ลงเพจที่คุณเป็นแอดมินได้ และคนทั่วไปเห็นโพสต์ ไม่ต้องส่งให้ Facebook ตรวจ"}
      </p>
      <Steps items={[
        <>เข้า <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">developers.facebook.com/apps</a> กด <b>Create App</b> เลือกแบบที่ให้จัดการเพจได้</>,
        <>เพิ่ม <b>Facebook Login</b> แล้วไปที่ Settings ใส่ลิงก์นี้ในช่อง <i>Valid OAuth Redirect URIs</i><div style={{ marginTop: 6 }}><CopyText text={redirectUri} /></div></>,
        <>ไปที่ <b>App settings → Basic</b> คัดลอก App ID และ App Secret มาใส่ด้านล่าง</>,
      ]} />
      <div className="group">
        <div className="row"><label className="grow" htmlFor="fb-id">App ID</label>
          <input id="fb-id" type="text" inputMode="numeric" autoComplete="off" value={appId} onChange={(e) => setAppId(e.target.value)} style={{ flex: 2 }} /></div>
        <div className="row"><label className="grow" htmlFor="fb-secret">App Secret</label>
          <input id="fb-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} style={{ flex: 2 }} /></div>
      </div>
      <p className="note">App Secret ถูกเข้ารหัสก่อนเก็บ ถ้าจะให้คนอื่นเป็นแอดมินสำรอง ต้องเพิ่มเขาใน App roles ของแอปด้วย</p>
    </Sheet>
  );
}

function MemberSheet({ member, pages, onClose, onSaved }: { member?: Member; pages: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(member?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "reviewer">(member?.role === "reviewer" ? "reviewer" : "admin");
  const [picked, setPicked] = useState<string[]>(member?.pages ?? []);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = member
        ? await api("/api/team", "PATCH", { user_id: member.id, role, page_ids: picked })
        : await api("/api/team", "POST", { email, password, role, page_ids: picked });
      toast(res.message ?? "บันทึกแล้ว");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      toast((await api(`/api/team?user_id=${member!.id}`, "DELETE")).message ?? "นำออกแล้ว");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <Sheet title={member ? member.email : "เพิ่มคนในทีม"} onClose={onClose}
      left={<button className="btn plain" onClick={onClose}>ยกเลิก</button>}
      right={<button className="btn plain" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>{member ? "บันทึก" : "เพิ่ม"}</button>}>
      {!member && <>
        <div className="group">
          <div className="row"><label className="grow" htmlFor="m-email">อีเมล</label>
            <input id="m-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 2 }} /></div>
          <div className="row"><label className="grow" htmlFor="m-pw">รหัสผ่านเริ่มต้น</label>
            <input id="m-pw" type="text" autoComplete="off" placeholder="อย่างน้อย 8 ตัว" value={password} onChange={(e) => setPassword(e.target.value)} style={{ flex: 2 }} /></div>
        </div>
        <p className="note">ส่งอีเมลและรหัสผ่านนี้ให้เขาเอง เขาเปลี่ยนรหัสผ่านได้หลังเข้าสู่ระบบ</p>
      </>}
      <div className="section-label">บทบาท</div>
      <Seg label="บทบาท" value={role} onChange={setRole} options={[{ value: "admin", label: "แอดมิน" }, { value: "reviewer", label: "ผู้ตรวจ" }]} />
      <div className="section-label">ดูแลเพจ</div>
      <div className="group">
        {pages.map((p) => (
          <label key={p.id} className="row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={picked.includes(p.id)} style={{ width: 22, height: 22, accentColor: "var(--blue)" }}
              onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((id) => id !== p.id)))} />
            <span className="grow">{p.name}</span>
          </label>
        ))}
        {pages.length === 0 && <div className="row muted">ยังไม่มีเพจ</div>}
      </div>
      {member && (confirmRemove
        ? <button className="btn danger block" onClick={remove}>ยืนยันนำ {member.email} ออกจากทีม</button>
        : <button className="btn plain" style={{ color: "var(--red)", alignSelf: "center" }} onClick={() => setConfirmRemove(true)}>นำออกจากทีม</button>)}
    </Sheet>
  );
}
