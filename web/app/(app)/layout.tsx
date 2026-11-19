import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import SignOut from "@/components/SignOut";
import { caller } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await caller();
  if (!me) redirect("/login");
  if (!me.role) {
    return (
      <div className="center-screen">
        <div className="login">
          <h1>ยังไม่มีสิทธิ์เข้าใช้</h1>
          <p className="muted" style={{ textAlign: "center" }}>
            บัญชี {me.email} ยังไม่ได้ถูกเพิ่มเข้าทีม ขอให้เจ้าของระบบเพิ่มบัญชีนี้ในหน้าตั้งค่า
          </p>
          <SignOut />
        </div>
      </div>
    );
  }
  return <Shell me={me}>{children}</Shell>;
}
