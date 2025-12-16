"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { createUserWithEmailAndPassword } from "firebase/auth";

function getFirebaseAuthErrorMessage(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? (err as any).code : undefined;
  if (typeof code !== "string") {
    const message = typeof err === "object" && err && "message" in err ? String((err as any).message) : "";
    return message || "Une erreur est survenue. Réessaie.";
  }

  switch (code) {
    case "auth/email-already-in-use":
      return "Cette adresse email est déjà utilisée.";
    case "auth/invalid-email":
      return "Adresse email invalide.";
    case "auth/weak-password":
      return "Mot de passe trop faible (6 caractères minimum).";
    case "auth/network-request-failed":
      return "Problème réseau. Vérifie ta connexion puis réessaie.";
    default:
      return "Une erreur est survenue. Réessaie.";
  }
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterPageInner />
    </Suspense>
  );
}

function RegisterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const establishSession = async () => {
    const user = auth.currentUser;
    if (!user) {
      throw new Error("No authenticated user after sign-up");
    }

    const idToken = await user.getIdToken();
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to establish session");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      await establishSession();
      router.replace(nextPath);
    } catch (err: any) {
      setError(getFirebaseAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-md border border-border rounded-lg p-6 shadow-sm bg-card">
        <h1 className="text-xl font-semibold mb-4 text-center">Smart Notes</h1>
        <p className="text-sm text-muted-foreground mb-6 text-center">
          Crée un compte pour accéder à tes notes et tâches.
        </p>

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive mt-2" aria-live="polite">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Création..." : "Créer mon compte"}
          </button>
        </form>

        <p className="text-xs text-muted-foreground mt-4 text-center">
          Déjà un compte ?{" "}
          <a className="underline" href={`/login?next=${encodeURIComponent(nextPath)}`}>
            Se connecter
          </a>
        </p>
      </div>
    </div>
  );
}
