import { pbkdf2 } from 'node:crypto';

export const PASSWORD_HASH_SCHEME = 'pbkdf2_sha256';
// 100,000 is the currently verified Cloudflare Workers PBKDF2 runtime maximum in staging.
export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_SALT_BYTES = 16;
export const PBKDF2_DERIVED_KEY_BYTES = 32;

// Retained only to verify and migrate hashes created by the legacy application.
// It is never used when creating or resetting a password.
const LEGACY_PASSWORD_SALT = 'smart-school-salt-2026';
const LEGACY_HASH_PATTERN = /^[a-f0-9]{64}$/i;

export interface PasswordVerificationResult {
  valid: boolean;
  needsUpgrade: boolean;
  scheme: 'pbkdf2_sha256' | 'legacy_sha256' | 'unknown';
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, PBKDF2_DERIVED_KEY_BYTES, 'sha256', (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Uint8Array.from(derivedKey));
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const derivedKey = await derivePasswordKey(password, salt, PBKDF2_ITERATIONS);
  return [
    PASSWORD_HASH_SCHEME,
    PBKDF2_ITERATIONS,
    bytesToBase64Url(salt),
    bytesToBase64Url(derivedKey),
  ].join('$');
}

export function isLegacyPasswordHash(storedHash: string | null | undefined): boolean {
  return typeof storedHash === 'string' && LEGACY_HASH_PATTERN.test(storedHash);
}

export async function createLegacyPasswordHash(password: string, email: string): Promise<string> {
  const input = new TextEncoder().encode(password + LEGACY_PASSWORD_SALT + email);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)));
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
  legacyEmail?: string,
): Promise<PasswordVerificationResult> {
  if (!storedHash) return { valid: false, needsUpgrade: false, scheme: 'unknown' };

  if (isLegacyPasswordHash(storedHash)) {
    if (!legacyEmail) return { valid: false, needsUpgrade: false, scheme: 'legacy_sha256' };
    const candidate = await createLegacyPasswordHash(password, legacyEmail);
    const valid = constantTimeEqual(
      new TextEncoder().encode(candidate.toLowerCase()),
      new TextEncoder().encode(storedHash.toLowerCase()),
    );
    return { valid, needsUpgrade: valid, scheme: 'legacy_sha256' };
  }

  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_SCHEME) {
    return { valid: false, needsUpgrade: false, scheme: 'unknown' };
  }

  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) {
    return { valid: false, needsUpgrade: false, scheme: 'unknown' };
  }

  try {
    const salt = base64UrlToBytes(parts[2]);
    const storedKey = base64UrlToBytes(parts[3]);
    if (salt.length < PBKDF2_SALT_BYTES || storedKey.length !== PBKDF2_DERIVED_KEY_BYTES) {
      return { valid: false, needsUpgrade: false, scheme: 'unknown' };
    }
    const candidateKey = await derivePasswordKey(password, salt, iterations);
    const valid = constantTimeEqual(candidateKey, storedKey);
    return {
      valid,
      needsUpgrade: valid && iterations < PBKDF2_ITERATIONS,
      scheme: 'pbkdf2_sha256',
    };
  } catch {
    return { valid: false, needsUpgrade: false, scheme: 'unknown' };
  }
}
