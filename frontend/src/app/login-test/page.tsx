"use client";

import React, { useState, useSyncExternalStore } from "react";
import { Castle } from "lucide-react";
import SolveTestClient from "../solve-test/solve-test-client";

function subscribe() {
  return () => {};
}

export default function LoginTestPage() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();

    if (!username || !password) {
      return;
    }

    setIsLoggedIn(true);
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
            <NeumoInput name="password" placeholder="Password" type="password" />

            <p className="text-sm text-slate-500 cursor-pointer hover:text-slate-700 transition">
              Forgot Password?
            </p>

            <button
              type="submit"
              className="w-full h-14 rounded-2xl text-white text-lg font-semibold
                bg-[linear-gradient(180deg,#63c0ff_0%,#2f7bf4_100%)]
                shadow-[0_18px_35px_rgba(47,123,244,0.35),
                        inset_0_2px_0_rgba(255,255,255,0.45)]
                hover:brightness-[1.03]
                active:brightness-[0.97]
                transition"
            >
              Login
            </button>

            <p className="text-center text-sm text-slate-500">
              Not a member?{" "}
              <span className="text-blue-600 font-semibold cursor-pointer hover:text-blue-700">
                Signup
              </span>
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
