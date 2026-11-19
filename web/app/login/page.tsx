"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : error.message);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="center-screen">
      <form className="login" onSubmit={submit}>
        <div className="app-icon"><Icon.logo /></div>
        <h1>Reels Autopilot</h1>
        <div className="group">
          <div className="row">
            <label htmlFor="email" className="grow">อีเมล</label>
            <input id="email" type="email" autoComplete="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} style={{ flex: 2, color: "var(--fg)" }} />
          </div>
          <div className="row">
            <label htmlFor="password" className="grow">รหัสผ่าน</label>
            <input id="password" type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} style={{ flex: 2, color: "var(--fg)" }} />
          </div>
        </div>
        {error && <div className="banner error small">{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>
        <p className="small muted" style={{ textAlign: "center", margin: 0 }}>
          ยังไม่มีบัญชี? ขอให้เจ้าของระบบเพิ่มคุณเข้าทีมในหน้าตั้งค่า
        </p>
      </form>
    </div>
  );
}
