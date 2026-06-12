import { KeyRound } from "lucide-react";
import { Button } from "../ui/button";
import { usePasskeySignIn } from "../../hooks/use-passkey-sign-in";
import type { AuthSession } from "../../lib/auth-session";

type PasskeySignInProps = {
  onSignedIn: (session: AuthSession) => void;
  label?: string;
};

export function PasskeySignIn({
  label = "Sign in with passkey",
  onSignedIn,
}: PasskeySignInProps) {
  const { trySignIn } = usePasskeySignIn(onSignedIn);

  return (
    <Button
      className="w-full"
      onClick={() => void trySignIn()}
      size="lg"
      type="button"
    >
      <KeyRound className="h-4 w-4" />
      {label}
    </Button>
  );
}
