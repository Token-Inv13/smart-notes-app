import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebaseAdmin';
import admin from 'firebase-admin';
import type { UserDoc } from '@/types/firestore';

export const runtime = 'nodejs';

const STRIPE_EVENTS_COLLECTION = 'stripeWebhookEvents';

function getStripeModeFromSecret(): 'live' | 'test' | 'unknown' {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (secretKey.startsWith('sk_live_')) return 'live';
  if (secretKey.startsWith('sk_test_')) return 'test';
  return 'unknown';
}

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

function normalizeUserId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStripeId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string') {
      const trimmed = id.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

async function resolveUserIdFromStripeIds(params: {
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
}): Promise<string | null> {
  const db = getAdminDb();
  const stripeSubscriptionId = normalizeStripeId(params.stripeSubscriptionId);
  const stripeCustomerId = normalizeStripeId(params.stripeCustomerId);

  if (stripeSubscriptionId) {
    const snap = await db
      .collection('users')
      .where('stripeSubscriptionId', '==', stripeSubscriptionId)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (doc) return doc.id;
  }

  if (stripeCustomerId) {
    const snap = await db
      .collection('users')
      .where('stripeCustomerId', '==', stripeCustomerId)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (doc) return doc.id;
  }

  return null;
}

async function setUserPlan(userId: string, plan: 'free' | 'pro', updates?: Partial<UserDoc>): Promise<boolean> {
  const db = getAdminDb();
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    console.warn('Stripe webhook: target user does not exist, skipping plan mutation', { userId, plan });
    return false;
  }

  await userRef
    .set(
      {
        plan,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(updates ?? {}),
      },
      { merge: true },
    );

  return true;
}

export async function POST(request: Request) {
  let lockAcquired = false;
  let lockedEventRef: FirebaseFirestore.DocumentReference | null = null;
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

    const stripeMode = getStripeModeFromSecret();
    if (stripeMode !== 'unknown') {
      const eventMode = event.livemode ? 'live' : 'test';
      if (eventMode !== stripeMode) {
        console.warn('Stripe webhook ignored due to mode mismatch', {
          eventId: event.id,
          eventType: event.type,
          eventMode,
          stripeMode,
        });
        return NextResponse.json({ received: true, ignored: true, reason: 'mode_mismatch' });
      }
    }

    const db = getAdminDb();
    const eventRef = db.collection(STRIPE_EVENTS_COLLECTION).doc(event.id);
    lockedEventRef = eventRef;

    const nowMs = Date.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(nowMs + 90 * 24 * 60 * 60 * 1000);

    try {
      await eventRef.create({
        eventId: event.id,
        type: event.type,
        livemode: event.livemode === true,
        status: 'processing',
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt,
      });
      lockAcquired = true;
    } catch (e) {
      const code = typeof (e as { code?: unknown })?.code === 'number' ? (e as { code?: number }).code : null;
      if (code === 6) {
        return NextResponse.json({ received: true, deduped: true });
      }
      throw e;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = normalizeUserId(session.metadata?.userId ?? session.client_reference_id);
        const subscriptionId = normalizeStripeId(session.subscription);
        const customerId = normalizeStripeId(session.customer);

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

        const userIdFromMetadata = normalizeUserId(subscription.metadata?.userId);
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
        status: 'processed',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ received: true });
  } catch (e) {
    if (lockAcquired && lockedEventRef) {
      try {
        await lockedEventRef.delete();
      } catch {
        // ignore cleanup failure
      }
    }
    console.error('Stripe webhook error', e);
    return new NextResponse('Webhook handler failed', { status: 500 });
  }
}
