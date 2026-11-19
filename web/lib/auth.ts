import { NextResponse } from "next/server";
import { adminSupabase } from "./supabase/admin";
import { serverSupabase } from "./supabase/server";
import type { Profile, Role } from "./types";

export async function caller(): Promise<Profile | null> {
  const { data } = await serverSupabase().auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await adminSupabase()
    .from("profiles").select("id,email,display_name,role").eq("id", data.user.id).single();
  return (profile as Profile) ?? null;
}

const RANK: Record<Role, number> = { reviewer: 1, admin: 2, owner: 3 };

/** Returns the caller, or a ready-made error response when they lack the role. */
export async function requireRole(min: Role): Promise<{ me: Profile } | { error: NextResponse }> {
  const me = await caller();
  if (!me) return { error: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) };
  if (!me.role || RANK[me.role] < RANK[min]) {
    return { error: NextResponse.json({ error: "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้" }, { status: 403 }) };
  }
  return { me };
}

export async function canAccessPages(me: Profile, pageIds: string[]): Promise<boolean> {
  if (me.role === "owner") return true;
  if (!pageIds.length) return true;
  const { data } = await adminSupabase().from("page_members").select("page_id").eq("user_id", me.id).in("page_id", pageIds);
  return (data?.length ?? 0) === new Set(pageIds).size;
}
