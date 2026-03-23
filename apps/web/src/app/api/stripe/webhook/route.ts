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

function isActiveSubscriptionStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing';
}

function subscriptionStatusFields(subscription: Stripe.Subscription): Partial<UserDoc> {
  return {
    stripeCustomerId: getCustomerId(subscription.customer) ?? null,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeSubscriptionCancelAtPeriodEnd: subscription.cancel_at_period_end ?? null,
    stripeSubscriptionCurrentPeriodEnd: subscription.current_period_end
      ? admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000)
      : null,
  };
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

async function updateUserStripeContext(userId: string, updates: Partial<UserDoc>): Promise<boolean> {
  const db = getAdminDb();
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    logServerWarn('stripe.webhook.user_missing', { userId, updates: Object.keys(updates) });
    return false;
  }

  await userRef.set(
    {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(updates ?? {}),
    },
    { merge: true },
  );

  return true;
}

async function resolveUserIdForSubscription(subscription: Stripe.Subscription): Promise<string | null> {
  const stripeCustomerId = getCustomerId(subscription.customer);
  const userIdFromMetadata = normalizeUserId(subscription.metadata?.userId);
  return (
    userIdFromMetadata ??
    (await resolveUserIdFromStripeIds({ stripeSubscriptionId: subscription.id, stripeCustomerId }))
  );
}

async function applySubscriptionToUser(userId: string, subscription: Stripe.Subscription): Promise<boolean> {
  const isActive = isActiveSubscriptionStatus(subscription.status);
  return setUserPlan(userId, isActive ? 'pro' : 'free', subscriptionStatusFields(subscription));
}

async function syncSubscriptionById(params: {
  stripe: Stripe;
  subscriptionId: string;
  userId?: string | null;
  customerId?: string | null;
}): Promise<boolean> {
  const subscription = await params.stripe.subscriptions.retrieve(params.subscriptionId);
  const userId =
    normalizeUserId(params.userId) ??
    (await resolveUserIdForSubscription(subscription)) ??
    (await resolveUserIdFromStripeIds({
      stripeSubscriptionId: params.subscriptionId,
      stripeCustomerId: params.customerId,
    }));

  if (!userId) {
    logServerError('stripe.webhook.user_unresolved', {
      type: 'subscription_sync',
      subscriptionId: params.subscriptionId,
      stripeCustomerId: params.customerId ?? null,
      status: subscription.status,
    });
    return false;
  }

  return applySubscriptionToUser(userId, subscription);
}

