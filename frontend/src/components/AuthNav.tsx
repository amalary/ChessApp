// e.g. frontend/components/AuthNav.tsx
"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import {
  LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT,
  readActiveLocalAuthUser,
  writeActiveLocalAuthUser,
} from "@/lib/dashboard-theme-settings";

export function AuthNav() {
  const { user, error, isLoading } = useUser();
  const [localAuthUser, setLocalAuthUser] = useState(() => readActiveLocalAuthUser());

  useEffect(() => {
    const syncLocalAuthState = () => {
      setLocalAuthUser(readActiveLocalAuthUser());
    };

    syncLocalAuthState();
    window.addEventListener("storage", syncLocalAuthState);
    window.addEventListener("focus", syncLocalAuthState);
    window.addEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, syncLocalAuthState);

    return () => {
      window.removeEventListener("storage", syncLocalAuthState);
      window.removeEventListener("focus", syncLocalAuthState);
      window.removeEventListener(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, syncLocalAuthState);
    };
  }, []);

  const hasAuth0Session = Boolean(user?.sub);
  const hasLocalAuthSession = Boolean(localAuthUser?.id);
  const isAuthenticated = hasAuth0Session || hasLocalAuthSession;
  const displayName =
    user?.name ??
    user?.email ??
    localAuthUser?.username ??
    localAuthUser?.email ??
    "user";

  const logoutHref = hasAuth0Session
    ? "/api/auth/logout?returnTo=%2Flogin-test"
    : "/login-test?mode=login";

  const handleLogout = (event: MouseEvent<HTMLAnchorElement>) => {
    writeActiveLocalAuthUser(null);
    void fetch("/api/local-auth/logout", { method: "POST", credentials: "same-origin" });

    if (!hasAuth0Session) {
      event.preventDefault();
      window.location.assign("/login-test?mode=login");
    }
  };

  if (isLoading) return <span>Loading...</span>;
  if (error) return <span>Error: {error.message}</span>;

  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-3">
        <a
          href="/login-test?mode=signup&returnTo=%2Fdashboard"
          className="underline"
        >
          Sign up
        </a>
        <a href="/login-test?mode=login&returnTo=%2Fdashboard" className="underline">
          Log in
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span>Hello, {displayName}</span>
      <a href={logoutHref} onClick={handleLogout} className="underline">
        Log out
      </a>
    </div>
  );
}
