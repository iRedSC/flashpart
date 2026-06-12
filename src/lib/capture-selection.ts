import type { Id } from "../../convex/_generated/dataModel";

export type CaptureSelection = {
  captureGroupId?: Id<"groups">;
  createdAt: number;
  id: string;
  label: string;
  productIds: Id<"products">[];
};

const STORAGE_KEY = "flashpart:capture-selections";

function readAll(): Record<string, CaptureSelection> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as Record<string, CaptureSelection>;
  } catch {
    return {};
  }
}

function writeAll(selections: Record<string, CaptureSelection>) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
}

export function createCaptureSelection(args: {
  captureGroupId?: Id<"groups">;
  label: string;
  productIds: Id<"products">[];
}): string {
  const id = crypto.randomUUID();
  const selection: CaptureSelection = {
    captureGroupId: args.captureGroupId,
    createdAt: Date.now(),
    id,
    label: args.label,
    productIds: args.productIds,
  };
  const selections = readAll();

  selections[id] = selection;
  writeAll(selections);

  return id;
}

export function getCaptureSelection(id: string): CaptureSelection | null {
  return readAll()[id] ?? null;
}

export function removeCaptureSelection(id: string) {
  const selections = readAll();

  delete selections[id];
  writeAll(selections);
}
