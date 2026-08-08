export const PUBLIC_API_ROUTES = [
  'POST /api/auth/login',
  'GET /api/verify/result-card/:token',
  'GET /api/verify/receipt/:token',
  'GET /api/verify/official-book/:token',
] as const;

export const LOGIN_THROTTLE_POLICY = {
  maxAttempts: 5,
  windowSeconds: 15 * 60,
  lockSeconds: 15 * 60,
  retentionSeconds: 24 * 60 * 60,
} as const;

export interface LoginThrottleRecord {
  failed_attempts: number;
  window_started_at: number;
  locked_until: number | null;
}

export interface LoginThrottleDecision {
  limited: boolean;
  retryAfter: number;
  failedAttempts: number;
  windowStartedAt: number;
  lockedUntil: number | null;
}

export function normalizeLoginEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isPublicApiRequest(method: string, pathname: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'OPTIONS') return true;
  if (normalizedMethod === 'POST' && pathname === '/api/auth/login') return true;
  return normalizedMethod === 'GET'
    && /^\/api\/verify\/(result-card|receipt|official-book)\/[^/]+$/.test(pathname);
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getAllowedCorsOrigins(configuredOrigins: string | undefined, appEnv: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const value of configuredOrigins?.split(',') ?? []) {
    const origin = normalizeOrigin(value);
    if (origin) origins.add(origin);
  }
  if (['development', 'test', 'local'].includes((appEnv ?? '').toLowerCase())) {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }
  return origins;
}

export function isCorsOriginAllowed(
  requestOrigin: string | undefined,
  requestUrl: string,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (!requestOrigin) return true;
  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  if (!normalizedRequestOrigin) return false;
  const requestUrlOrigin = new URL(requestUrl).origin;
  return normalizedRequestOrigin === requestUrlOrigin || allowedOrigins.has(normalizedRequestOrigin);
}

export function getClientIp(headers: Headers): string {
  const connectingIp = headers.get('CF-Connecting-IP')?.trim();
  if (connectingIp) return connectingIp.slice(0, 64);
  const forwardedIp = headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  return (forwardedIp || 'unknown').slice(0, 64);
}

export async function createLoginThrottleKey(email: string, clientIp: string): Promise<string> {
  const normalized = normalizeLoginEmail(email) + '\n' + clientIp.trim().toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function inspectLoginThrottle(
  record: LoginThrottleRecord | null,
  nowSeconds: number,
): LoginThrottleDecision {
  if (record?.locked_until && record.locked_until > nowSeconds) {
    return {
      limited: true,
      retryAfter: Math.max(1, record.locked_until - nowSeconds),
      failedAttempts: record.failed_attempts,
      windowStartedAt: record.window_started_at,
      lockedUntil: record.locked_until,
    };
  }
  const windowExpired = !record
    || record.window_started_at + LOGIN_THROTTLE_POLICY.windowSeconds <= nowSeconds;
  return {
    limited: false,
    retryAfter: 0,
    failedAttempts: windowExpired ? 0 : record.failed_attempts,
    windowStartedAt: windowExpired ? nowSeconds : record.window_started_at,
    lockedUntil: null,
  };
}

export function recordLoginFailure(
  record: LoginThrottleRecord | null,
  nowSeconds: number,
): LoginThrottleDecision {
  const current = inspectLoginThrottle(record, nowSeconds);
  if (current.limited) return current;
  const failedAttempts = current.failedAttempts + 1;
  const lockedUntil = failedAttempts >= LOGIN_THROTTLE_POLICY.maxAttempts
    ? nowSeconds + LOGIN_THROTTLE_POLICY.lockSeconds
    : null;
  return {
    limited: lockedUntil !== null,
    retryAfter: lockedUntil ? LOGIN_THROTTLE_POLICY.lockSeconds : 0,
    failedAttempts,
    windowStartedAt: current.windowStartedAt,
    lockedUntil,
  };
}
