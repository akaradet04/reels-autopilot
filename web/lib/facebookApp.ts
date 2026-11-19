import { getSecret } from "./secrets";

export async function facebookApp(): Promise<{ id: string; secret: string; version: string } | null> {
  const [id, secret] = await Promise.all([getSecret("fb_app_id", "FB_APP_ID"), getSecret("fb_app_secret", "FB_APP_SECRET")]);
  if (!id || !secret) return null;
  return { id, secret, version: process.env.FB_GRAPH_VERSION || "v23.0" };
}
