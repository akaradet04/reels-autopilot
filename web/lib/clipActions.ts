import { adminSupabase } from "./supabase/admin";
import { runWorkerNow } from "./dispatch";

export type ClipAction = "post" | "approve" | "delay" | "cancel" | "delete" | "retry";

const OPEN = ["pending", "scheduled", "notified", "awaiting_approval"];
const MIN = 60_000;

function gapMs(): number {
  return (20 + Math.floor(Math.random() * 21)) * MIN;
}

/** Shared by the web queue and the Telegram buttons. Returns a short Thai result message. */
export async function applyClipAction(clipId: string, action: ClipAction, actorId: string | null): Promise<string> {
  const db = adminSupabase();
  const { data: clip } = await db.from("clips").select("*").eq("id", clipId).single();
  if (!clip) throw new Error("ไม่พบคลิปนี้");
  const { data: posts = [] } = await db.from("clip_posts").select("*").eq("clip_id", clipId).order("scheduled_at");
  const open = (posts ?? []).filter((p: any) => OPEN.includes(p.status));
  const now = Date.now();

  if (action === "post") {
    if (!open.length) return "ไม่มีโพสต์ที่รออยู่";
    let t = now;
    for (const [i, p] of open.entries()) {
      if (i > 0) t += gapMs();
      await db.from("clip_posts").update({
        scheduled_at: new Date(t).toISOString(),
        post_now: true,
        approved_by: actorId,
        status: p.status === "awaiting_approval" ? "scheduled" : p.status,
      }).eq("id", p.id);
    }
    await runWorkerNow();
    return clip.status === "ready" ? "กำลังโพสต์ทันที" : "จะโพสต์ทันทีที่คลิปผลิตเสร็จ";
  }

  if (action === "approve") {
    const waiting = open.filter((p: any) => p.status === "awaiting_approval");
    if (!waiting.length) return "ไม่มีโพสต์ที่รออนุมัติ";
    await db.from("clip_posts").update({ status: "scheduled", approved_by: actorId })
      .in("id", waiting.map((p: any) => p.id));
    return "อนุมัติแล้ว จะโพสต์ตามเวลา";
  }

  if (action === "delay") {
    if (!open.length) return "ไม่มีโพสต์ที่รออยู่";
    for (const p of open) {
      const base = Math.max(new Date(p.scheduled_at).getTime(), now);
      await db.from("clip_posts").update({ scheduled_at: new Date(base + 60 * MIN).toISOString() }).eq("id", p.id);
    }
    return "เลื่อนออกไป 1 ชั่วโมงแล้ว";
  }

  if (action === "cancel") {
    if (!open.length) return "ไม่มีโพสต์ที่ยกเลิกได้";
    await db.from("clip_posts").update({ status: "cancelled", error: "ยกเลิกโดยผู้ใช้" }).in("id", open.map((p: any) => p.id));
    if (["planned", "producing"].includes(clip.status)) {
      await db.from("clips").update({ status: "cancelled" }).eq("id", clipId);
    }
    // Planned clips get a replacement on a different topic in the same slots.
    if (!clip.created_by) {
      const { data: fresh } = await db.from("clips").insert({
        plan_date: clip.plan_date, category: clip.category, style_id: clip.style_id,
        produce_after: new Date().toISOString(), status: "planned",
      }).select("id").single();
      if (fresh) {
        let t = now + 60 * MIN;
        await db.from("clip_posts").insert(open.map((p: any) => {
          const at = Math.max(new Date(p.scheduled_at).getTime(), t);
          t = at + gapMs();
          return { clip_id: fresh.id, page_id: p.page_id, scheduled_at: new Date(at).toISOString(), status: "pending" };
        }));
        await runWorkerNow();
        return "ยกเลิกแล้ว ระบบกำลังทำคลิปใหม่มาแทน";
      }
    }
    return "ยกเลิกแล้ว";
  }

  if (action === "delete") {
    const live = (posts ?? []).filter((p: any) => p.status === "posted" && p.fb_video_id);
    if (!live.length) return "ไม่มีโพสต์ที่ลบได้";
    await db.from("clip_posts").update({ status: "delete_requested" }).in("id", live.map((p: any) => p.id));
    await runWorkerNow();
    return `กำลังลบ ${live.length} โพสต์`;
  }

  if (action === "retry") {
    const failed = (posts ?? []).filter((p: any) => p.status === "failed");
    if (clip.status === "failed") {
      // Production failed: make it again, then post to every page whose post failed.
      await db.from("clips").update({ status: "planned", attempts: 0, error: null, produce_after: new Date().toISOString() }).eq("id", clipId);
      if (failed.length) {
        let t = now + 60 * MIN;
        for (const p of failed) {
          await db.from("clip_posts").update({ status: "pending", error: null, scheduled_at: new Date(t).toISOString() }).eq("id", p.id);
          t += gapMs();
        }
      }
      return "กำลังผลิตคลิปใหม่ แล้วจะโพสต์ตามเวลาใหม่";
    }
    if (!failed.length) return "ไม่มีโพสต์ที่ล้มเหลว";
    let t = now;
    for (const [i, p] of failed.entries()) {
      if (i > 0) t += gapMs();
      await db.from("clip_posts").update({ status: "scheduled", error: null, post_now: true, scheduled_at: new Date(t).toISOString() }).eq("id", p.id);
    }
    return `จะลองโพสต์ใหม่ ${failed.length} โพสต์ภายใน 10 นาที`;
  }

  throw new Error("ไม่รู้จักคำสั่งนี้");
}
