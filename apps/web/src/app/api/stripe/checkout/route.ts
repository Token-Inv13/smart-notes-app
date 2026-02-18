import { cookies } from 'next/headers';
import Stripe from 'stripe';
import { verifySessionCookie, getAdminDb } from '@/lib/firebaseAdmin';
import { getServerAppOrigin } from '@/lib/serverOrigin';
import { beginApiObserve, observedError, observedJson, observedText } from '@/lib/apiObservability';
import type { UserDoc } from '@/types/firestore';

const SESSION_COOKIE_NAME = 'session';

export const runtime = 'nodejs';

export async function POST() {
  const requestId = crypto.randomUUID();
  const obs = beginApiObserve({
    eventName: 'stripe.checkout.post',
    route: '/api/stripe/checkout',
    requestId,
    uid: 'anonymous',
  });

  try {
    const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) return observedText(obs, 'Unauthorized', { status: 401 });

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded) return observedText(obs, 'Unauthorized', { status: 401 });

    const obsUser = beginApiObserve({
      eventName: 'stripe.checkout.post',
      route: '/api/stripe/checkout',
      requestId,
      uid: decoded.uid,
    });

    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;

    if (!secretKey || !priceId) {
      console.error('stripe.checkout.service_unavailable', {
        hasStripeSecretKey: Boolean(secretKey),
        hasStripePriceId: Boolean(priceId),
        requestId,
        uid: decoded.uid,
      });
      return observedText(obsUser, 'Configuration du service indisponible.', { status: 500 });
    }

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

    return observedJson(obsUser, { url: session.url });
  } catch (e) {
    observedError(obs, e);
    console.error('Error creating Stripe checkout session', e);
    return observedText(obs, 'Failed to create checkout session', { status: 500 });
  }
}
