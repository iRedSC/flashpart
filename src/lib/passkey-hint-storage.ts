import {
  clearDocumentCookie,
  readDocumentCookie,
  writeDocumentCookie,
} from "./doc-cookie";

const KEY = "flashpart.passkeyHintEmail";
const HINT_COOKIE = "fp_pk_hint";
const HINT_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export function readPasskeyHintEmail() {
  try {
    const fromStorage = window.localStorage.getItem(KEY);

    if (fromStorage && fromStorage.includes("@")) {
      return fromStorage;
    }
  } catch {
    // Ignore storage failures.
  }

  const fromCookie = readDocumentCookie(HINT_COOKIE);

  if (fromCookie && fromCookie.includes("@")) {
    const normalized = fromCookie.trim().toLowerCase();

    try {
      window.localStorage.setItem(KEY, normalized);
    } catch {
      // Ignore storage failures.
    }

    return normalized;
  }

  return null;
}

export function storePasskeyHintEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  try {
    window.localStorage.setItem(KEY, normalized);
  } catch {
    // Ignore storage failures.
  }

  writeDocumentCookie(HINT_COOKIE, normalized, HINT_MAX_AGE_SEC);
}

export function clearPasskeyHintEmail() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Ignore storage failures.
  }

  clearDocumentCookie(HINT_COOKIE);
}
