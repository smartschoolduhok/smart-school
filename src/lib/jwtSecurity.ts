export const JWT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MINIMUM_JWT_SECRET_LENGTH = 32;

export class AuthConfigurationError extends Error {
  constructor() {
    super('Authentication configuration is invalid');
    this.name = 'AuthConfigurationError';
  }
}

export interface JwtPayload extends Record<string, unknown> {
  email: string;
  auth_version: number;
  jti: string;
  iat: number;
  exp: number;
}

interface SignJwtOptions {
  expiresInSeconds?: number;
  nowSeconds?: number;
  jti?: string;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function getValidatedJwtSecret(value: unknown): string {
  if (typeof value !== 'string') throw new AuthConfigurationError();
  const secret = value.trim();
  const unsafePlaceholder = /(default|placeholder|change[-_ ]?me|your[-_ ]?(secret|key)|example)/i;
  if (secret.length < MINIMUM_JWT_SECRET_LENGTH || unsafePlaceholder.test(secret)) {
    throw new AuthConfigurationError();
  }
  return secret;
}

export function generateJwtId(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function signJWT(
  payload: Record<string, unknown> & { email: string; auth_version: number },
  secretValue: unknown,
  options: SignJwtOptions = {},
): Promise<string> {
  const secret = getValidatedJwtSecret(secretValue);
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expiresInSeconds = options.expiresInSeconds ?? JWT_SESSION_TTL_SECONDS;
  const fullPayload: JwtPayload = {
    ...payload,
    email: payload.email,
    jti: options.jti ?? generateJwtId(),
    iat: now,
    exp: now + expiresInSeconds,
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const encoder = new TextEncoder();
  const headerPart = encodeBase64Url(encoder.encode(JSON.stringify(header)));
  const payloadPart = encodeBase64Url(encoder.encode(JSON.stringify(fullPayload)));
  const signingInput = headerPart + '.' + payloadPart;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacKey(secret),
    encoder.encode(signingInput),
  );
  return signingInput + '.' + encodeBase64Url(new Uint8Array(signature));
}

export function decodeJwtPayloadUnsafe(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as JwtPayload;
  } catch {
    return null;
  }
}

export async function verifyJWT(
  token: string,
  secretValue: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<JwtPayload | null> {
  const secret = getValidatedJwtSecret(secretValue);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(headerPart)));
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null;

    const signingInput = headerPart + '.' + payloadPart;
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      await importHmacKey(secret),
      (() => {
        const signature = decodeBase64Url(signaturePart);
        return signature.buffer.slice(
          signature.byteOffset,
          signature.byteOffset + signature.byteLength,
        ) as ArrayBuffer;
      })(),
      new TextEncoder().encode(signingInput),
    );
    if (!validSignature) return null;

    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart))) as JwtPayload;
    if (
      typeof payload.email !== 'string'
      || !Number.isSafeInteger(payload.auth_version)
      || payload.auth_version < 1
      || typeof payload.jti !== 'string'
      || payload.jti.length < 16
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || payload.exp <= nowSeconds
      || payload.iat > nowSeconds + 60
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
