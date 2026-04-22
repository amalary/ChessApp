"use client";

import React, { useState, useSyncExternalStore } from "react";
import { Castle } from "lucide-react";
import SolveTestClient from "../solve-test/solve-test-client";

function subscribe() {
  return () => {};
}

const AUTH_REQUEST_TIMEOUT_MS = 15000;

type AuthMode = "login" | "signup";

type AuthApiResponse = {
  message?: unknown;
  detail?: unknown;
  user?: {
    username?: unknown;
  };
};

function parseMessage(data: AuthApiResponse, fallback: string): string {
  if (Array.isArray(data.detail) && data.detail.length > 0) {
    const first = data.detail[0] as { msg?: unknown };
    if (typeof first?.msg === "string" && first.msg.trim()) {
      return first.msg.trim();
    }
  }
  if (typeof data.detail === "string" && data.detail.trim()) {
    return data.detail.trim();
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  return fallback;
}

export default function LoginTestPage() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();
    const confirmPassword = String(formData.get("confirmPassword") ?? "").trim();

    if (!username || !password) {
      setErrorMessage("Username and password are required.");
      return;
    }

    if (authMode === "signup") {
      if (!email) {
        setErrorMessage("Email is required for sign up.");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage("Passwords do not match.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const endpoint =
        authMode === "signup" ? "/api/local-auth/signup" : "/api/local-auth/login";
      const payload =
        authMode === "signup"
          ? { username, email, password }
          : { username, password };

      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        AUTH_REQUEST_TIMEOUT_MS,
      );
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      let data: AuthApiResponse = {};
      try {
        data = (await response.json()) as AuthApiResponse;
      } catch {
        data = {};
      }

      if (!response.ok) {
        setErrorMessage(parseMessage(data, "Authentication failed."));
        return;
      }

      const apiMessage = parseMessage(
        data,
        authMode === "signup" ? "Signup successful." : "Login successful.",
      );
      setStatusMessage(apiMessage);
      setIsLoggedIn(true);
    } catch (error: unknown) {
      const raw = error instanceof Error ? error.message : "Network error";
      const message = raw.toLowerCase().includes("abort")
        ? "Login request timed out. Backend is likely down or blocked. Please retry after confirming backend/proxy are running."
        : raw.toLowerCase().includes("failed to fetch")
        ? "Unable to reach auth service. Confirm frontend is running on localhost:3001 and backend is running on 127.0.0.1:8010."
        : raw;
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!mounted) {
    return <main className="min-h-screen w-full" />;
  }

  if (isLoggedIn) {
    return <SolveTestClient />;
  }

  return (
    <main className="min-h-screen w-full flex items-center justify-center p-6
      bg-[radial-gradient(1000px_circle_at_20%_20%,#4f8dff_0%,transparent_55%),
          radial-gradient(900px_circle_at_80%_20%,#8a5bff_0%,transparent_55%),
          radial-gradient(900px_circle_at_50%_90%,#b35cff_0%,transparent_55%),
          linear-gradient(135deg,#3b82f6_0%,#7c3aed_55%,#a855f7_100%)]"
    >
      <div className="relative w-full max-w-md">
        {/* glow */}
        <div className="absolute -inset-6 rounded-[2.25rem] blur-2xl opacity-40 bg-white/20" />

        <section className="relative rounded-[2rem] bg-white/70 backdrop-blur-xl
          border border-white/60
          shadow-[0_30px_80px_rgba(0,0,0,0.25)] overflow-hidden"
        >
          {/* Header */}
          <div className="px-10 pt-9 pb-6 bg-white/55 border-b border-white/60">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-white/70 flex items-center justify-center
                shadow-[inset_8px_8px_16px_rgba(0,0,0,0.08),
                        inset_-8px_-8px_16px_rgba(255,255,255,0.9),
                        0_10px_25px_rgba(0,0,0,0.08)]"
              >
                <Castle className="h-6 w-6 text-slate-500" />
              </div>

              <h1 className="text-3xl font-semibold text-slate-800">
                Terrible App Chess Login
              </h1>
            </div>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="px-10 py-8 space-y-5">
            <NeumoInput name="username" placeholder="Username" />
            {authMode === "signup" && (
              <NeumoInput name="email" placeholder="Email" type="email" />
            )}
            <NeumoInput name="password" placeholder="Password" type="password" />
            {authMode === "signup" && (
              <NeumoInput
                name="confirmPassword"
                placeholder="Confirm Password"
                type="password"
              />
            )}

            {errorMessage && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {errorMessage}
              </p>
            )}

            {statusMessage && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                {statusMessage}
              </p>
            )}

            <p className="text-sm text-slate-500">
              Forgot Password?
            </p>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-14 rounded-2xl text-white text-lg font-semibold
                bg-[linear-gradient(180deg,#63c0ff_0%,#2f7bf4_100%)]
                shadow-[0_18px_35px_rgba(47,123,244,0.35),
                        inset_0_2px_0_rgba(255,255,255,0.45)]
                hover:brightness-[1.03]
                active:brightness-[0.97]
                transition disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? authMode === "signup"
                  ? "Signing up..."
                  : "Logging in..."
                : authMode === "signup"
                  ? "Create Account"
                  : "Login"}
            </button>

            <p className="text-center text-sm text-slate-500">
              {authMode === "signup" ? "Already have an account?" : "Not a member?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setAuthMode((prev) => (prev === "login" ? "signup" : "login"));
                  setErrorMessage(null);
                  setStatusMessage(null);
                }}
                className="text-blue-600 font-semibold cursor-pointer hover:text-blue-700"
              >
                {authMode === "signup" ? "Login" : "Signup"}
              </button>
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}

function NeumoInput({
  name,
  placeholder,
  type = "text",
}: {
  name: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <div
      className="rounded-2xl bg-white/70 px-5 h-14 flex items-center
        shadow-[inset_10px_10px_20px_rgba(0,0,0,0.10),
                inset_-10px_-10px_20px_rgba(255,255,255,0.95)]
        border border-white/50"
    >
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        className="w-full bg-transparent outline-none
          text-slate-700 placeholder:text-slate-400 text-base"
        required
      />
    </div>
  );
}
