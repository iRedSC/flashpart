export function maskEmail(email: string) {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");

  if (at <= 0) {
    return "*******";
  }

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (!domain) {
    return "*******";
  }

  const prefix = local.length <= 1 ? `${local || "*"}****` : `${local[0]}****`;

  return `${prefix}@${domain}`;
}
