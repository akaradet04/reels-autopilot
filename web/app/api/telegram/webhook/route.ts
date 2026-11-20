import { NextResponse } from "next/server";
import { applyClipAction, type ClipAction } from "@/lib/clipActions";
import { getSecret } from "@/lib/secrets";
import { adminSupabase } from "@/lib/supabase/admin";
import { tg } from "@/lib/telegram";

const CODES: Record<string, ClipAction> = { p: "post", a: "approve", d: "delay", c: "cancel", x: "delete" };

async function setting(key: string) {
  const { data } = await adminSupabase().from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

export async function POST(req: Request) {
  const expected = await getSecret("telegram_webhook_secret", "TELEGRAM_WEBHOOK_SECRET");
  if (!expected || req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json();
  const chatId = await setting("telegram_chat_id");

  // Linking: "/start CODE" from the owner's chat.
  const msg = update.message;
  if (msg?.text?.startsWith("/start")) {
    const code = String(msg.text.split(" ")[1] || "").trim().toUpperCase();
    const expected = String((await setting("telegram_link_code")) || "").toUpperCase();
    if (code && code === expected) {
      await adminSupabase().from("settings").upsert({ key: "telegram_chat_id", value: msg.chat.id });
      await tg("sendMessage", { chat_id: msg.chat.id, text: "เชื่อมต่อ Reels Autopilot แล้ว ต่อไปคลิปใหม่จะส่งมาที่นี่ก่อนโพสต์" });
    } else if (chatId && String(msg.chat.id) === String(chatId)) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "แชทนี้เชื่อมต่อกับ Reels Autopilot อยู่แล้ว ไม่ต้องทำอะไรเพิ่ม" });
    } else {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "รหัสไม่ถูกต้อง เปิดหน้าตั้งค่าบนเว็บเพื่อดูรหัสล่าสุด" });
    }
    return NextResponse.json({ ok: true });
  }

  const cb = update.callback_query;
  if (cb) {
    const fromChat = cb.message?.chat?.id;
    if (!chatId || String(fromChat) !== String(chatId)) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "แชทนี้ไม่ได้เชื่อมกับระบบ" });
      return NextResponse.json({ ok: true });
    }
    const [code, clipId] = String(cb.data || "").split(":");
    const action = CODES[code];
    let text = "ไม่รู้จักคำสั่งนี้";
    if (action && clipId) {
      try {
        text = await applyClipAction(clipId, action, null);
      } catch (e) {
        text = (e as Error).message;
      }
      // Buttons that no longer make sense disappear; the worker rewrites the message when posting finishes.
      if (action === "cancel" || action === "delete") {
        await tg("editMessageReplyMarkup", {
          chat_id: fromChat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] },
        }).catch(() => undefined);
      }
    }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: false });
  }
  return NextResponse.json({ ok: true });
}
