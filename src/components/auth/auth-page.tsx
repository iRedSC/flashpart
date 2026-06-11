import * as React from "react";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { LogoMark } from "../logo-mark";
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
  const [boot, setBoot] = React.useState<"checking" | "ready">(() =>
    hintEmail && browserSupportsWebAuthn() ? "checking" : "ready",
  );
  const showReturn = Boolean(hintEmail) && !useOtherAccount;
  const tryPasskeySignIn = usePasskeySignIn((session) => {
    setHintEmail(session.email);
    setUseOtherAccount(false);
    onSignedIn(session);
  });

  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      // WebAuthn can't be queried silently for existing credentials, so only
      // auto-prompt when this device saved a passkey before (hint email is
      // written exclusively after passkey creation/sign-in). Otherwise go
      // straight to the OTP setup without popping a passkey dialog.
      if (!readPasskeyHintEmail() || !browserSupportsWebAuthn()) {
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
    <main className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-10 text-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark className="h-8 w-8" />
          <span className="text-xl font-semibold tracking-tight">Flashpart</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {boot === "checking"
                ? "Checking for a passkey"
                : showReturn
                  ? "Welcome back"
                  : "Sign in"}
            </CardTitle>
            <CardDescription>
              {boot === "checking"
                ? "Your browser may ask for Face ID, fingerprint, PIN, or a security key."
                : showReturn && hintEmail
                  ? `Continue as ${maskEmail(hintEmail)}.`
                  : "Verify your email once, then this device signs in with a passkey."}
            </CardDescription>
          </CardHeader>
          {boot === "checking" ? null : (
            <CardContent className="grid gap-3">
              {showReturn ? (
                <>
                  <PasskeySignIn label="Sign in with passkey" onSignedIn={onSignedIn} />
                  <Button
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
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-slate-400">
          Internal tool. Sessions are shared between the desktop site and the
          installed app.
        </p>
      </div>
    </main>
  );
}
