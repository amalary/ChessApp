export const LOCAL_AUTH_ACTIVE_USER_STORAGE_KEY = 'chessapp.local-auth.active-user';
export const LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT = 'chessapp.local-auth.active-user.updated';

type LocalAuthActiveUser = {
  id?: unknown;
  username?: unknown;
  email?: unknown;
  sessionToken?: unknown;
};

function dispatchLocalAuthActiveUserUpdatedEvent(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }

  const EventConstructor = window.Event;
  if (typeof EventConstructor === 'function') {
    window.dispatchEvent(new EventConstructor(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT));
    return;
  }

  if (typeof document === 'undefined' || typeof document.createEvent !== 'function') {
    return;
  }

  const legacyEvent = document.createEvent('Event');
  legacyEvent.initEvent(LOCAL_AUTH_ACTIVE_USER_UPDATED_EVENT, false, false);
  window.dispatchEvent(legacyEvent);
}

function normalizeScopePart(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const safe = normalized.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
  return safe || null;
}

function readActiveLocalAuthUserUnsafe(): LocalAuthActiveUser | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(LOCAL_AUTH_ACTIVE_USER_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as LocalAuthActiveUser;
  } catch {
    return null;
  }
}

function clearLocalAuthUserWithoutSessionToken(
  id: string | null,
  username: string | null,
  email: string | null,
  sessionToken: string | null,
): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (!(id || username || email) || sessionToken) {
    return false;
  }

  window.localStorage.removeItem(LOCAL_AUTH_ACTIVE_USER_STORAGE_KEY);
  dispatchLocalAuthActiveUserUpdatedEvent();
  return true;
}

export function readActiveLocalAuthUser(): {
  id: string | null;
  username: string | null;
  email: string | null;
  sessionToken: string | null;
} | null {
  const raw = readActiveLocalAuthUserUnsafe();
  if (!raw) {
    return null;
  }

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
  const username =
    typeof raw.username === 'string' && raw.username.trim() ? raw.username.trim() : null;
  const email = typeof raw.email === 'string' && raw.email.trim() ? raw.email.trim() : null;
  const sessionToken =
    typeof raw.sessionToken === 'string' && raw.sessionToken.trim()
      ? raw.sessionToken.trim()
      : null;

  if (!id && !username && !email) {
    return null;
  }

  if (clearLocalAuthUserWithoutSessionToken(id, username, email, sessionToken)) {
    return null;
  }

  return { id, username, email, sessionToken };
}

export function writeActiveLocalAuthUser(user: {
  id?: string | null;
  username?: string | null;
  email?: string | null;
  sessionToken?: string | null;
} | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!user) {
    window.localStorage.removeItem(LOCAL_AUTH_ACTIVE_USER_STORAGE_KEY);
    dispatchLocalAuthActiveUserUpdatedEvent();
    return;
  }

  const normalized = {
    id: typeof user.id === 'string' ? user.id : '',
    username: typeof user.username === 'string' ? user.username : '',
    email: typeof user.email === 'string' ? user.email : '',
    sessionToken: typeof user.sessionToken === 'string' ? user.sessionToken : '',
  };
  window.localStorage.setItem(LOCAL_AUTH_ACTIVE_USER_STORAGE_KEY, JSON.stringify(normalized));
  dispatchLocalAuthActiveUserUpdatedEvent();
}

export function resolveUserSettingsScope(auth0Sub: string | null | undefined): string | null {
  const auth0Scope = normalizeScopePart(auth0Sub);
  if (auth0Scope) {
    return `auth0_${auth0Scope}`;
  }

  const localAuthUser = readActiveLocalAuthUserUnsafe();
  const localScope =
    normalizeScopePart(localAuthUser?.id) ??
    normalizeScopePart(localAuthUser?.username) ??
    normalizeScopePart(localAuthUser?.email);
  if (localScope) {
    return `local_${localScope}`;
  }

  return null;
}

export function buildScopedStorageKey(baseKey: string, scope: string | null): string {
  if (!scope) {
    return baseKey;
  }
  return `${baseKey}.${scope}`;
}

export function readScopedStorageValue(baseKey: string, scope: string | null): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const scopedKey = buildScopedStorageKey(baseKey, scope);
  const scopedValue = window.localStorage.getItem(scopedKey);
  if (scopedValue !== null) {
    return scopedValue;
  }

  if (scope) {
    return null;
  }

  return window.localStorage.getItem(baseKey);
}

export function writeScopedStorageValue(baseKey: string, scope: string | null, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(buildScopedStorageKey(baseKey, scope), value);
}
