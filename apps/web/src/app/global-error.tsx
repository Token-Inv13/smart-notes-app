"use client";

import { useEffect } from "react";
import { captureClientError } from "@/lib/clientObservability";

export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  const { error, reset } = props;

  useEffect(() => {
    void captureClientError({
      eventName: "frontend.react_error_boundary",
      kind: "react_error_boundary",
      message: error.message,
      stack: error.stack,
      meta: {
        digest: error.digest ?? null,
      },
    });
  }, [error]);

  return (
    <html lang="fr">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-xl font-semibold">Une erreur inattendue est survenue.</h1>
          <p className="text-sm text-muted-foreground">
            L’équipe a été notifiée. Tu peux réessayer, ou revenir à l’accueil.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Réessayer
            </button>
            <a href="/" className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700">
              Accueil
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
