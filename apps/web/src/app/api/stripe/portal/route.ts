import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import Stripe from 'stripe';
import { getAdminDb, verifySessionCookie } from '@/lib/firebaseAdmin';
import { getServerAppOrigin } from '@/lib/serverOrigin';
import type { UserDoc } from '@/types/firestore';

export const runtime = 'nodejs';

const SESSION_COOKIE_NAME = 'session';

type StripeLikeError = {
  message?: string;
  code?: string;
  param?: string;
  type?: string;
  requestId?: string;
  statusCode?: number;
};

function isNoSuchCustomerError(err: unknown): boolean {
  const stripeErr = err as StripeLikeError;
  const message = typeof stripeErr?.message === 'string' ? stripeErr.message : '';
  const lower = message.toLowerCase();
  if (lower.includes('no such customer')) return true;
  if (stripeErr?.code === 'resource_missing' && (stripeErr?.param === 'customer' || lower.includes('customer'))) return true;
  return false;
}

function getCustomerIdFromSubscription(sub: Stripe.Subscription): string | null {
  const customer = sub.customer;
  if (!customer) return null;
  if (typeof customer === 'string') return customer;
  if (typeof customer?.id === 'string') return customer.id;
  return null;
}

async function recoverCustomerIdByEmail(stripe: Stripe, email: string): Promise<string | null> {
  const res = await stripe.customers.list({ email, limit: 1 });
  const first = res.data?.[0];
  return first?.id ?? null;
}

async function recoverFromSubscriptionSearch(
  stripe: Stripe,
  uid: string,
): Promise<{ customerId: string; subscriptionId: string; status: Stripe.Subscription.Status } | null> {
  try {
    const res = await stripe.subscriptions.search({ query: `metadata['userId']:'${uid}'`, limit: 1 });
    const sub = res.data?.[0];
    if (!sub) return null;
    const customerId = getCustomerIdFromSubscription(sub);
    if (!customerId) return null;
    return { customerId, subscriptionId: sub.id, status: sub.status };
  } catch {
    return null;
  }
}

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

    const origin = await getServerAppOrigin();

    const attemptCreatePortal = async (customerId: string) =>
      stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/upgrade`,
      });

    const attemptRecoveryAndCreate = async (err: unknown) => {
      if (!isNoSuchCustomerError(err)) throw err;

      // Recovery path #1: derive customer from subscription id (if present)
      if (typeof userData.stripeSubscriptionId === 'string' && userData.stripeSubscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(userData.stripeSubscriptionId);
          const recoveredCustomer = getCustomerIdFromSubscription(sub);
          if (recoveredCustomer) {
            await db.collection('users').doc(decoded.uid).update({ stripeCustomerId: recoveredCustomer });
            const portal = await attemptCreatePortal(recoveredCustomer);
            return NextResponse.json({ url: portal.url });
          }
        } catch {
          // ignore, try email-based recovery
        }
      }

      // Recovery path #2: search live subscriptions by metadata.userId
      const fromSearch = await recoverFromSubscriptionSearch(stripe, decoded.uid);
      if (fromSearch) {
        await db.collection('users').doc(decoded.uid).update({
          stripeCustomerId: fromSearch.customerId,
          stripeSubscriptionId: fromSearch.subscriptionId,
          stripeSubscriptionStatus: fromSearch.status,
        });
        const portal = await attemptCreatePortal(fromSearch.customerId);
        return NextResponse.json({ url: portal.url });
      }

      // Recovery path #3: find an existing live customer by email
      if (typeof decoded.email === 'string' && decoded.email) {
        const recoveredCustomer = await recoverCustomerIdByEmail(stripe, decoded.email);
        if (recoveredCustomer) {
          await db.collection('users').doc(decoded.uid).update({ stripeCustomerId: recoveredCustomer });
          const portal = await attemptCreatePortal(recoveredCustomer);
          return NextResponse.json({ url: portal.url });
        }
      }

      throw err;
    };

    if (!customer) {
      console.error('Stripe portal: missing stripeCustomerId', { uid: decoded.uid });
      const fromSearch = await recoverFromSubscriptionSearch(stripe, decoded.uid);
      if (fromSearch) {
        await db.collection('users').doc(decoded.uid).update({
          stripeCustomerId: fromSearch.customerId,
          stripeSubscriptionId: fromSearch.subscriptionId,
          stripeSubscriptionStatus: fromSearch.status,
        });
        const portal = await attemptCreatePortal(fromSearch.customerId);
        return NextResponse.json({ url: portal.url });
      }

      if (typeof decoded.email === 'string' && decoded.email) {
        const recoveredCustomer = await recoverCustomerIdByEmail(stripe, decoded.email);
        if (recoveredCustomer) {
          await db.collection('users').doc(decoded.uid).update({ stripeCustomerId: recoveredCustomer });
          const portal = await attemptCreatePortal(recoveredCustomer);
          return NextResponse.json({ url: portal.url });
        }
      }

      return new NextResponse('Missing stripeCustomerId', { status: 400 });
    }

    try {
      const portal = await attemptCreatePortal(customer);
      return NextResponse.json({ url: portal.url });
    } catch (err) {
      return await attemptRecoveryAndCreate(err);
    }
  } catch (e) {
    const stripeError = e as StripeLikeError;
    const message = typeof stripeError?.message === 'string' ? stripeError.message : '';
    const lower = message.toLowerCase();

    console.error('Error creating billing portal session', {
      message,
      type: stripeError?.type,
      code: stripeError?.code,
      requestId: stripeError?.requestId,
      statusCode: stripeError?.statusCode,
    });

    if (lower.includes('return_url') && (lower.includes('allowed') || lower.includes('not allowed'))) {
      return new NextResponse('RETURN_URL_NOT_ALLOWED', { status: 400 });
    }
    if (isNoSuchCustomerError(stripeError)) {
      return new NextResponse('NO_SUCH_CUSTOMER', { status: 400 });
    }
    if (lower.includes('customer portal') && (lower.includes('not enabled') || lower.includes('not been configured'))) {
      return new NextResponse('PORTAL_NOT_ENABLED', { status: 500 });
    }

    return new NextResponse('Failed to create portal session', { status: 500 });
  }
}
