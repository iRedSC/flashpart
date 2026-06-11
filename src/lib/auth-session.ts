import {
  clearDocumentCookie,
  readDocumentCookie,
  writeDocumentCookie,
} from "./doc-cookie";

export type AuthSession = {
  email: string;
  sessionToken: string;
};

const STORAGE_KEY = "flashpart.session";
const SESSION_COOKIE = "fp_session";
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export function readStoredSession() {
  const fromStorage = window.localStorage.getItem(STORAGE_KEY);

  if (fromStorage) {
    try {
      return JSON.parse(fromStorage) as AuthSession;
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  const rawCookie = readDocumentCookie(SESSION_COOKIE);

  if (rawCookie) {
    try {
      const session = JSON.parse(rawCookie) as AuthSession;

      if (session?.sessionToken && session?.email) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch {
          // Private browsing/quota issues should not block sign-in recovery.
        }

        return session;
      }
    } catch {
      clearDocumentCookie(SESSION_COOKIE);
    }
  }

  return null;
}

export function storeSession(session: AuthSession) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  writeDocumentCookie(
    SESSION_COOKIE,
    JSON.stringify(session),
    SESSION_MAX_AGE_SEC,
  );
}

export function clearStoredSession() {
  window.localStorage.removeItem(STORAGE_KEY);
  clearDocumentCookie(SESSION_COOKIE);
}
