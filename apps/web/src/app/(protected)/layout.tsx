import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionCookie } from "@/lib/firebaseAdmin";
import SidebarWorkspaces from "./SidebarWorkspaces";

export const dynamic = "force-dynamic";

interface ProtectedLayoutProps {
  children: ReactNode;
}

export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const sessionCookie = (await cookies()).get("session")?.value;
  if (!sessionCookie) {
    redirect("/login");
  }

  const decoded = await verifySessionCookie(sessionCookie);
  if (!decoded) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-64 border-r border-border p-4">
        <SidebarWorkspaces />
      </aside>
      <div className="flex-1 flex flex-col">
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
