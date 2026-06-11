import { startAuthentication } from "@simplewebauthn/browser";
import { useAction } from "convex/react";
import * as React from "react";
import { storeSession, type AuthSession } from "../lib/auth-session";
import { convexApi } from "../lib/convex-api";
import { storePasskeyHintEmail } from "../lib/passkey-hint-storage";

export function usePasskeySignIn(onSignedIn: (session: AuthSession) => void) {
  const onSignedInRef = React.useRef(onSignedIn);
  const startSignIn = useAction(convexApi.auth.startPasskeySignIn);
  const completeSignIn = useAction(convexApi.auth.completePasskeySignIn);

  React.useEffect(() => {
    onSignedInRef.current = onSignedIn;
  }, [onSignedIn]);

  return React.useCallback(async () => {
    const origin = window.location.origin;
    const { options, challengeId } = await startSignIn({ origin });
    const response = await startAuthentication({ optionsJSON: options });
    const session = await completeSignIn({ challengeId, response, origin });

    storeSession(session);
    storePasskeyHintEmail(session.email);
    onSignedInRef.current(session);
  }, [completeSignIn, startSignIn]);
}
