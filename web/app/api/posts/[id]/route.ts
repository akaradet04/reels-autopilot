import { NextResponse } from "next/server";
import { canAccessPages, requireRole } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";

const EDITABLE = ["pending", "scheduled", "notified", "awaiting_approval"];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole("reviewer");
  if ("error" in auth) return auth.error;
  const db = adminSupabase();
  const { data: post } = await db.from("clip_posts").select("page_id,status").eq("id", params.id).single();
  if (!post) return NextResponse.json({ error: "ไม่พบโพสต์นี้" }, { status: 404 });
  if (!(await canAccessPages(auth.me, [post.page_id]))) return NextResponse.json({ error: "คุณไม่ได้ดูแลเพจนี้" }, { status: 403 });
  if (!EDITABLE.includes(post.status)) return NextResponse.json({ error: "โพสต์นี้แก้ไขไม่ได้แล้ว" }, { status: 400 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.caption === "string") patch.caption = body.caption.slice(0, 2200);
  if (body.scheduled_at) {
    const t = new Date(body.scheduled_at);
    if (Number.isNaN(t.getTime())) return NextResponse.json({ error: "เวลาไม่ถูกต้อง" }, { status: 400 });
    patch.scheduled_at = t.toISOString();
  }
  await db.from("clip_posts").update(patch).eq("id", params.id);
  return NextResponse.json({ message: "บันทึกแล้ว" });
}
