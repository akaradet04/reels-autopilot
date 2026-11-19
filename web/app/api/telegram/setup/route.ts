import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { getSecret } from "@/lib/secrets";
import { adminSupabase } from "@/lib/supabase/admin";
import { botToken, tg } from "@/lib/telegram";

/** GET: is a bot saved, and its name. */
export async function GET() {
  const auth = await requireRole("owner");
  if ("error" in auth) return auth.error;
  if (!(await botToken())) return NextResponse.json({ bot: null });
  try {
    const bot = await tg("getMe", {});
    return NextResponse.json({ bot: bot.username });
  } catch (e) {
    return NextResponse.json({ bot: null, error: (e as Error).message });
  }
}

/** POST: point the bot at this website and issue a fresh link code for the owner's chat. */
export async function POST(req: Request) {
  const auth = await requireRole("owner");
  if ("error" in auth) return auth.error;
  try {
    const db = adminSupabase();
    let secret = await getSecret("telegram_webhook_secret", "TELEGRAM_WEBHOOK_SECRET");
    if (!secret) {
      secret = randomBytes(24).toString("hex");
      await db.from("secrets").upsert({ key: "telegram_webhook_secret", value_enc: encrypt(secret) });
    }
    const origin = new URL(req.url).origin;
    await tg("setWebhook", {
      url: `${origin}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
    });
    const code = randomBytes(3).toString("hex").toUpperCase();
    await db.from("settings").upsert({ key: "telegram_link_code", value: code });
    const bot = await tg("getMe", {});
    return NextResponse.json({ bot: bot.username, code });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
