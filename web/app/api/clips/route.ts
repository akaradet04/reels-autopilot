import { NextResponse } from "next/server";
import { canAccessPages, requireRole } from "@/lib/auth";
import { CATEGORIES } from "@/lib/categories";
import { runWorkerNow } from "@/lib/dispatch";
import { adminSupabase } from "@/lib/supabase/admin";

/** Create a clip by hand: either the system makes it from a topic, or an uploaded video is posted as is. */
export async function POST(req: Request) {
  const auth = await requireRole("admin");
  if ("error" in auth) return auth.error;
  const body = await req.json();
  const pageIds: string[] = Array.isArray(body.page_ids) ? body.page_ids : [];
  const mode: "auto" | "upload" = body.mode === "upload" ? "upload" : "auto";

  if (!pageIds.length) return NextResponse.json({ error: "เลือกอย่างน้อย 1 เพจ" }, { status: 400 });
  if (!(await canAccessPages(auth.me, pageIds))) return NextResponse.json({ error: "คุณไม่ได้ดูแลบางเพจที่เลือก" }, { status: 403 });
  if (mode === "auto" && !String(body.topic || "").trim()) return NextResponse.json({ error: "พิมพ์หัวข้อก่อน" }, { status: 400 });
  if (mode === "upload" && !String(body.video_path || "").startsWith("uploads/")) {
    return NextResponse.json({ error: "อัปโหลดวิดีโอก่อน" }, { status: 400 });
  }
  const category = CATEGORIES.some((c) => c.slug === body.category) ? body.category : "news";

  const db = adminSupabase();
  const { data: pages } = await db.from("pages").select("id,style_id").in("id", pageIds);
  const start = body.when && body.when !== "asap" ? new Date(body.when).getTime() : Date.now();
  if (Number.isNaN(start)) return NextResponse.json({ error: "เวลาโพสต์ไม่ถูกต้อง" }, { status: 400 });

  const caption = String(body.caption || "").trim();
  const { data: clip, error } = await db.from("clips").insert({
    category,
    style_id: pages?.[0]?.style_id ?? null,
    topic: mode === "auto" ? String(body.topic).trim() : caption.split("\n")[0] || "วิดีโอที่อัปโหลด",
    status: mode === "upload" ? "ready" : "planned",
    video_path: mode === "upload" ? body.video_path : null,
    produce_after: new Date().toISOString(),
    created_by: auth.me.id,
  }).select("id").single();
  if (error || !clip) return NextResponse.json({ error: error?.message ?? "สร้างคลิปไม่สำเร็จ" }, { status: 500 });

  let t = start;
  const rows = pageIds.map((pid, i) => {
    if (i > 0) t += (20 + Math.floor(Math.random() * 21)) * 60_000;
    return {
      clip_id: clip.id, page_id: pid, scheduled_at: new Date(t).toISOString(),
      status: mode === "upload" ? "scheduled" : "pending",
      caption: mode === "upload" ? caption : null,
      post_now: true, approved_by: auth.me.id,
    };
  });
  await db.from("clip_posts").insert(rows);
  await runWorkerNow();
  return NextResponse.json({ id: clip.id, message: mode === "upload" ? "ตั้งเวลาโพสต์แล้ว" : "กำลังสร้างคลิป" });
}
