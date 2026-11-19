"use client";

import { supabase } from "@/lib/supabase/client";

export default function SignOut({ className = "btn gray block" }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await supabase().auth.signOut();
        window.location.href = "/login";
      }}
    >
      ออกจากระบบ
    </button>
  );
}
