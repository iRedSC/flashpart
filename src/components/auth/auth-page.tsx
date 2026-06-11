import * as React from "react";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Camera, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { EmailPasskeySetup } from "./email-passkey-setup";
import { PasskeySignIn } from "./passkey-sign-in";
import { usePasskeySignIn } from "../../hooks/use-passkey-sign-in";
import type { AuthSession } from "../../lib/auth-session";
import { maskEmail } from "../../lib/mask-email";
import {
  clearPasskeyHintEmail,
  readPasskeyHintEmail,
} from "../../lib/passkey-hint-storage";

type AuthPageProps = {
  onSignedIn: (session: AuthSession) => void;
};

export function AuthPage({ onSignedIn }: AuthPageProps) {
  const [hintEmail, setHintEmail] = React.useState(() => readPasskeyHintEmail());
  const [useOtherAccount, setUseOtherAccount] = React.useState(false);
  const [boot, setBoot] = React.useState<"checking" | "ready">("checking");
  const showReturn = Boolean(hintEmail) && !useOtherAccount;
  const tryPasskeySignIn = usePasskeySignIn((session) => {
    setHintEmail(session.email);
    setUseOtherAccount(false);
    onSignedIn(session);
  });

  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!browserSupportsWebAuthn()) {
        if (!cancelled) {
          setBoot("ready");
        }
        return;
      }

      try {
        await tryPasskeySignIn();
      } catch {
        if (!cancelled) {
          setBoot("ready");
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [tryPasskeySignIn]);

  function handleDifferentAccount() {
    clearPasskeyHintEmail();
    setHintEmail(null);
    setUseOtherAccount(true);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,#334155,transparent_32rem),radial-gradient(circle_at_bottom_right,#0f766e,transparent_28rem)] opacity-80" />
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[1fr_430px]">
        <section className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm text-slate-200 backdrop-blur">
            <Camera className="h-4 w-4" />
            Flashpart internal
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-balance">
            Photograph parts without losing the thread.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">
            Sign in once, keep your session across the desktop and installed PWA,
            then move through imports, groups, captures, and Shopify drafts.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              Email code setup
            </div>
            <div className="rounded-xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              Passkey return
            </div>
            <div className="rounded-xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              PWA session mirror
            </div>
          </div>
        </section>

        <Card className="border-white/15 bg-white text-slate-950 shadow-2xl">
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {boot === "checking"
                ? "Checking this device"
                : showReturn
                  ? "Returning device"
                  : "Secure setup"}
            </CardDescription>
            <CardTitle className="text-2xl">
              {boot === "checking"
                ? "Looking for your passkey..."
                : showReturn
                  ? "Sign in with your saved passkey"
                  : "Email code, then passkey"}
            </CardTitle>
            <CardDescription>
              {showReturn && hintEmail
                ? `Continue as ${maskEmail(hintEmail)}.`
                : "New devices verify email once, then save a passkey for fast return."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {boot === "checking" ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Your browser may ask for Face ID, fingerprint, PIN, or a security key.
              </div>
            ) : showReturn ? (
              <>
                <PasskeySignIn label="Sign in" onSignedIn={onSignedIn} />
                <Button
                  className="justify-self-center"
                  onClick={handleDifferentAccount}
                  type="button"
                  variant="ghost"
                >
                  Use a different account
                </Button>
              </>
            ) : (
              <EmailPasskeySetup onSignedIn={onSignedIn} />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
