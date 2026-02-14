import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebaseAdmin';
import admin from 'firebase-admin';
import type { UserDoc } from '@/types/firestore';

export const runtime = 'nodejs';

const STRIPE_EVENTS_COLLECTION = 'stripeWebhookEvents';

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

function getCustomerId(value: Stripe.Subscription['customer']): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }
  return null;
}

async function resolveUserIdFromStripeIds(params: {
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
}): Promise<string | null> {
  const db = getAdminDb();

  if (params.stripeSubscriptionId) {
    const snap = await db
      .collection('users')
      .where('stripeSubscriptionId', '==', params.stripeSubscriptionId)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (doc) return doc.id;
  }

  if (params.stripeCustomerId) {
    const snap = await db
      .collection('users')
      .where('stripeCustomerId', '==', params.stripeCustomerId)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (doc) return doc.id;
  }

  return null;
}

async function setUserPlan(userId: string, plan: 'free' | 'pro', updates?: Partial<UserDoc>) {
  const db = getAdminDb();
  await db
    .collection('users')
    .doc(userId)
    .set(
      {
        plan,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(updates ?? {}),
      },
      { merge: true },
    );
}

export async function POST(request: Request) {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) return new NextResponse('Missing STRIPE_WEBHOOK_SECRET', { status: 500 });

    const stripe = getStripeClient();

    const sig = request.headers.get('stripe-signature');
    if (!sig) return new NextResponse('Missing stripe-signature', { status: 400 });

    const payload = await request.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    } catch (err) {
      console.error('Stripe webhook signature verification failed', err);
      return new NextResponse('Invalid signature', { status: 400 });
    }

    const db = getAdminDb();
    const eventRef = db.collection(STRIPE_EVENTS_COLLECTION).doc(event.id);
    const existingEvent = await eventRef.get();
    if (existingEvent.exists) {
      return NextResponse.json({ received: true, deduped: true });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = (session.metadata?.userId || session.client_reference_id) as string | undefined;
        const subscriptionId = session.subscription as string | null;
        const customerId = session.customer as string | null;

        if (!userId) break;

        await setUserPlan(userId, 'pro', {
          stripeCustomerId: customerId ?? null,
          stripeSubscriptionId: subscriptionId ?? null,
        });
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const stripeCustomerId = getCustomerId(subscription.customer);

        const userIdFromMetadata = subscription.metadata?.userId as string | undefined;
        const userId =
          userIdFromMetadata ??
          (await resolveUserIdFromStripeIds({ stripeSubscriptionId: subscription.id, stripeCustomerId }));

        if (!userId) {
          console.error('Stripe webhook: unable to resolve userId for subscription event', {
            type: event.type,
            subscriptionId: subscription.id,
            stripeCustomerId,
            status: subscription.status,
          });
          break;
        }

        const isActive = subscription.status === 'active' || subscription.status === 'trialing';
        await setUserPlan(userId, isActive ? 'pro' : 'free', {
          stripeCustomerId: stripeCustomerId ?? null,
          stripeSubscriptionId: subscription.id,
          stripeSubscriptionStatus: subscription.status,
          stripeSubscriptionCancelAtPeriodEnd: subscription.cancel_at_period_end ?? null,
          stripeSubscriptionCurrentPeriodEnd: subscription.current_period_end
            ? admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000)
            : null,
        });
        break;
      }

      case 'invoice.payment_failed':
      case 'invoice.payment_action_required': {
        // Keep it conservative: if the subscription becomes non-active, customer.subscription.updated will set free.
        break;
      }

      default:
        break;
    }

    await eventRef.set(
      {
        eventId: event.id,
        type: event.type,
        livemode: event.livemode === true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: false },
    );

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error('Stripe webhook error', e);
    const message = e instanceof Error ? e.message : 'Webhook handler failed';
    return new NextResponse(message, { status: 500 });
  }
}
