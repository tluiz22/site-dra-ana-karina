const E164_REGEX = /^\+\d{10,15}$/;

export function normalizePhone(rawPhone: string): string | null {
  const cleaned = rawPhone.replace(/[^\d+]/g, "");
  const withCountryCode = cleaned.startsWith("+") ? cleaned : `+55${cleaned}`;

  return E164_REGEX.test(withCountryCode) ? withCountryCode : null;
}
