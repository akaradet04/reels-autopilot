import { supabase } from "@/lib/supabase/client";

/** Saves one setting, creating the row when the key is new (owner only, enforced by RLS). */
export async function saveSetting(key: string, value: unknown): Promise<string | null> {
  const { error } = await supabase().from("settings").upsert({ key, value }, { onConflict: "key" });
  return error ? error.message : null;
}
