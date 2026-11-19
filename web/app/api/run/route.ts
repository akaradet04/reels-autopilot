import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { runWorkerNow } from "@/lib/dispatch";

export async function POST() {
  const auth = await requireRole("admin");
  if ("error" in auth) return auth.error;
  const ok = await runWorkerNow();
  return NextResponse.json({
    message: ok ? "สั่งให้ระบบทำงานแล้ว จะเริ่มภายใน 1-2 นาที" : "ระบบจะทำงานรอบถัดไปภายใน 30 นาที",
  });
}
