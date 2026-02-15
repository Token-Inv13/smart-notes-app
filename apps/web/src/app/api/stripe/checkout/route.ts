import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import Stripe from 'stripe';
import { verifySessionCookie, getAdminDb } from '@/lib/firebaseAdmin';
import type { UserDoc } from '@/types/firestore';

const SESSION_COOKIE_NAME = 'session';

export const runtime = 'nodejs';

const FALLBACK_APP_ORIGIN = 'https://app.tachesnotes.com';

function parseOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isValidForwardedHost(value: string): boolean {
  return /^[a-z0-9.-]+(?::\d+)?$/i.test(value);
}

async function getAppOrigin(): Promise<string> {
  const configuredOrigin =
    parseOrigin(process.env.NEXT_PUBLIC_APP_URL) ?? parseOrigin(process.env.APP_BASE_URL) ?? null;
  if (configuredOrigin) return configuredOrigin;

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host || !isValidForwardedHost(host)) return FALLBACK_APP_ORIGIN;

  const proto = h.get('x-forwarded-proto') === 'http' ? 'http' : 'https';
  return `${proto}://${host}`;
}

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

    const origin = await getAppOrigin();

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
