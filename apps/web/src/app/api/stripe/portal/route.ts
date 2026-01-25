import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import Stripe from 'stripe';
import { getAdminDb, verifySessionCookie } from '@/lib/firebaseAdmin';
import type { UserDoc } from '@/types/firestore';

export const runtime = 'nodejs';

const SESSION_COOKIE_NAME = 'session';

export async function POST() {
  try {
    const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) return new NextResponse('Unauthorized', { status: 401 });

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded) return new NextResponse('Unauthorized', { status: 401 });

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return new NextResponse('Missing STRIPE_SECRET_KEY', { status: 500 });

    const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });

    const db = getAdminDb();
    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const userData: Partial<UserDoc> = (userSnap.data() as UserDoc | undefined) ?? {};

    const customer = userData.stripeCustomerId;
    if (!customer) {
      console.error('Stripe portal: missing stripeCustomerId', { uid: decoded.uid });
      return new NextResponse('Missing stripeCustomerId', { status: 400 });
    }

    const h = await headers();
    const origin = h.get('origin') ?? 'http://localhost:3000';

    const portal = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${origin}/upgrade`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (e) {
    console.error('Error creating billing portal session', e);
    return new NextResponse('Failed to create portal session', { status: 500 });
  }
}
