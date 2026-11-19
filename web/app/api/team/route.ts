import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";

const ROLES = ["admin", "reviewer"];

async function setPages(userId: string, pageIds: string[]) {
  const db = adminSupabase();
  await db.from("page_members").delete().eq("user_id", userId);
  if (pageIds.length) await db.from("page_members").insert(pageIds.map((page_id) => ({ user_id: userId, page_id })));
}

/**
 * Add a team member with an email and a starting password the owner hands over.
 * No email is sent: Supabase's built-in mailer only delivers to the project's own team.
 */
export async function POST(req: Request) {
  const auth = await requireRole("owner");
  if ("error" in auth) return auth.error;
  const body = await req.json();
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "");
  const password = String(body.password || "");
  const pageIds: string[] = Array.isArray(body.page_ids) ? body.page_ids : [];
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "อีเมลไม่ถูกต้อง" }, { status: 400 });
  if (!ROLES.includes(role)) return NextResponse.json({ error: "บทบาทไม่ถูกต้อง" }, { status: 400 });

  const db = adminSupabase();
  const { data: existing } = await db.from("profiles").select("id,role").ilike("email", email).maybeSingle();
  if (existing) {
    if (existing.role === "owner") return NextResponse.json({ error: "บัญชีนี้เป็นเจ้าของอยู่แล้ว" }, { status: 400 });
    await db.from("profiles").update({ role }).eq("id", existing.id);
    await setPages(existing.id, pageIds);
    return NextResponse.json({ message: "เพิ่มเข้าทีมแล้ว" });
  }

  if (password.length < 8) return NextResponse.json({ error: "รหัสผ่านเริ่มต้นต้องยาวอย่างน้อย 8 ตัว" }, { status: 400 });
  // The sign-up trigger reads this invitation and assigns the role and pages.
  await db.from("invitations").upsert({ email, role, page_ids: pageIds, invited_by: auth.me.id });
  const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    await db.from("invitations").delete().eq("email", email);
    return NextResponse.json({ error: `สร้างบัญชีไม่สำเร็จ: ${error.message}` }, { status: 400 });
  }
  return NextResponse.json({ message: "เพิ่มเข้าทีมแล้ว ส่งอีเมลและรหัสผ่านให้เขาเข้าสู่ระบบได้เลย" });
}

/** Change a member's role or pages. */
export async function PATCH(req: Request) {
  const auth = await requireRole("owner");
  if ("error" in auth) return auth.error;
  const body = await req.json();
  if (body.user_id === auth.me.id) return NextResponse.json({ error: "เปลี่ยนบทบาทของตัวเองไม่ได้" }, { status: 400 });
  const db = adminSupabase();
  if (body.role) {
    if (!ROLES.includes(body.role)) return NextResponse.json({ error: "บทบาทไม่ถูกต้อง" }, { status: 400 });
    await db.from("profiles").update({ role: body.role }).eq("id", body.user_id);
  }
  if (Array.isArray(body.page_ids)) await setPages(body.user_id, body.page_ids);
  return NextResponse.json({ message: "บันทึกแล้ว" });
}

/** Remove a member or cancel an invitation. */
export async function DELETE(req: Request) {
  const auth = await requireRole("owner");
  if ("error" in auth) return auth.error;
  const params = new URL(req.url).searchParams;
  const db = adminSupabase();
  const email = params.get("email");
  if (email) {
    await db.from("invitations").delete().eq("email", email);
    return NextResponse.json({ message: "ยกเลิกคำเชิญแล้ว" });
  }
  const userId = params.get("user_id");
  if (!userId || userId === auth.me.id) return NextResponse.json({ error: "ลบบัญชีนี้ไม่ได้" }, { status: 400 });
  await db.from("profiles").update({ role: null }).eq("id", userId);
  await db.from("page_members").delete().eq("user_id", userId);
  await db.from("fb_connections").delete().eq("user_id", userId);
  return NextResponse.json({ message: "นำออกจากทีมแล้ว" });
}
