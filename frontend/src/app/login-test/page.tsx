"use client";

import React, { useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Crown } from "lucide-react";
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
  const sessionToken =
    typeof payload.local_session_token === "string"
      ? payload.local_session_token.trim()
      : "";

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

  const callbackError = searchParams?.get("auth_error");

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
    <main className="flex min-h-screen w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_100%,rgba(211,201,255,0.95),transparent_34%),linear-gradient(132deg,#1678d6_0%,#7159f6_47%,#b62df4_100%)] px-4 py-10">
      <section className="w-full max-w-[440px] overflow-hidden rounded-[22px] border border-white/55 bg-[#f7f5ff]/90 text-slate-950 shadow-[0_22px_50px_rgba(36,25,116,0.31),inset_9px_9px_22px_rgba(255,255,255,0.9),inset_-9px_-9px_24px_rgba(120,111,190,0.12)] backdrop-blur-xl">
        <header className="relative flex min-h-24 flex-col items-center justify-center gap-3 border-b border-white/70 px-6 py-5 shadow-[inset_0_-1px_0_rgba(105,101,150,0.13)] sm:px-8">
          <div className="flex size-12 items-center justify-center rounded-full bg-[#eef2ff] text-sky-500 shadow-[7px_7px_18px_rgba(84,91,148,0.18),-8px_-8px_18px_rgba(255,255,255,0.95),inset_4px_4px_10px_rgba(255,255,255,0.8),inset_-4px_-4px_10px_rgba(120,139,205,0.12)] sm:absolute sm:left-7 sm:top-1/2 sm:size-14 sm:-translate-y-1/2">
            <Crown aria-hidden="true" className="size-7" strokeWidth={2.2} />
          </div>
          <div className="text-center">
            <p className="mb-1 text-xs font-semibold tracking-[0.18em] text-slate-400 uppercase">
              Terrible App Chess
            </p>
            <h1 className="text-3xl font-bold text-[#101535]">
              {authMode === "signup" ? "Signup" : "Login"}
            </h1>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 px-7 py-6 sm:px-10">
          <div className="space-y-1.5">
            <label htmlFor="identifier" className="sr-only">
              {authMode === "signup" ? "Username" : "Username or Email"}
            </label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              required
              className="h-13 w-full rounded-full border border-white/70 bg-[#f8f7ff]/75 px-7 text-lg text-[#151b3b] outline-none shadow-[inset_8px_8px_16px_rgba(106,116,174,0.17),inset_-9px_-9px_18px_rgba(255,255,255,0.96)] transition placeholder:text-[#8d94b1] focus:border-sky-300 focus:ring-4 focus:ring-sky-300/25"
              placeholder={authMode === "signup" ? "Username" : "Username"}
            />
          </div>

          {authMode === "signup" && (
          <div className="space-y-1.5">
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-13 w-full rounded-full border border-white/70 bg-[#f8f7ff]/75 px-7 text-lg text-[#151b3b] outline-none shadow-[inset_8px_8px_16px_rgba(106,116,174,0.17),inset_-9px_-9px_18px_rgba(255,255,255,0.96)] transition placeholder:text-[#8d94b1] focus:border-sky-300 focus:ring-4 focus:ring-sky-300/25"
              placeholder="Email"
            />
          </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={authMode === "signup" ? "new-password" : "current-password"}
              required
              className="h-13 w-full rounded-full border border-white/70 bg-[#f8f7ff]/75 px-7 text-lg text-[#151b3b] outline-none shadow-[inset_8px_8px_16px_rgba(106,116,174,0.17),inset_-9px_-9px_18px_rgba(255,255,255,0.96)] transition placeholder:text-[#8d94b1] focus:border-sky-300 focus:ring-4 focus:ring-sky-300/25"
              placeholder="Password"
            />
          </div>

          {authMode === "signup" && (
            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="sr-only">
                Confirm password
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className="h-13 w-full rounded-full border border-white/70 bg-[#f8f7ff]/75 px-7 text-lg text-[#151b3b] outline-none shadow-[inset_8px_8px_16px_rgba(106,116,174,0.17),inset_-9px_-9px_18px_rgba(255,255,255,0.96)] transition placeholder:text-[#8d94b1] focus:border-sky-300 focus:ring-4 focus:ring-sky-300/25"
                placeholder="Confirm Password"
              />
            </div>
          )}

          {authMode === "login" && (
            <div className="-mt-1 px-2 text-left">
              <button
                type="button"
                className="text-base font-medium text-[#878eac] transition hover:text-sky-500"
              >
                Forgot Password?
              </button>
            </div>
          )}

          {errorMessage && (
            <p className="rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </p>
          )}

          {callbackError && !errorMessage && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-700">
              Authentication callback failed. Please try signing in again.
            </p>
          )}

          {statusMessage && (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-700">
              {statusMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="h-13 w-full rounded-full bg-gradient-to-r from-sky-400 to-blue-600 text-xl font-bold text-white shadow-[0_12px_20px_rgba(41,105,217,0.32),inset_0_-4px_0_rgba(29,78,216,0.36),inset_0_3px_0_rgba(255,255,255,0.22)] transition hover:brightness-105 focus:outline-none focus:ring-4 focus:ring-sky-300/35 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting
              ? "Continuing..."
              : authMode === "signup"
                ? "Signup"
                : "Login"}
          </button>

          <p className="pt-1 text-center text-lg text-[#737b9f]">
            {authMode === "signup" ? "Already a member?" : "Not a member?"}{" "}
            <button
              type="button"
              onClick={() => {
                setAuthMode((prev) => (prev === "login" ? "signup" : "login"));
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              disabled={isSubmitting}
              className="font-medium text-blue-500 hover:text-blue-600"
            >
              {authMode === "signup" ? "Login" : "Signup"}
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
