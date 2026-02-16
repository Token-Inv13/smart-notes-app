import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionCookie } from '@/lib/firebaseAdmin';

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const sessionCookie = (await cookies()).get('session')?.value;
  if (!sessionCookie) {
    redirect('/login?next=/admin');
  }

  const decoded = await verifySessionCookie(sessionCookie);
  if (!decoded) {
    redirect('/login?next=/admin');
  }

  const token = decoded as Record<string, unknown>;
  if (token.admin !== true) {
    redirect('/access-denied');
  }

  return <>{children}</>;
}
