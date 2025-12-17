// e.g. frontend/components/AuthNav.tsx
"use client";

import { useUser } from "@auth0/nextjs-auth0/client";

export function AuthNav() {
  const { user, error, isLoading } = useUser();

  if (isLoading) return <span>Loading...</span>;
  if (error) return <span>Error: {error.message}</span>;

  if (!user) {
    return (
      <div className="flex items-center gap-3">
        {/* Optional sign up hint */}
        <a href="/auth/login?screen_hint=signup" className="underline">
          Sign up
        </a>
        <a href="/auth/login" className="underline">
          Log in
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span>Hello, {user.name ?? user.email}</span>
      <a href="/auth/logout" className="underline">
        Log out
      </a>
    </div>
  );
}
