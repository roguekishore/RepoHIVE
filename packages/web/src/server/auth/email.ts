/** Trim and lowercase before validation and storage. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Basic `local@domain` shape; not a full RFC parser. */
export function isValidEmailShape(email: string): boolean {
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) {
    return false;
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length === 0 || domain.length === 0) {
    return false;
  }
  if (domain.indexOf(".") === -1) {
    return false;
  }
  if (email.includes(" ") || email.includes("\t")) {
    return false;
  }
  return true;
}
