export default function AccessDeniedPage() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4">
      <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-xl font-semibold">Accès refusé</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cette page est réservée à l&apos;administrateur SmartNote.
        </p>
        <a
          href="/dashboard"
          className="mt-5 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Retour au dashboard
        </a>
      </section>
    </main>
  );
}
