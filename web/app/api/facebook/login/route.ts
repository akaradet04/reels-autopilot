import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { facebookApp } from "@/lib/facebookApp";

const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management"];

export async function GET(req: Request) {
  const auth = await requireRole("admin");
  if ("error" in auth) return NextResponse.redirect(new URL("/login", req.url));
  const app = await facebookApp();
  if (!app) {
    return NextResponse.redirect(new URL(`/pages?fb_error=${encodeURIComponent("ยังไม่ได้ตั้งค่า Facebook App ในหน้าตั้งค่า")}`, req.url));
  }

  const state = randomBytes(16).toString("hex");
  const origin = new URL(req.url).origin;
  const url = new URL(`https://www.facebook.com/${app.version}/dialog/oauth`);
  url.searchParams.set("client_id", app.id);
  url.searchParams.set("redirect_uri", `${origin}/api/facebook/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("auth_type", "rerequest");

  const res = NextResponse.redirect(url);
  res.cookies.set("fb_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
