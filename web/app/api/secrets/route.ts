import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { SECRET_KEYS } from "@/lib/secrets";
import { adminSupabase } from "@/lib/supabase/admin";
import { tg } from "@/lib/telegram";

const KEYS: readonly string[] = SECRET_KEYS;

/** Which keys are saved. Values never leave the server. */
export async function GET() {
  const auth = await requireRole("owner");
  if ("error" in auth) return auth.error;
  const { data } = await adminSupabase().from("secrets").select("key");
  const saved = new Set((data ?? []).map((r) => r.key));
  return NextResponse.json(Object.fromEntries(KEYS.map((k) => [k, saved.has(k)])));
}

export async function POST(req: Request) {
  const auth = await requireRole("owner");
  if ("error" in auth) return auth.error;
  const { key, value } = await req.json();
  if (!KEYS.includes(key)) return NextResponse.json({ error: "ไม่รู้จักคีย์นี้" }, { status: 400 });
  const db = adminSupabase();
  const clean = String(value ?? "").trim();
  if (!clean) {
    await db.from("secrets").delete().eq("key", key);
    return NextResponse.json({ message: "ลบแล้ว" });
  }

  let message = "บันทึกแล้ว";
  if (key === "telegram_bot_token") {
    try {
      const bot = await tg("getMe", {}, clean);
      message = `เชื่อมบอท @${bot.username} แล้ว`;
    } catch {
      return NextResponse.json({ error: "Token นี้ใช้ไม่ได้ ตรวจว่าคัดลอกมาครบจาก @BotFather" }, { status: 400 });
    }
  }
  if (key === "fb_app_id" && !/^\d{5,25}$/.test(clean)) {
    return NextResponse.json({ error: "App ID ต้องเป็นตัวเลขเท่านั้น" }, { status: 400 });
  }

  await db.from("secrets").upsert({ key, value_enc: encrypt(clean), updated_at: new Date().toISOString() });
  return NextResponse.json({ message });
}
