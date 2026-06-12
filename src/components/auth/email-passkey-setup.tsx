import { startRegistration } from "@simplewebauthn/browser";
import { useAction } from "convex/react";
import { LogIn, ShieldCheck } from "lucide-react";
import * as React from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { usePasskeySignIn } from "../../hooks/use-passkey-sign-in";
import { storeSession, type AuthSession } from "../../lib/auth-session";
import { convexApi } from "../../lib/convex-api";
import { storePasskeyHintEmail } from "../../lib/passkey-hint-storage";

type EmailPasskeySetupProps = {
  onSignedIn: (session: AuthSession) => void;
};

export function EmailPasskeySetup({ onSignedIn }: EmailPasskeySetupProps) {
  const requestOtp = useAction(convexApi.auth.requestEmailOtp);
  const startSetup = useAction(convexApi.auth.verifyOtpAndStartPasskeySetup);
  const completeSetup = useAction(convexApi.auth.completePasskeySetup);
  const { trySignInForEmail } = usePasskeySignIn(onSignedIn);
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [codeSent, setCodeSent] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);

  async function sendOtp() {
    await requestOtp({ email });
    setCodeSent(true);
    setMessage("Check your email for a 6-digit code.");
  }

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("");

    try {
      try {
        const signedIn = await trySignInForEmail(email);
        if (signedIn) {
          return;
        }
      } catch {
        // Fall through to email verification when passkey sign-in is unavailable.
      }

      await sendOtp();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreatePasskey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("");

    try {
      const origin = window.location.origin;
      const { options, challengeId } = await startSetup({ email, code, origin });
      const response = await startRegistration({ optionsJSON: options });
      const session = await completeSetup({ challengeId, response, origin });

      storeSession(session);
      storePasskeyHintEmail(session.email);
      onSignedIn(session);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create passkey.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={codeSent ? handleCreatePasskey : handleSignIn}
    >
      {!codeSent ? (
        <label className="grid gap-2 text-sm font-medium">
          Email
          <Input
            autoComplete="email webauthn"
            inputMode="email"
            onChange={(event) => setEmail(event.currentTarget.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </label>
      ) : (
        <label className="grid gap-2 text-sm font-medium">
          One-time code
          <Input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) =>
              setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="123456"
            required
            value={code}
          />
        </label>
      )}
      {message ? <p className="text-sm text-slate-500">{message}</p> : null}
      <Button disabled={isBusy || (codeSent && code.length !== 6)} type="submit">
        {codeSent ? (
          <ShieldCheck className="h-4 w-4" />
        ) : (
          <LogIn className="h-4 w-4" />
        )}
        {codeSent
          ? isBusy
            ? "Creating passkey..."
            : "Create passkey"
          : isBusy
            ? "Signing in..."
            : "Sign in"}
      </Button>
    </form>
  );
}
