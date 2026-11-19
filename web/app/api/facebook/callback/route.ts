import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { facebookApp } from "@/lib/facebookApp";
import { adminSupabase } from "@/lib/supabase/admin";

const version = () => process.env.FB_GRAPH_VERSION || "v23.0";

async function graph(path: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${version()}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

function back(req: Request, query: string) {
  return NextResponse.redirect(new URL(`/pages?${query}`, req.url));
}

export async function GET(req: Request) {
  const auth = await requireRole("admin");
  if ("error" in auth) return NextResponse.redirect(new URL("/login", req.url));
  const me = auth.me;

  const params = new URL(req.url).searchParams;
  const state = cookies().get("fb_state")?.value;
  if (!state || state !== params.get("state")) return back(req, "fb_error=" + encodeURIComponent("ลิงก์หมดอายุ ลองกดเชื่อมต่อใหม่"));
  if (params.get("error")) return back(req, "fb_error=" + encodeURIComponent("ยกเลิกการเชื่อมต่อ Facebook"));

  const app = await facebookApp();
  if (!app) return back(req, "fb_error=" + encodeURIComponent("ยังไม่ได้ตั้งค่า Facebook App ในหน้าตั้งค่า"));

  try {
    const redirect = `${new URL(req.url).origin}/api/facebook/callback`;
    const short = await graph("oauth/access_token", {
      client_id: app.id, client_secret: app.secret,
      redirect_uri: redirect, code: params.get("code") || "",
    });
    const long = await graph("oauth/access_token", {
      grant_type: "fb_exchange_token", client_id: app.id,
      client_secret: app.secret, fb_exchange_token: short.access_token,
    });
    const fbUser = await graph("me", { fields: "id,name", access_token: long.access_token });
    // Page tokens issued from a long-lived user token do not expire on a timer.
    const accounts = await graph("me/accounts", {
      fields: "id,name,access_token,tasks,followers_count,fan_count,picture{url}", limit: "100",
      access_token: long.access_token,
    });

    const db = adminSupabase();
    let added = 0, connected = 0, skipped = 0;
    for (const acc of accounts.data ?? []) {
      if (!(acc.tasks ?? []).includes("CREATE_CONTENT")) { skipped++; continue; }
      let { data: page } = await db.from("pages").select("id").eq("fb_page_id", acc.id).maybeSingle();
      const info = {
        name: acc.name,
        picture_url: acc.picture?.data?.url ?? null,
        followers: acc.followers_count ?? acc.fan_count ?? null,
      };
      if (!page) {
        if (me.role !== "owner") { skipped++; continue; }
        const { data: styles } = await db.from("styles").select("id").order("created_at").limit(1);
        const ins = await db.from("pages").insert({ fb_page_id: acc.id, ...info, style_id: styles?.[0]?.id ?? null })
          .select("id").single();
        page = ins.data;
        added++;
      } else {
        await db.from("pages").update(info).eq("id", page.id);
      }
      if (!page) continue;

      const { data: existing } = await db.from("fb_connections").select("id,role,user_id").eq("page_id", page.id);
      const mine = existing?.find((c) => c.user_id === me.id);
      const hasPrimary = existing?.some((c) => c.role === "primary" && c.user_id !== me.id);
      const row = {
        page_id: page.id, user_id: me.id, fb_user_name: fbUser.name,
        token_enc: encrypt(acc.access_token), status: "ok",
        role: mine?.role ?? (hasPrimary ? "backup" : "primary"),
        last_checked_at: new Date().toISOString(),
      };
      await db.from("fb_connections").upsert(row, { onConflict: "page_id,user_id" });
      if (me.role !== "owner") {
        await db.from("page_members").upsert({ user_id: me.id, page_id: page.id }, { onConflict: "user_id,page_id" });
      }
      connected++;
    }
    const res = back(req, `fb_added=${added}&fb_connected=${connected}&fb_skipped=${skipped}`);
    res.cookies.delete("fb_state");
    return res;
  } catch (e) {
    return back(req, "fb_error=" + encodeURIComponent((e as Error).message));
  }
}
