import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import Stripe from 'stripe';
import admin from 'firebase-admin';
import { getAdminDb, verifySessionCookie } from '@/lib/firebaseAdmin';
import type { UserDoc } from '@/types/firestore';

export const runtime = 'nodejs';

const SESSION_COOKIE_NAME = 'session';

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

function getCustomerIdFromSubscription(sub: Stripe.Subscription): string | null {
  const customer = sub.customer;
  if (!customer) return null;
  if (typeof customer === 'string') return customer;
  if (typeof customer === 'object' && 'id' in customer && typeof customer.id === 'string') return customer.id;
  return null;
}

function pickMostRecentSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  if (!subs.length) return null;
  return subs.reduce((acc, cur) => (cur.created > acc.created ? cur : acc));
}

async function getSubscriptionForUser(params: {
  stripe: Stripe;
  uid: string;
  email: string | null;
  userData: Partial<UserDoc>;
}): Promise<Stripe.Subscription | null> {
  const { stripe, uid, email, userData } = params;

  if (typeof userData.stripeSubscriptionId === 'string' && userData.stripeSubscriptionId) {
    try {
      return await stripe.subscriptions.retrieve(userData.stripeSubscriptionId);
    } catch {
      // ignore
    }
  }

  if (typeof userData.stripeCustomerId === 'string' && userData.stripeCustomerId) {
    try {
      const res = await stripe.subscriptions.list({ customer: userData.stripeCustomerId, status: 'all', limit: 10 });
      const sub = pickMostRecentSubscription(res.data);
      if (sub) return sub;
    } catch {
      // ignore
    }
  }

  try {
    const res = await stripe.subscriptions.search({ query: `metadata['userId']:'${uid}'`, limit: 10 });
    const sub = pickMostRecentSubscription(res.data);
    if (sub) return sub;
  } catch {
    // ignore
  }

  if (typeof email === 'string' && email) {
    try {
      const customers = await stripe.customers.list({ email, limit: 1 });
      const customerId = customers.data?.[0]?.id;
      if (customerId) {
        const res = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
        const sub = pickMostRecentSubscription(res.data);
        if (sub) return sub;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export async function POST() {
  try {
    const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) return new NextResponse('Unauthorized', { status: 401 });

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded) return new NextResponse('Unauthorized', { status: 401 });

    const stripe = getStripeClient();
    const db = getAdminDb();

    const userRef = db.collection('users').doc(decoded.uid);
    const userSnap = await userRef.get();
    const userData: Partial<UserDoc> = (userSnap.data() as UserDoc | undefined) ?? {};

    const sub = await getSubscriptionForUser({ stripe, uid: decoded.uid, email: decoded.email ?? null, userData });

    if (!sub) {
      const hasStripeContext =
        typeof userData.stripeSubscriptionId === 'string' ||
        typeof userData.stripeCustomerId === 'string' ||
        typeof userData.stripeSubscriptionStatus === 'string';

      if ((userData.plan ?? 'free') === 'pro' && hasStripeContext) {
        await userRef.set(
          {
            plan: 'free',
            stripeSubscriptionStatus: null,
            stripeSubscriptionCancelAtPeriodEnd: null,
            stripeSubscriptionCurrentPeriodEnd: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      return NextResponse.json({ ok: true, found: false });
    }

    const status = sub.status;
    const isActive = status === 'active' || status === 'trialing';

    await userRef.set(
      {
        plan: isActive ? 'pro' : 'free',
        stripeCustomerId: getCustomerIdFromSubscription(sub) ?? null,
        stripeSubscriptionId: sub.id,
        stripeSubscriptionStatus: status,
        stripeSubscriptionCancelAtPeriodEnd: sub.cancel_at_period_end ?? null,
        stripeSubscriptionCurrentPeriodEnd: sub.current_period_end
          ? admin.firestore.Timestamp.fromMillis(sub.current_period_end * 1000)
          : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, found: true, status, plan: isActive ? 'pro' : 'free' });
  } catch (e) {
    console.error('Stripe sync error', e);
    const message = e instanceof Error ? e.message : 'Sync failed';
    return new NextResponse(message, { status: 500 });
  }
}
