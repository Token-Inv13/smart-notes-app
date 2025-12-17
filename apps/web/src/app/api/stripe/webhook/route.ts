import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebaseAdmin';
import admin from 'firebase-admin';

export const runtime = 'nodejs';

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

async function setUserPlan(userId: string, plan: 'free' | 'pro', updates?: Record<string, unknown>) {
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
        const userId = subscription.metadata?.userId as string | undefined;

        if (!userId) break;

        const isActive = subscription.status === 'active' || subscription.status === 'trialing';
        await setUserPlan(userId, isActive ? 'pro' : 'free', {
          stripeCustomerId: (subscription.customer as string) ?? null,
          stripeSubscriptionId: subscription.id,
          stripeSubscriptionStatus: subscription.status,
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

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error('Stripe webhook error', e);
    const message = e instanceof Error ? e.message : 'Webhook handler failed';
    return new NextResponse(message, { status: 500 });
  }
}
