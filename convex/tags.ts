export function parseTagList(input: string | undefined | null): string[] {
  if (!input?.trim()) {
    return [];
  }

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const part of input.split(",")) {
    const tag = part.trim();

    if (!tag) {
      continue;
    }

    const key = tag.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

export function mergeTagLists(
  ...inputs: Array<string | undefined | null>
): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const input of inputs) {
    for (const tag of parseTagList(input)) {
      const key = tag.toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      tags.push(tag);
    }
  }

  return tags;
}

export function normalizeTagString(
  input: string | undefined | null,
): string | undefined {
  const tags = parseTagList(input);

  return tags.length > 0 ? tags.join(", ") : undefined;
}
