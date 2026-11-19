import { getSecret } from "./secrets";

export async function botToken(): Promise<string> {
  return getSecret("telegram_bot_token", "TELEGRAM_BOT_TOKEN");
}

export async function tg(method: string, payload: Record<string, unknown>, token?: string): Promise<any> {
  const t = token ?? (await botToken());
  if (!t) throw new Error("ยังไม่ได้ใส่ token ของบอท Telegram");
  const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram: ${data.description}`);
  return data.result;
}
