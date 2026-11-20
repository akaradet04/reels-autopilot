import { NextResponse } from "next/server";
import { canAccessPages, requireRole } from "@/lib/auth";
import { applyClipAction, type ClipAction } from "@/lib/clipActions";
import { adminSupabase } from "@/lib/supabase/admin";

const ACTIONS: ClipAction[] = ["post", "approve", "delay", "cancel", "delete", "retry"];

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole("reviewer");
  if ("error" in auth) return auth.error;
  const { action } = await req.json();
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });

  const { data: posts } = await adminSupabase().from("clip_posts").select("page_id").eq("clip_id", params.id);
  const pageIds = Array.from(new Set((posts ?? []).map((p) => p.page_id as string)));
  if (!(await canAccessPages(auth.me, pageIds))) {
    return NextResponse.json({ error: "คุณไม่ได้ดูแลบางเพจของคลิปนี้" }, { status: 403 });
  }
  try {
    const message = await applyClipAction(params.id, action, auth.me.id);
    return NextResponse.json({ message });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
