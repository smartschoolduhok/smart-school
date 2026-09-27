import type { JwtPayload } from './jwtSecurity';

export const CSRF_HEADER = 'X-CSRF-Token';

export function sessionCookieOptions(requestUrl: string, appEnv?: string) {
  const url = new URL(requestUrl);
  const secure = url.protocol === 'https:';
  const local = ['local', 'development', 'test'].includes(appEnv || '')
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!secure && !(local && url.protocol === 'http:')) throw new Error('HTTPS is required for session cookies');
  return {
    name: secure ? '__Host-smart_school_session' : 'smart_school_session',
    secure, httpOnly: true, sameSite: 'Strict' as const, path: '/',
  };
}

// Same-site sibling hosts and CORS allowlists must not confer cookie-session authority.
export function isSameOriginBrowserRequest(headers: Headers, requestUrl: string): boolean {
  const origin = headers.get('Origin');
  if (origin !== null && origin !== new URL(requestUrl).origin) return false;
  const site = headers.get('Sec-Fetch-Site');
  return site === null || site === 'same-origin' || site === 'none';
}

export function isUnsafeMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export function hasBrowserMetadata(headers: Headers): boolean {
  return headers.has('Origin') || headers.has('Sec-Fetch-Site') || headers.has('Sec-Fetch-Mode');
}

function csrfMessage(session: JwtPayload): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(['smart-school-csrf-v1', session.jti, session.email, session.auth_version]));
}

async function csrfKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionCsrfToken(session: JwtPayload, secret: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await csrfKey(secret), csrfMessage(session)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifySessionCsrfToken(value: string | undefined, session: JwtPayload, secret: string): Promise<boolean> {
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return false;
  const bytes = Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', await csrfKey(secret), bytes, csrfMessage(session));
}
