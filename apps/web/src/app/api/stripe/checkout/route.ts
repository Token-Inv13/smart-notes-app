import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import Stripe from 'stripe';
import { verifySessionCookie, getAdminDb } from '@/lib/firebaseAdmin';
import { getServerAppOrigin } from '@/lib/serverOrigin';
import type { UserDoc } from '@/types/firestore';

const SESSION_COOKIE_NAME = 'session';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) return new NextResponse('Unauthorized', { status: 401 });

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded) return new NextResponse('Unauthorized', { status: 401 });

    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;

    if (!secretKey) return new NextResponse('Missing STRIPE_SECRET_KEY', { status: 500 });
    if (!priceId) return new NextResponse('Missing STRIPE_PRICE_ID', { status: 500 });

    const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });

    const origin = await getServerAppOrigin();

    const db = getAdminDb();
    const userRef = db.collection('users').doc(decoded.uid);
    const userSnap = await userRef.get();
    const userData: Partial<UserDoc> = (userSnap.data() as UserDoc | undefined) ?? {};

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/upgrade/success`,
      cancel_url: `${origin}/upgrade/cancel`,
      client_reference_id: decoded.uid,
      customer: userData.stripeCustomerId ?? undefined,
      customer_email: userData.stripeCustomerId ? undefined : decoded.email ?? undefined,
      subscription_data: {
        metadata: {
          userId: decoded.uid,
        },
      },
      metadata: {
        userId: decoded.uid,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('Error creating Stripe checkout session', e);
    const message = e instanceof Error ? e.message : 'Failed to create checkout session';
    return new NextResponse(message, { status: 500 });
  }
}
