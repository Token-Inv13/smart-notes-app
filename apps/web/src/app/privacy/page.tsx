import Link from "next/link";

export const metadata = {
  title: "Privacy Policy - TaskNote",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-semibold">Privacy Policy - TaskNote</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: January 13, 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-6">
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Overview</h2>
            <p>
              TaskNote is a productivity app that helps you manage notes, tasks, and folders/workspaces.
              This Privacy Policy explains what data we collect, why we collect it, and the choices you have.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Data We Collect</h2>
            <p>We only collect data needed to provide and improve the service:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <span className="font-medium">Email address</span> (for account creation and authentication).
              </li>
              <li>
                <span className="font-medium">User content</span> (notes, tasks, and folders/workspaces you create).
              </li>
              <li>
                <span className="font-medium">Subscription status</span> (free or premium) to enable premium features.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Why We Use This Data</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <span className="font-medium">Authentication</span>: to sign you in and secure your account.
              </li>
              <li>
                <span className="font-medium">Multi-device sync</span>: to keep your notes and tasks available across devices.
              </li>
              <li>
                <span className="font-medium">Premium access</span>: to unlock premium functionality when you subscribe.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Payments</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <span className="font-medium">Web</span>: payments are processed by Stripe.
              </li>
              <li>
                <span className="font-medium">Android</span>: payments are processed by Google Play Billing.
              </li>
              <li>
                TaskNote does not store your payment card details. Payment information is handled by Stripe or Google Play.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Where Your Data Is Stored</h2>
            <p>
              TaskNote stores data in Firebase (Google Cloud). This includes authentication data and the content you create
              in the app.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Data Sharing</h2>
            <p>
              We do not sell your personal data. We do not share your data with third parties for advertising.
              Data is only processed by service providers required to operate the app (such as Firebase and payment processors).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Your Rights (Basic GDPR)</h2>
            <p>
              You can request deletion of your account and associated content. We will delete your data within a reasonable
              timeframe, unless we must keep certain information to comply with legal obligations.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Contact</h2>
            <p>
              If you have questions or want to request data deletion, contact us at:
              <br />
              <a className="underline" href="mailto:demande-service@tasknote.io">
                demande-service@tasknote.io
              </a>
            </p>
          </section>

          <section className="space-y-2 border-t border-border pt-6">
            <h2 className="text-base font-semibold">Useful links</h2>
            <p>Learn more about TaskNote and create an account:</p>
            <div className="flex flex-wrap gap-4">
              <Link href="/get-started" className="underline">
                TaskNote notes, tasks and reminders
              </Link>
              <Link href="/register" className="underline">
                Create a TaskNote account
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
