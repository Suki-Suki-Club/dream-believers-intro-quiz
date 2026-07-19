const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const withoutControlCharacters = raw
    .trim()
    .replace(CONTROL_CHARACTERS, '')
    .trim();

  if (withoutControlCharacters.length === 0) {
    return null;
  }

  const limited = Array.from(withoutControlCharacters).slice(0, 20).join('');
  return limited.length > 0 ? limited : null;
}
