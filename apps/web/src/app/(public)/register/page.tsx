"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { trackEventBeforeNavigation } from "@/lib/analytics";
import { getRuntimePlatformInfo } from "@/lib/runtimePlatform";
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
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

function normalizeTrackingSource(raw: string | null): string {
  if (!raw) return "app";
  const normalized = raw.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(normalized)) return "app";
  return normalized;
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
  const nextPath = normalizeNextPath(searchParams.get("next"));
  const trackingSource = normalizeTrackingSource(searchParams.get("source"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runtimeInfo = getRuntimePlatformInfo();

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

  const finalizeRegistration = useCallback(async (params: { method: "email" | "google"; isNewUser: boolean }) => {
    await establishSession();
    if (params.isNewUser) {
      await trackEventBeforeNavigation("sign_up", {
        method: params.method,
        source: trackingSource,
      });
    }
    router.replace(nextPath);
  }, [nextPath, router, trackingSource]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      await finalizeRegistration({ method: "email", isNewUser: true });
    } catch (err) {
      setError(getFirebaseAuthErrorMessage(err));
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
        const isNewUser = getAdditionalUserInfo(result)?.isNewUser === true;
        await finalizeRegistration({ method: "google", isNewUser });
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
  }, [finalizeRegistration]);

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
          const credentialResult = await signInWithCredential(auth, credential);
          const isNewUser = getAdditionalUserInfo(credentialResult)?.isNewUser === true;
          await finalizeRegistration({ method: "google", isNewUser });
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
        const popupResult = await signInWithPopup(auth, provider);
        const isNewUser = getAdditionalUserInfo(popupResult)?.isNewUser === true;
        await finalizeRegistration({ method: "google", isNewUser });
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

        <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex-1 h-px bg-border" />
          <span>ou</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={handleGoogleRegister}
          className="w-full inline-flex items-center justify-center px-4 py-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Connexion..." : "Continuer avec Google"}
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
