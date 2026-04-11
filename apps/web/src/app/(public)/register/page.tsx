"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { getRuntimePlatformInfo } from "@/lib/runtimePlatform";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { Eye, EyeOff } from "lucide-react";

function getFirebaseAuthErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function normalizeNextPath(raw: string | null): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  const next = raw.trim();
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  return next;
}

function getFirebaseAuthErrorRawMessage(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const message = (err as Record<string, unknown>).message;
  return typeof message === "string" ? message : "";
}

function getFirebaseAuthErrorMessage(err: unknown): string {
  const code = getFirebaseAuthErrorCode(err);
  if (typeof code !== "string") {
    const message = getFirebaseAuthErrorRawMessage(err);
    return message || "Une erreur est survenue. Réessaie.";
  }

  switch (code) {
    case "auth/email-already-in-use":
      return "Cette adresse email est déjà utilisée.";
    case "auth/invalid-email":
      return "Adresse email invalide.";
    case "auth/weak-password":
      return "Mot de passe trop faible (6 caractères minimum).";
    case "auth/popup-closed-by-user":
      return "Inscription annulée.";
    case "auth/popup-blocked":
      return "La popup a été bloquée par le navigateur. Autorise les popups puis réessaie.";
    case "auth/network-request-failed":
      return "Problème réseau. Vérifie ta connexion puis réessaie.";
    default:
      return "Une erreur est survenue. Réessaie.";
  }
}

function isNativeGoogleSignInUnavailable(err: unknown): boolean {
  const code = getFirebaseAuthErrorCode(err)?.toLowerCase();
  if (code === "unimplemented") return true;

  const rawMessage = getFirebaseAuthErrorRawMessage(err).toLowerCase();
  return rawMessage.includes("not implemented on this platform") || rawMessage.includes("unimplemented");
}

function getNativeGoogleSignInUnavailableMessage() {
  return "Inscription Google indisponible dans cette version Android. Termine la configuration Google native Android, ou utilise email + mot de passe pour l’instant.";
}

function getAuthRouteMessage(reason: string | null): string | null {
  if (reason === "session-invalid") {
    return "Ta session a expiré ou est invalide. Reconnecte-toi pour continuer.";
  }
  if (reason === "session-service-unavailable") {
    return "La session serveur Firebase est indisponible. Vérifie la configuration serveur avant de réessayer.";
  }
  if (reason === "auth-required") {
    return "Connecte-toi pour accéder à cette page.";
  }
  return null;
}

async function signOutAfterSessionFailure() {
  await fetch("/api/logout", { method: "POST" }).catch(() => null);
  await signOut(auth).catch(() => null);
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
  const { status: authStatus, user } = useAuth();
  const nextPath = normalizeNextPath(searchParams.get("next"));
  const routeMessage = useMemo(() => getAuthRouteMessage(searchParams.get("reason")), [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveringSession, setRecoveringSession] = useState(false);

  const runtimeInfo = getRuntimePlatformInfo();

  const establishSession = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error("No authenticated user after sign-up");
    }

    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { code?: unknown; error?: unknown } | null;
        const code = typeof payload?.code === "string" ? payload.code : null;
        const apiMessage = typeof payload?.error === "string" ? payload.error : null;

        if (code === "service_unavailable") {
          throw new Error("SESSION_SERVICE_UNAVAILABLE");
        }
        if (code === "invalid_id_token") {
          throw new Error("SESSION_INVALID_ID_TOKEN");
        }

        throw new Error(apiMessage || `SESSION_API_ERROR_${res.status}`);
      }
    } catch (error) {
      await signOutAfterSessionFailure();
      throw error;
    }
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      await establishSession();
      router.replace(nextPath);
    } catch (err) {
      if (err instanceof Error && err.message === "SESSION_SERVICE_UNAVAILABLE") {
        setError("Compte créé côté Firebase, mais session serveur indisponible. Vérifie Firebase Admin.");
      } else if (err instanceof Error && err.message === "SESSION_INVALID_ID_TOKEN") {
        setError("Jeton Firebase invalide ou expiré. Réessaie l’inscription.");
      } else {
        setError(getFirebaseAuthErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await getRedirectResult(auth);
        if (!result || cancelled) return;

        setError(null);
        setLoading(true);
        await establishSession();
        router.replace(nextPath);
      } catch (err) {
        if (cancelled) return;
        const code = getFirebaseAuthErrorCode(err);
        if (code === "auth/no-auth-event") return;
        setError(getFirebaseAuthErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [establishSession, nextPath, router]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !user) return;
    if (loading || recoveringSession) return;

    let cancelled = false;
    setRecoveringSession(true);
    setError(null);

    void (async () => {
      try {
        await establishSession();
        if (!cancelled) {
          router.replace(nextPath);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.message === "SESSION_SERVICE_UNAVAILABLE") {
          setError("Inscription réussie côté Firebase, mais session serveur indisponible. Vérifie Firebase Admin.");
        } else if (err instanceof Error && err.message === "SESSION_INVALID_ID_TOKEN") {
          setError("Session Firebase expirée. Réessaie l’inscription.");
        } else {
          setError("Compte créé côté Firebase, mais impossible d’ouvrir la session serveur.");
        }
      } finally {
        if (!cancelled) {
          setRecoveringSession(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, establishSession, loading, nextPath, recoveringSession, router, user]);

  const handleGoogleRegister = async () => {
    setError(null);
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();

      if (runtimeInfo.isNative) {
        try {
          const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
          const nativeResult = (await FirebaseAuthentication.signInWithGoogle()) as unknown as {
            credential?: { idToken?: string; accessToken?: string };
          };

          const idToken = nativeResult.credential?.idToken;
          const accessToken = nativeResult.credential?.accessToken;
          if (!idToken && !accessToken) {
            throw new Error("Missing Google credential tokens");
          }

          const credential = GoogleAuthProvider.credential(idToken ?? undefined, accessToken ?? undefined);
          await signInWithCredential(auth, credential);
          await establishSession();
          router.replace(nextPath);
          return;
        } catch (err) {
          if (!isNativeGoogleSignInUnavailable(err)) {
            throw err;
          }
          console.warn("[auth/register] native Google sign-in unavailable", err);
          setError(getNativeGoogleSignInUnavailableMessage());
          return;
        }
      }

      try {
        await signInWithPopup(auth, provider);
        await establishSession();
        router.replace(nextPath);
      } catch (err) {
        const code = getFirebaseAuthErrorCode(err) ?? "";
        if (code === "auth/popup-blocked") {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw err;
      }
    } catch (err) {
      setError(getFirebaseAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || recoveringSession;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-md border border-border rounded-lg p-6 shadow-sm bg-card">
        <h1 className="text-xl font-semibold mb-4 text-center">TaskNote</h1>
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
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pr-10 px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                disabled={loading}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {!error && routeMessage && (
            <p className="text-sm text-amber-600 mt-2" aria-live="polite">
              {routeMessage}
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive mt-2" aria-live="polite">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full mt-2 inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Création..." : "Créer mon compte"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex-1 h-px bg-border" />
          <span>ou</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={handleGoogleRegister}
          className="w-full inline-flex items-center justify-center px-4 py-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Connexion…" : "Continuer avec Google"}
        </button>

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
