import * as React from "react";
import { PackagePlus } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { useAppData } from "../data/app-data-provider";
import type { Id } from "../../convex/_generated/dataModel";

type CreateGroupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (groupId: Id<"groups">) => void;
  ungroupedCount?: number;
};

export function CreateGroupDialog({
  open,
  onOpenChange,
  onCreated,
  ungroupedCount,
}: CreateGroupDialogProps) {
  const { createGroup } = useAppData();
  const [name, setName] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);

  function resetForm() {
    setName("");
    setIsCreating(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    setIsCreating(true);

    try {
      const groupId = await createGroup(trimmed);
      resetForm();
      onOpenChange(false);
      onCreated?.(groupId);
    } catch {
      // The shared data provider reports the error and reverts optimistic state.
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          resetForm();
        }
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            {typeof ungroupedCount === "number"
              ? `${ungroupedCount.toLocaleString()} products are not assigned to a group.`
              : "Create a group to organize products for capture and publishing."}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Input
            aria-label="Group name"
            autoFocus
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Example: Makita brushes, bin A4"
            value={name}
          />
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={!name.trim() || isCreating} type="submit">
              <PackagePlus className="h-4 w-4" />
              {isCreating ? "Creating..." : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
