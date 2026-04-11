import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionCookieDetailed } from "@/lib/firebaseAdmin";
import SidebarShell from "./SidebarShell";

export const dynamic = "force-dynamic";

interface ProtectedLayoutProps {
  children: ReactNode;
  modal: ReactNode;
}

function ProtectedSessionError() {
  return (
    <main className="min-h-screen px-4 py-10">
      <section className="mx-auto max-w-lg rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Session indisponible</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          La validation serveur de la session Firebase est indisponible. Reconnecte-toi si le problème disparaît,
          sinon vérifie la configuration Firebase Admin du serveur.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href="/login?reason=session-service-unavailable"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Retour à la connexion
          </a>
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium"
          >
            Réessayer
          </a>
        </div>
      </section>
    </main>
  );
}

export default async function ProtectedLayout({ children, modal }: ProtectedLayoutProps) {
  const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";
  if (useEmulators && process.env.NODE_ENV !== "production") {
    return (
      <SidebarShell>
        {children}
        {modal}
      </SidebarShell>
    );
  }

  const sessionCookie = (await cookies()).get("session")?.value;
  if (!sessionCookie) {
    redirect("/login?reason=auth-required");
  }

  const verification = await verifySessionCookieDetailed(sessionCookie);
  if (verification.errorCode === "service_unavailable") {
    return <ProtectedSessionError />;
  }

  if (!verification.decoded) {
    redirect("/login?reason=session-invalid");
  }

  return (
    <SidebarShell>
      {children}
      {modal}
    </SidebarShell>
  );
}
