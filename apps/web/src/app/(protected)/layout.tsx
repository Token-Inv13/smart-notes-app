import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionCookie } from "@/lib/firebaseAdmin";
import SidebarShell from "./SidebarShell";

export const dynamic = "force-dynamic";

interface ProtectedLayoutProps {
  children: ReactNode;
  modal: ReactNode;
}

export default async function ProtectedLayout({ children, modal }: ProtectedLayoutProps) {
  const sessionCookie = (await cookies()).get("session")?.value;
  if (!sessionCookie) {
    redirect("/login");
  }

  const decoded = await verifySessionCookie(sessionCookie);
  if (!decoded) {
    redirect("/login");
  }

  return (
    <SidebarShell>
      {children}
      {modal}
    </SidebarShell>
  );
}
