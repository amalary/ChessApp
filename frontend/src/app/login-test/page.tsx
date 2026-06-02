"use client";

import React, { useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { writeActiveLocalAuthUser } from "@/lib/dashboard-theme-settings";

function subscribe() {
  return () => {};
}

type AuthMode = "login" | "signup";
type LocalAuthUser = {
  id: string;
  username: string;
  email: string;
  sessionToken: string;
};

type LocalAuthSuccessPayload = {
  message?: unknown;
  user?: unknown;
  local_session_token?: unknown;
  localSessionToken?: unknown;
  session_token?: unknown;
  sessionToken?: unknown;
  detail?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
};

function sanitizeReturnTo(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  return trimmed;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const candidate = payload as LocalAuthSuccessPayload & Record<string, unknown>;
  if (
    candidate.error &&
    typeof candidate.error === "object" &&
    typeof candidate.error.message === "string" &&
    candidate.error.message.trim()
  ) {
    return candidate.error.message.trim();
  }
  if (candidate.detail && typeof candidate.detail === "object") {
    const detailRecord = candidate.detail as { message?: unknown };
    if (
      typeof detailRecord.message === "string" &&
      detailRecord.message.trim()
    ) {
      return detailRecord.message.trim();
    }
  }
  if (typeof candidate.detail === "string" && candidate.detail.trim()) {
    return candidate.detail.trim();
  }
  if (typeof candidate.message === "string" && candidate.message.trim()) {
    return candidate.message.trim();
  }
  return fallback;
}

function parseLocalAuthUser(payload: LocalAuthSuccessPayload): LocalAuthUser | null {
  if (!payload.user || typeof payload.user !== "object") {
    return null;
  }

  const candidate = payload.user as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const username =
    typeof candidate.username === "string" ? candidate.username.trim() : "";
  const email = typeof candidate.email === "string" ? candidate.email.trim() : "";

  const tokenCandidates = [
    payload.local_session_token,
    payload.localSessionToken,
    payload.session_token,
    payload.sessionToken,
  ];
  const sessionToken = tokenCandidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  )?.trim();

  if (!id || !username || !email || !sessionToken) {
    return null;
  }

  return { id, username, email, sessionToken };
}

function LoginTestPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  const initialModeParam = searchParams?.get("mode");
  const initialMode: AuthMode = initialModeParam === "signup" ? "signup" : "login";
  const returnTo = sanitizeReturnTo(searchParams?.get("returnTo") ?? null) ?? "/solve-test";

  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const callbackErrorDescription = searchParams?.get("auth_error_description");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const formData = new FormData(event.currentTarget);
    const identifier = String(formData.get("identifier") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!identifier) {
      setErrorMessage("Username or email is required.");
      return;
    }

    if (!password) {
      setErrorMessage("Password is required.");
      return;
    }

    if (authMode === "signup") {
      const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailLooksValid) {
        setErrorMessage("Please enter a valid email address.");
        return;
      }

      if (password.length < 8) {
        setErrorMessage("Password must be at least 8 characters.");
        return;
      }

      const hasLetter = /[a-zA-Z]/.test(password);
      const hasNumber = /\d/.test(password);
      if (!hasLetter || !hasNumber) {
        setErrorMessage("Password must include at least one letter and one number.");
        return;
      }

      if (password !== confirmPassword) {
        setErrorMessage("Passwords do not match.");
        return;
      }
    }

    setIsSubmitting(true);
    setStatusMessage(
      authMode === "signup" ? "Creating your account..." : "Signing you in...",
    );

    try {
      const endpoint =
        authMode === "signup" ? "/api/local-auth/signup" : "/api/local-auth/login";
      const requestBody =
        authMode === "signup"
          ? { username: identifier, email, password }
          : { identifier, username: identifier, password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      let payload: LocalAuthSuccessPayload = {};
      try {
        payload = (await response.json()) as LocalAuthSuccessPayload;
      } catch {
        payload = {};
      }

      if (!response.ok) {
        setErrorMessage(
          extractErrorMessage(payload, `Authentication failed (${response.status}).`),
        );
        setStatusMessage(null);
        return;
      }

      const authenticatedUser = parseLocalAuthUser(payload);
      if (!authenticatedUser) {
        setErrorMessage("Authentication succeeded but user details were missing.");
        setStatusMessage(null);
        return;
      }

      writeActiveLocalAuthUser(authenticatedUser);
      setStatusMessage(
        authMode === "signup"
          ? "Account created. Redirecting..."
          : "Signed in. Redirecting...",
      );
      const target = returnTo;
      router.replace(target);
      window.setTimeout(() => {
        window.location.assign(target);
      }, 120);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to reach the authentication service.";
      setErrorMessage(message);
      setStatusMessage(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!mounted) {
    return <main className="min-h-screen w-full" />;
  }

  return (
    <main className="min-h-screen w-full bg-slate-100 flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">ChessApp</h1>
          <p className="mt-1 text-sm text-slate-600">
            {authMode === "signup" ? "Create your account" : "Sign in to your account"}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="identifier" className="text-sm font-medium text-slate-700">
              {authMode === "signup" ? "Username" : "Username or Email"}
            </label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              required
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
              placeholder={authMode === "signup" ? "chessplayer" : "chessplayer or you@example.com"}
            />
          </div>

          {authMode === "signup" && (
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
              placeholder="you@example.com"
            />
          </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={authMode === "signup" ? "new-password" : "current-password"}
              required
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
              placeholder={authMode === "signup" ? "Create a password" : "Enter your password"}
            />
          </div>

          {authMode === "signup" && (
            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="text-sm font-medium text-slate-700">
                Confirm password
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
                placeholder="Re-enter your password"
              />
            </div>
          )}

          {errorMessage && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {errorMessage}
            </p>
          )}

          {callbackErrorDescription && !errorMessage && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {callbackErrorDescription}
            </p>
          )}

          {statusMessage && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              {statusMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="h-11 w-full rounded-md bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting
              ? "Continuing..."
              : authMode === "signup"
                ? "Create Account"
                : "Sign In"}
          </button>

          <p className="pt-1 text-center text-sm text-slate-600">
            {authMode === "signup" ? "Already have an account?" : "Need an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setAuthMode((prev) => (prev === "login" ? "signup" : "login"));
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              disabled={isSubmitting}
              className="font-semibold text-blue-600 hover:text-blue-700"
            >
              {authMode === "signup" ? "Sign in" : "Sign up"}
            </button>
          </p>
        </form>
      </section>
    </main>
  );
}

export default function LoginTestPage() {
  return (
    <React.Suspense fallback={<main className="min-h-screen w-full" />}>
      <LoginTestPageContent />
    </React.Suspense>
  );
}
