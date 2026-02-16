import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import Stripe from 'stripe';
import admin from 'firebase-admin';
import { getAdminDb, getAdminProjectId, verifySessionCookie } from '@/lib/firebaseAdmin';
import { logServerError, logServerWarn } from '@/lib/observability';
import { getStripeModeFromSecret, normalizeEmail, normalizeStripeId, type StripeMode } from '@/lib/stripeUtils';
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

function isSubscriptionModeMismatch(sub: Stripe.Subscription, stripeMode: StripeMode): boolean {
  if (stripeMode === 'unknown') return false;
  const subMode: 'live' | 'test' = sub.livemode ? 'live' : 'test';
  return subMode !== stripeMode;
}

function getCustomerIdFromSubscription(sub: Stripe.Subscription): string | null {
  const customer = sub.customer;
  return normalizeStripeId(customer);
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
}): Promise<{ subscription: Stripe.Subscription | null; attempts: Array<{ step: string; ok: boolean; detail?: string }> }> {
  const { stripe, uid, email, userData } = params;
  const stripeSubscriptionId = normalizeStripeId(userData.stripeSubscriptionId);
  const stripeCustomerId = normalizeStripeId(userData.stripeCustomerId);
  const normalizedEmail = normalizeEmail(email);

  const attempts: Array<{ step: string; ok: boolean; detail?: string }> = [];

  if (stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      attempts.push({ step: 'retrieve_by_subscription_id', ok: true });
      return { subscription: sub, attempts };
    } catch {
      attempts.push({ step: 'retrieve_by_subscription_id', ok: false, detail: 'retrieve_failed' });
    }
  }

  attempts.push({ step: 'retrieve_by_subscription_id', ok: false, detail: 'missing_subscription_id' });

  if (stripeCustomerId) {
    try {
      const res = await stripe.subscriptions.list({ customer: stripeCustomerId, status: 'all', limit: 10 });
      const sub = pickMostRecentSubscription(res.data);
      if (sub) {
        attempts.push({ step: 'list_by_customer_id', ok: true });
        return { subscription: sub, attempts };
      }
      attempts.push({ step: 'list_by_customer_id', ok: false, detail: 'no_subscription_for_customer' });
    } catch {
      attempts.push({ step: 'list_by_customer_id', ok: false, detail: 'list_failed' });
    }
  } else {
    attempts.push({ step: 'list_by_customer_id', ok: false, detail: 'missing_customer_id' });
  }

  try {
    const res = await stripe.subscriptions.search({ query: `metadata['userId']:'${uid}'`, limit: 10 });
    const sub = pickMostRecentSubscription(res.data);
    if (sub) {
      attempts.push({ step: 'search_by_metadata_user_id', ok: true });
      return { subscription: sub, attempts };
    }
    attempts.push({ step: 'search_by_metadata_user_id', ok: false, detail: 'no_match' });
  } catch {
    attempts.push({ step: 'search_by_metadata_user_id', ok: false, detail: 'search_failed' });
  }

  if (normalizedEmail) {
    try {
      const customers = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
      const customerId = normalizeStripeId(customers.data?.[0]?.id);
      if (customerId) {
        const res = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
        const sub = pickMostRecentSubscription(res.data);
        if (sub) {
          attempts.push({ step: 'lookup_by_email_then_list', ok: true });
          return { subscription: sub, attempts };
        }
        attempts.push({ step: 'lookup_by_email_then_list', ok: false, detail: 'no_subscription_for_email_customer' });
      } else {
        attempts.push({ step: 'lookup_by_email_then_list', ok: false, detail: 'no_customer_for_email' });
      }
    } catch {
      attempts.push({ step: 'lookup_by_email_then_list', ok: false, detail: 'email_lookup_failed' });
    }
  } else {
    attempts.push({ step: 'lookup_by_email_then_list', ok: false, detail: 'missing_email' });
  }

  return { subscription: null, attempts };
}

export async function POST() {
  const requestId = crypto.randomUUID();
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

    const { subscription: sub, attempts } = await getSubscriptionForUser({
      stripe,
      uid: decoded.uid,
      email: decoded.email ?? null,
      userData,
    });

    const stripeMode = getStripeModeFromSecret(process.env.STRIPE_SECRET_KEY);
    const adminProjectId = getAdminProjectId();

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

      return NextResponse.json({ ok: true, found: false, stripeMode, adminProjectId, attempts });
    }

    if (isSubscriptionModeMismatch(sub, stripeMode)) {
      const subscriptionMode = sub.livemode ? 'live' : 'test';
      logServerWarn('stripe.sync.mode_mismatch', {
        requestId,
        uid: decoded.uid,
        stripeMode,
        subscriptionMode,
        subscriptionId: sub.id,
      });
      return NextResponse.json({
        ok: true,
        found: false,
        ignored: true,
        reason: 'mode_mismatch',
        stripeMode,
        adminProjectId,
        attempts,
      });
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

    return NextResponse.json({
      ok: true,
      found: true,
      stripeMode,
      adminProjectId,
      attempts,
      subscription: {
        id: sub.id,
        status,
        customerId: getCustomerIdFromSubscription(sub),
      },
      plan: isActive ? 'pro' : 'free',
    });
  } catch (e) {
    logServerError('stripe.sync.failure', { requestId, error: e });
    return new NextResponse('Sync failed', { status: 500 });
  }
}
