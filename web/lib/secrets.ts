import { decrypt } from "./crypto";
import { adminSupabase } from "./supabase/admin";

/** Keys the owner can set from the Settings page. Stored encrypted in the secrets table. */
export const SECRET_KEYS = [
  "gemini_api_key", "groq_api_key", "openai_api_key", "pexels_api_key", "pixabay_api_key", "azure_speech_key", "azure_speech_region",
  "telegram_bot_token", "fb_app_id", "fb_app_secret",
] as const;

/** Saved value from the web Settings page, falling back to an environment variable. */
export async function getSecret(key: string, envName?: string): Promise<string> {
  const { data } = await adminSupabase().from("secrets").select("value_enc").eq("key", key).maybeSingle();
  if (data?.value_enc) {
    try {
      return decrypt(data.value_enc);
    } catch {
      // Saved with a different ENCRYPTION_KEY: treat as missing.
    }
  }
  return (envName && process.env[envName]) || "";
}
