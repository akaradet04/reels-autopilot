"use client";

import { publicUrl } from "@/lib/supabase/client";
import type { StyleConfig } from "@/lib/types";

/** A scaled stand-in for the rendered video: same layout, colors and outline as worker/render.py. */
export default function StylePreview({ config, sample }: {
  config: StyleConfig;
  sample?: { hook: string; keyword: string; body: string; cta: string };
}) {
  const s = sample ?? { hook: "ก่อนนอนคืนนี้ ทำสิ่งนี้", keyword: "สวดบทนี้ 7 คืน", body: "หายใจช้าๆ 3 ครั้ง\nปล่อยเรื่องค้างใจ", cta: "บันทึกไว้ ทำ 7 คืน" };
  const logo = publicUrl(config.logo_path);
  return (
    <div className={`preview ${config.background === "photo" ? "photo" : ""}`} aria-label="ตัวอย่างหน้าตาคลิป">
      <div className="dim" style={{ opacity: config.dim }} />
      <div className="t hook" style={{ color: config.hook_color }}>{s.hook}</div>
      <div className="t kw" style={{ color: config.keyword_color }}>{s.keyword}</div>
      <div className="t body" style={{ color: config.body_color, whiteSpace: "pre-line" }}>{s.body}</div>
      <div className="t cta" style={{ color: config.cta_color }}>{s.cta}</div>
      {config.show_logo && (logo ? <img className="logo" src={logo} alt="" /> : <span className="logo" />)}
    </div>
  );
}