async function markInvoiceState(params: {
  userId: string;
  invoice: Stripe.Invoice;
  eventType: string;
}): Promise<boolean> {
  const hostedInvoiceUrl =
    typeof params.invoice.hosted_invoice_url === 'string' ? params.invoice.hosted_invoice_url : null;
  const invoiceStatus = typeof params.invoice.status === 'string' ? params.invoice.status : null;
  const amountDue = typeof params.invoice.amount_due === 'number' ? params.invoice.amount_due : null;
  const amountPaid = typeof params.invoice.amount_paid === 'number' ? params.invoice.amount_paid : null;

  return updateUserStripeContext(params.userId, {
    stripeLastInvoiceEventType: params.eventType,
    stripeLastInvoiceId: params.invoice.id,
    stripeLastInvoiceStatus: invoiceStatus,
    stripeLastInvoiceHostedUrl: hostedInvoiceUrl,
    stripeLastInvoiceAmountDue: amountDue,
    stripeLastInvoiceAmountPaid: amountPaid,
    stripeLastInvoiceUpdatedAt: admin.firestore.FieldValue.serverTimestamp() as unknown as UserDoc['updatedAt'],
    ...(params.eventType === 'invoice.payment_failed'
      ? {
          stripeLastPaymentFailureAt: admin.firestore.FieldValue.serverTimestamp() as unknown as UserDoc['updatedAt'],
        }
      : {}),
  });
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
        processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt,
      });
      lockAcquired = true;
    } catch (e) {
      const code = typeof (e as { code?: unknown })?.code === 'number' ? (e as { code?: number }).code : null;
      if (code === 6) {
        const existingSnap = await eventRef.get();
        const existingStatus = existingSnap.exists ? String(existingSnap.data()?.status ?? '') : '';
        if (existingStatus === 'failed') {
          await eventRef.set(
            {
              status: 'processing',
              retryRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
              processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
              lastErrorAt: admin.firestore.FieldValue.delete(),
              lastErrorMessage: admin.firestore.FieldValue.delete(),
            },
            { merge: true },
          );
          lockAcquired = true;
        } else {
          return observedJson(obs, { received: true, deduped: true });
        }
      } else {
        throw e;
      }
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = normalizeUserId(session.metadata?.userId ?? session.client_reference_id);
        const subscriptionId = normalizeStripeId(session.subscription);
        const customerId = normalizeStripeId(session.customer);

        if (!userId) break;

        await updateUserStripeContext(userId, {
          stripeCustomerId: customerId ?? null,
          stripeSubscriptionId: subscriptionId ?? null,
          stripeCheckoutLastCompletedAt: admin.firestore.FieldValue.serverTimestamp() as unknown as UserDoc['updatedAt'],
          stripeCheckoutLastEventType: event.type,
        });
        break;
      }

      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = normalizeUserId(session.metadata?.userId ?? session.client_reference_id);
        const subscriptionId = normalizeStripeId(session.subscription);
        const customerId = normalizeStripeId(session.customer);

        if (userId) {
          await updateUserStripeContext(userId, {
            stripeCustomerId: customerId ?? null,
            stripeSubscriptionId: subscriptionId ?? null,
            stripeCheckoutLastAsyncEventType: event.type,
            stripeCheckoutLastAsyncAt: admin.firestore.FieldValue.serverTimestamp() as unknown as UserDoc['updatedAt'],
          });
        }

        if (subscriptionId) {
          await syncSubscriptionById({ stripe, subscriptionId, userId, customerId });
        }
        break;
      }

      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = normalizeUserId(session.metadata?.userId ?? session.client_reference_id);
        const subscriptionId = normalizeStripeId(session.subscription);
        const customerId = normalizeStripeId(session.customer);

        if (userId) {
          await updateUserStripeContext(userId, {
            stripeCustomerId: customerId ?? null,
            stripeSubscriptionId: subscriptionId ?? null,
            stripeCheckoutLastAsyncEventType: event.type,
            stripeCheckoutLastAsyncAt: admin.firestore.FieldValue.serverTimestamp() as unknown as UserDoc['updatedAt'],
            stripeLastPaymentFailureAt: admin.firestore.FieldValue.serverTimestamp() as unknown as UserDoc['updatedAt'],
          });
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const stripeCustomerId = getCustomerId(subscription.customer);
        const userId = await resolveUserIdForSubscription(subscription);

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

        await applySubscriptionToUser(userId, subscription);
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = normalizeStripeId(invoice.subscription);
        const customerId = normalizeStripeId(invoice.customer);
        const userId = await resolveUserIdFromStripeIds({
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: customerId,
        });

        if (userId) {
          await markInvoiceState({ userId, invoice, eventType: event.type });
        }

        if (subscriptionId) {
          await syncSubscriptionById({ stripe, subscriptionId, userId, customerId });
        }
        break;
      }

      case 'invoice.payment_failed':
      case 'invoice.payment_action_required': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = normalizeStripeId(invoice.subscription);
        const customerId = normalizeStripeId(invoice.customer);
        const userId = await resolveUserIdFromStripeIds({
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: customerId,
        });

        if (userId) {
          await markInvoiceState({ userId, invoice, eventType: event.type });
        }
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
        await lockedEventRef.set(
          {
            status: 'failed',
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
            lastErrorMessage: e instanceof Error ? e.message.slice(0, 1000) : 'unknown_error',
          },
          { merge: true },
        );
      } catch {
        // ignore cleanup failure
      }
    }
    logServerError('stripe.webhook.failure', { requestId, error: e });
    return observedText(obs, 'Webhook handler failed', { status: 500 });
  }
}
