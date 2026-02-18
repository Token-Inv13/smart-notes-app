import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebaseAdmin';
import { logServerError, logServerWarn } from '@/lib/observability';
import { getStripeModeFromSecret, normalizeStripeId } from '@/lib/stripeUtils';
import { beginApiObserve, observedError, observedJson, observedText } from '@/lib/apiObservability';
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
  return normalizeStripeId(value);
}

function normalizeUserId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    logServerWarn('stripe.webhook.user_missing', { userId, plan });
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
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const obs = beginApiObserve({
    eventName: 'stripe.webhook.post',
    route: '/api/stripe/webhook',
    requestId,
    uid: 'anonymous',
  });

  let lockAcquired = false;
  let lockedEventRef: FirebaseFirestore.DocumentReference | null = null;
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      logServerError('stripe.webhook.service_unavailable', {
        requestId,
        reason: 'missing_stripe_webhook_secret',
      });
      return observedText(obs, 'Configuration du service indisponible.', { status: 500 });
    }

    const stripe = getStripeClient();

    const sig = request.headers.get('stripe-signature');
    if (!sig) return observedText(obs, 'Missing stripe-signature', { status: 400 });

    const payload = await request.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    } catch (err) {
      logServerError('stripe.webhook.invalid_signature', { requestId, error: err });
      return observedText(obs, 'Invalid signature', { status: 400 });
    }

    const stripeMode = getStripeModeFromSecret(process.env.STRIPE_SECRET_KEY);
    if (stripeMode !== 'unknown') {
      const eventMode = event.livemode ? 'live' : 'test';
      if (eventMode !== stripeMode) {
        logServerWarn('stripe.webhook.mode_mismatch', {
          requestId,
          eventId: event.id,
          eventType: event.type,
          eventMode,
          stripeMode,
        });
        return observedJson(obs, { received: true, ignored: true, reason: 'mode_mismatch' });
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
        return observedJson(obs, { received: true, deduped: true });
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
          logServerError('stripe.webhook.user_unresolved', {
            requestId,
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

    return observedJson(obs, { received: true });
  } catch (e) {
    observedError(obs, e);
    if (lockAcquired && lockedEventRef) {
      try {
        await lockedEventRef.delete();
      } catch {
        // ignore cleanup failure
      }
    }
    logServerError('stripe.webhook.failure', { requestId, error: e });
    return observedText(obs, 'Webhook handler failed', { status: 500 });
  }
}
