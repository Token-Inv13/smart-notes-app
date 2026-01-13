export const metadata = {
  title: "Delete Account – Smart Notes",
};

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-semibold">Delete Account – Smart Notes</h1>

        <div className="mt-8 space-y-6 text-sm leading-6">
          <p>
            You can request deletion of your Smart Notes account and associated data.
          </p>

          <div className="space-y-2">
            <p className="font-medium">How to request deletion</p>
            <p>
              Send an email to:
              <br />
              <a className="underline" href="mailto:contact@tachesnotes.com">
                contact@tachesnotes.com
              </a>
            </p>
            <p>
              Please include the email address linked to your Smart Notes account in your request.
            </p>
          </div>

          <div className="space-y-2">
            <p className="font-medium">What will be deleted</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>User account information</li>
              <li>All notes, tasks, and workspaces</li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="font-medium">What will not be retained</p>
            <p>No user data is kept after deletion.</p>
          </div>

          <div className="space-y-2">
            <p className="font-medium">Deletion timeframe</p>
            <p>Requests are processed within 30 days.</p>
          </div>

          <footer className="pt-6 text-xs text-muted-foreground">
            Smart Notes
          </footer>
        </div>
      </div>
    </div>
  );
}
