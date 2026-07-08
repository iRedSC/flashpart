import { useAction } from "convex/react";
import { ArrowRight, KeyRound } from "lucide-react";
import * as React from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { convexApi } from "../../lib/convex-api";

type InviteCodeGateProps = {
  onBack: () => void;
  onVerified: (inviteCode: string) => void;
};

export function InviteCodeGate({ onBack, onVerified }: InviteCodeGateProps) {
  const verifyInviteCode = useAction(convexApi.auth.verifyInviteCode);
  const [inviteCode, setInviteCode] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("");

    try {
      await verifyInviteCode({ code: inviteCode });
      onVerified(inviteCode.trim());
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "That invite code is not correct.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-sm font-medium">
        Invite code
        <Input
          autoComplete="off"
          autoFocus
          onChange={(event) => setInviteCode(event.currentTarget.value)}
          placeholder="Enter your invite code"
          required
          spellCheck={false}
          value={inviteCode}
        />
      </label>
      {message ? <p className="text-sm text-slate-500">{message}</p> : null}
      <Button disabled={isBusy || inviteCode.trim().length === 0} type="submit">
        <ArrowRight className="h-4 w-4" />
        {isBusy ? "Checking..." : "Continue"}
      </Button>
      <Button onClick={onBack} type="button" variant="ghost">
        <KeyRound className="h-4 w-4" />
        Back to sign in
      </Button>
    </form>
  );
}
