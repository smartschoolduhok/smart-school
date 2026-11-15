// Server-error monitoring: how an error is reduced to a safe, groupable record
// and how a Telegram alert is worded. Pure logic shared by the Worker and tests.

export const ERROR_RETENTION_DAYS = 30;
export const ALERT_THROTTLE_SECONDS = 3600;
const MAX_MESSAGE = 500;

// Replace ids, UUIDs and long tokens in a path so one route groups together.
export function normalizeRoute(path: string): string {
  const route = path.split('?')[0]
    .split('/')
    .map(segment => {
      if (/^\d+$/.test(segment)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ':id';
      if (segment.length >= 20 && /^[A-Za-z0-9_-]+$/.test(segment)) return ':token';
      return segment;
    })
    .join('/');
  return route.slice(0, 200) || '/';
}

// Database messages can quote the values that failed a constraint; strip
// quoted literals and long numbers so no names, phones or ids leave the Worker.
export function sanitizeErrorMessage(message: unknown): string | null {
  if (message == null) return null;
  const text = String(message)
    .replace(/'(?:[^']|'')*'/g, "'…'")
    .replace(/"(?:[^"\\]|\\.)*"/g, '"…"')
    .replace(/\b\d{5,}\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, MAX_MESSAGE) : null;
}

export type ErrorRecord = {
  method: string;
  route: string;
  status: number;
  error_name: string | null;
  error_message: string | null;
  school_id: number | null;
  user_id: number | null;
};

export function errorRecord(input: { method: string; path: string; status: number; error: unknown; schoolId?: number | null; userId?: number | null }): ErrorRecord {
  const error = input.error as { name?: unknown; message?: unknown } | null;
  return {
    method: input.method.toUpperCase().slice(0, 10),
    route: normalizeRoute(input.path),
    status: Math.min(599, Math.max(400, Math.trunc(input.status) || 500)),
    error_name: error && typeof error === 'object' && error.name ? String(error.name).slice(0, 80) : null,
    error_message: sanitizeErrorMessage(error && typeof error === 'object' ? error.message : error),
    school_id: input.schoolId ?? null,
    user_id: input.userId ?? null,
  };
}

// Same route + same kind of error = same fingerprint, regardless of the ids involved.
export async function errorFingerprint(record: Pick<ErrorRecord, 'method' | 'route' | 'status' | 'error_name' | 'error_message'>): Promise<string> {
  const basis = [record.method, record.route, record.status, record.error_name ?? '', (record.error_message ?? '').replace(/\d+/g, '#').slice(0, 160)].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
  return [...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function telegramAlertText(record: ErrorRecord, context: { environment: string; recentCount: number; at: Date }): string {
  const lines = [
    `⚠️ خطأ خادم — Smart School (${context.environment})`,
    `${record.method} ${record.route} → ${record.status}`,
    record.error_name || record.error_message ? `${record.error_name ?? 'Error'}: ${record.error_message ?? ''}`.trim() : null,
    record.school_id != null ? `المدرسة: ${record.school_id}` : null,
    context.recentCount > 1 ? `تكرر ${context.recentCount} مرة خلال الساعة الأخيرة` : null,
    `الوقت: ${context.at.toISOString()}`,
  ];
  return lines.filter(Boolean).join('\n').slice(0, 3500);
}

export function isTelegramConfigured(env: { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string }): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && /^\d+:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN) && env.TELEGRAM_CHAT_ID && /^-?\d+$|^@[A-Za-z0-9_]{5,}$/.test(env.TELEGRAM_CHAT_ID));
}
