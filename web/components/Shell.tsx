"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { Icon, ToastProvider } from "./ui";

const MeCtx = createContext<Profile | null>(null);
export const useMe = () => useContext(MeCtx)!;

const NAV: { href: string; label: string; icon: () => JSX.Element; badge?: boolean; desk?: boolean }[] = [
  { href: "/", label: "หน้าหลัก", icon: Icon.home },
  { href: "/queue", label: "คิวคลิป", icon: Icon.queue, badge: true },
  { href: "/stats", label: "ผลงาน", icon: Icon.chart },
  { href: "/pages", label: "เพจ", icon: Icon.pages },
  { href: "/styles", label: "สไตล์", icon: Icon.style, desk: true },
  { href: "/status", label: "สถานะระบบ", icon: Icon.pulse, desk: true },
  { href: "/settings", label: "ตั้งค่า", icon: Icon.settings },
];

export default function Shell({ me, children }: { me: Profile; children: React.ReactNode }) {
  const path = usePathname();
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { count } = await supabase().from("clip_posts").select("id", { count: "exact", head: true })
        .eq("status", "awaiting_approval");
      setWaiting(count ?? 0);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [path]);

  return (
    <MeCtx.Provider value={me}>
      <ToastProvider>
        <div className="shell">
          <nav className="nav" aria-label="เมนูหลัก">
            <div className="brand"><span className="app-icon" style={{ width: 30, height: 30, borderRadius: 8, margin: 0 }}><Icon.logo /></span>Reels Autopilot</div>
            {NAV.map(({ href, label, icon: I, badge, desk }) => {
              const active = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link key={href} href={href} aria-current={active ? "page" : undefined} className={desk ? "desk" : undefined}>
                  <I />
                  <span>{label}</span>
                  {badge && waiting > 0 && <span className="badge">{waiting}</span>}
                </Link>
              );
            })}
            <div className="nav-foot">{me.email}</div>
          </nav>
          <main className="main">{children}</main>
        </div>
      </ToastProvider>
    </MeCtx.Provider>
  );
}
