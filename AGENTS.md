# AGENTS.md

## Cursor Cloud specific instructions

Flashpart is a Vite + React 19 single-page PWA (`src/`) backed by a Convex
deployment (`convex/`), with optional Trigger.dev background jobs (`trigger/`).
There is no lint config and no test suite; `package.json` scripts are only
`dev`, `build`, and `preview`. Use `pnpm` for everything.

### Services

- **Convex backend** — provides all data/auth APIs. Must be running before the
  frontend loads.
- **Vite dev server** (`pnpm dev`, http://localhost:5173) — the web app.
- **Trigger.dev** (`trigger/`) — background jobs for photo processing / Shopify.
  Requires a Trigger.dev account and is not needed to run or test the core app.

### Running locally (order matters)

1. Start Convex first. This repo has no cloud Convex account here, so use the
   local anonymous backend:
   `CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck=disable --tail-logs=disable`
   - `CONVEX_AGENT_MODE=anonymous` is required, otherwise the CLI drops into an
     interactive login prompt.
   - This writes `.env.local` (gitignored) with `VITE_CONVEX_URL` (http://127.0.0.1:3210)
     and `VITE_CONVEX_SITE_URL` (http://127.0.0.1:3211). Keep this process running;
     it hot-reloads `convex/` functions.
2. Start the frontend: `pnpm dev`. `src/App.tsx` throws at import time if
   `VITE_CONVEX_URL` is missing, so `.env.local` must exist (step 1) before the
   page loads.

### Non-obvious gotchas

- **`--typecheck=disable` is needed for Convex pushes.** `convex/tsconfig.json`
  does not declare node types, so the default `convex dev` typecheck fails on
  `node:crypto`/`process` in `convex/auth.ts` and `convex/shopify.ts`. These are
  compile-time-only errors; the `"use node"` actions run fine at runtime.
- **`pnpm build` currently fails on a pre-existing `tsc` error** in
  `src/hooks/use-passkey-sign-in.ts` (`challengeId` typed as `string` vs
  `Id<"authChallenges">`). This is unrelated to environment setup. `pnpm dev`
  uses esbuild and does NOT typecheck, so the app runs fine despite it.
- **Use pnpm 10.x.** The lockfile resolves under pnpm 10; pnpm 11 (e.g. via a
  stray `corepack enable`) adds a pre-script deps check that treats pnpm's
  "ignored build scripts" warning as a fatal error and breaks `pnpm <script>`.
- `pnpm install` reports ignored build scripts for `esbuild` and `protobufjs`.
  They are safe to ignore — Vite/esbuild work via the prebuilt platform binary,
  and `protobufjs` is only pulled in by the (unused-here) Trigger.dev SDK.

### Auth / testing authenticated flows

Login is email-OTP (needs `RESEND_API_KEY`) plus a WebAuthn passkey, neither of
which is feasible headlessly in the cloud VM. To test authenticated screens,
mint a session directly in the local Convex DB and inject it into the browser:

1. Create a `users` row and an `authSessions` row whose `tokenHash` is the
   SHA-256 hex of a chosen token (see `hashValue` in `convex/authUtils.ts`).
   A throwaway `internalMutation` run via `npx convex run <module>:<fn>` is the
   easiest way.
2. In the browser at http://localhost:5173, set
   `localStorage.setItem('flashpart.session', JSON.stringify({email, sessionToken}))`
   and reload. `src/lib/auth-session.ts` reads this key on load.
