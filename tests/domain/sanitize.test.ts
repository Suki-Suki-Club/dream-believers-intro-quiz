import { describe, expect, it } from 'vitest';
import { sanitizeName } from '../../worker/domain/sanitize';

describe('sanitizeName', () => {
  it('trims names and removes control characters', () => {
    expect(sanitizeName('  Alice\u0000\n\t')).toBe('Alice');
    expect(sanitizeName('A\u0000B\u007fC')).toBe('ABC');
  });

  it('limits names to 20 characters', () => {
    expect(sanitizeName('123456789012345678901')).toBe('12345678901234567890');
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('   \n\t')).toBeNull();
    expect(sanitizeName(null)).toBeNull();
  });
});
