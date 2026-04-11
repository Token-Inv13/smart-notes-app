import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionCookieDetailed } from '@/lib/firebaseAdmin';

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const sessionCookie = (await cookies()).get('session')?.value;
  if (!sessionCookie) {
    redirect('/login?next=/admin&reason=auth-required');
  }

  const verification = await verifySessionCookieDetailed(sessionCookie);
  if (verification.errorCode === 'service_unavailable') {
    return (
      <main className="min-h-[70vh] flex items-center justify-center px-4">
        <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold">Session admin indisponible</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            La validation serveur de la session admin est indisponible. Vérifie la configuration Firebase Admin.
          </p>
          <a
            href="/login?next=/admin&reason=session-service-unavailable"
            className="mt-5 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Retour à la connexion
          </a>
        </section>
      </main>
    );
  }

  const decoded = verification.decoded;
  if (!decoded) {
    redirect('/login?next=/admin&reason=session-invalid');
  }

  const token = decoded as Record<string, unknown>;
  if (token.admin !== true) {
    redirect('/access-denied');
  }

  return <>{children}</>;
}
