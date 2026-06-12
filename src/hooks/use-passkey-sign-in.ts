import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useAction } from "convex/react";
import * as React from "react";
import { storeSession, type AuthSession } from "../lib/auth-session";
import { convexApi } from "../lib/convex-api";
import { storePasskeyHintEmail } from "../lib/passkey-hint-storage";

export function usePasskeySignIn(onSignedIn: (session: AuthSession) => void) {
  const onSignedInRef = React.useRef(onSignedIn);
  const startSignIn = useAction(convexApi.auth.startPasskeySignIn);
  const startSignInForEmail = useAction(convexApi.auth.startPasskeySignInForEmail);
  const completeSignIn = useAction(convexApi.auth.completePasskeySignIn);

  React.useEffect(() => {
    onSignedInRef.current = onSignedIn;
  }, [onSignedIn]);

  const finishSignIn = React.useCallback(
    async (challengeId: string, response: Awaited<ReturnType<typeof startAuthentication>>) => {
      const origin = window.location.origin;
      const session = await completeSignIn({ challengeId, response, origin });

      storeSession(session);
      storePasskeyHintEmail(session.email);
      onSignedInRef.current(session);
    },
    [completeSignIn],
  );

  const trySignInForEmail = React.useCallback(
    async (email: string) => {
      if (!browserSupportsWebAuthn()) {
        return false;
      }

      const origin = window.location.origin;
      const result = await startSignInForEmail({ email, origin });

      if (!result.available) {
        return false;
      }

      const response = await startAuthentication({ optionsJSON: result.options });
      await finishSignIn(result.challengeId, response);
      return true;
    },
    [finishSignIn, startSignInForEmail],
  );

  const trySignIn = React.useCallback(async () => {
    const origin = window.location.origin;
    const { options, challengeId } = await startSignIn({ origin });
    const response = await startAuthentication({ optionsJSON: options });
    await finishSignIn(challengeId, response);
  }, [finishSignIn, startSignIn]);

  return { trySignIn, trySignInForEmail };
}
