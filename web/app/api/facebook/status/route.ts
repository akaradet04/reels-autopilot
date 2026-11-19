import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { facebookApp } from "@/lib/facebookApp";

export async function GET(req: Request) {
  const auth = await requireRole("reviewer");
  if ("error" in auth) return auth.error;
  const app = await facebookApp();
  return NextResponse.json({
    configured: Boolean(app),
    redirect_uri: `${new URL(req.url).origin}/api/facebook/callback`,
  });
}
