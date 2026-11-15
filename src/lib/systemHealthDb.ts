import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import {
  ALERT_THROTTLE_SECONDS, ERROR_RETENTION_DAYS, errorFingerprint, errorRecord, isTelegramConfigured, telegramAlertText,
  type ErrorRecord,
} from './systemHealth';

type Env = { Bindings: Bindings; Variables: Variables };
type C = Context<Env>;

// Fallback throttle for when the database itself is failing, so an outage
// does not send one Telegram message per request. Per Worker isolate.
const memoryThrottle = new Map<string, number>();

export async function sendTelegram(env: Bindings, text: string): Promise<boolean> {
  if (!isTelegramConfigured(env)) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function shouldAlert(db: D1Database, fingerprint: string, now: number): Promise<boolean> {
  try {
    const claimed = await db.prepare(`
      INSERT INTO system_alert_state(fingerprint, last_alerted_at) VALUES (?1, ?2)
      ON CONFLICT(fingerprint) DO UPDATE SET last_alerted_at = excluded.last_alerted_at
      WHERE system_alert_state.last_alerted_at <= ?2 - ?3
      RETURNING fingerprint
    `).bind(fingerprint, now, ALERT_THROTTLE_SECONDS).first();
    return Boolean(claimed);
  } catch {
    const last = memoryThrottle.get(fingerprint) ?? 0;
    if (now - last < ALERT_THROTTLE_SECONDS) return false;
    memoryThrottle.set(fingerprint, now);
    return true;
  }
}

// Records a 5xx and, at most once an hour per kind of error, alerts Telegram.
// Never throws: monitoring must not turn one failure into another.
export async function recordServerError(env: Bindings, record: ErrorRecord, now = Math.floor(Date.now() / 1000)): Promise<void> {
  let fingerprint = '';
  let recentCount = 1;
  try {
    fingerprint = await errorFingerprint(record);
    const [, , recent] = await env.DB.batch<{ n: number }>([
      env.DB.prepare(`INSERT INTO system_error_events(occurred_at, fingerprint, method, route, status, error_name, error_message, school_id, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(now, fingerprint, record.method, record.route, record.status, record.error_name, record.error_message, record.school_id, record.user_id),
      env.DB.prepare('DELETE FROM system_error_events WHERE occurred_at < ?').bind(now - ERROR_RETENTION_DAYS * 86_400),
      env.DB.prepare('SELECT COUNT(*) AS n FROM system_error_events WHERE fingerprint = ? AND occurred_at > ?').bind(fingerprint, now - 3600),
    ]);
    recentCount = Number(recent.results?.[0]?.n ?? 1);
  } catch (error) {
    console.error('system error log unavailable', (error as Error)?.message);
  }
  try {
    if (!isTelegramConfigured(env)) return;
    if (!fingerprint) fingerprint = `${record.method} ${record.route}`.slice(0, 64);
    if (!await shouldAlert(env.DB, fingerprint, now)) return;
    await sendTelegram(env, telegramAlertText(record, { environment: env.APP_ENV || 'unknown', recentCount, at: new Date(now * 1000) }));
  } catch {
    // Alert delivery is best-effort.
  }
}

// Schedules recording after the response when the runtime allows it.
export function reportServerError(c: C, status: number, error: unknown): void {
  const user = c.get('user');
  const record = errorRecord({ method: c.req.method, path: c.req.path, status, error, schoolId: user?.school_id ?? null, userId: user?.id ?? null });
  const task = recordServerError(c.env, record);
  try { c.executionCtx.waitUntil(task); } catch { void task; }
}

function requireSystemAdmin(c: C): Response | null {
  const user = c.get('user');
  if (!user) return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
  if (user.role_key !== 'system_admin') return c.json({ error: 'غير مسموح: صحة النظام لمدير النظام فقط' }, 403);
  return null;
}

export function registerSystemHealthRoutes(app: Hono<Env>): void {
  // Public uptime probe: says only whether the Worker can reach its database.
  app.get('/api/health', async c => {
    try {
      await c.env.DB.prepare('SELECT 1').first();
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'error' }, 503);
    }
  });

  app.get('/api/system/health', async c => {
    const denied = requireSystemAdmin(c);
    if (denied) return denied;
    const started = Date.now();
    const now = Math.floor(started / 1000);
    const db = c.env.DB;
    const [day, week] = await db.batch<any>([
      db.prepare('SELECT COUNT(*) AS n FROM system_error_events WHERE occurred_at > ?').bind(now - 86_400),
      db.prepare('SELECT COUNT(*) AS n FROM system_error_events WHERE occurred_at > ?').bind(now - 7 * 86_400),
    ]);
    const latency = Date.now() - started;
    // d1_migrations exists only where Wrangler applied migrations; report null elsewhere.
    const migrations = await db.prepare('SELECT COUNT(*) AS applied, MAX(name) AS last FROM d1_migrations').first().catch(() => null);
    return c.json({ data: {
      environment: c.env.APP_ENV || 'unknown',
      database: { status: 'ok', latency_ms: latency },
      migrations,
      errors_24h: Number(day.results?.[0]?.n ?? 0),
      errors_7d: Number(week.results?.[0]?.n ?? 0),
      telegram_configured: isTelegramConfigured(c.env),
      checked_at: new Date(started).toISOString(),
    } });
  });

  app.get('/api/system/errors', async c => {
    const denied = requireSystemAdmin(c);
    if (denied) return denied;
    const days = Number(c.req.query('days') || 7);
    if (!Number.isInteger(days) || days < 1 || days > ERROR_RETENTION_DAYS) return c.json({ error: 'عدد الأيام غير صالح' }, 400);
    const since = Math.floor(Date.now() / 1000) - days * 86_400;
    const rows = await c.env.DB.prepare(`
      SELECT e.fingerprint, e.method, e.route, e.status, latest.error_name, latest.error_message,
        COUNT(*) AS occurrences, MIN(e.occurred_at) AS first_seen, MAX(e.occurred_at) AS last_seen,
        COUNT(DISTINCT e.school_id) AS schools
      FROM system_error_events e
      JOIN system_error_events latest ON latest.id = (
        SELECT id FROM system_error_events WHERE fingerprint = e.fingerprint ORDER BY occurred_at DESC, id DESC LIMIT 1)
      WHERE e.occurred_at > ?
      GROUP BY e.fingerprint
      ORDER BY last_seen DESC
      LIMIT 100
    `).bind(since).all();
    return c.json({ data: rows.results ?? [] });
  });

  app.post('/api/system/alerts/test', async c => {
    const denied = requireSystemAdmin(c);
    if (denied) return denied;
    if (!isTelegramConfigured(c.env)) {
      return c.json({ error: 'تنبيهات Telegram غير مهيأة: أضف TELEGRAM_BOT_TOKEN وTELEGRAM_CHAT_ID كأسرار للمشروع', code: 'telegram_not_configured' }, 400);
    }
    const sent = await sendTelegram(c.env, `✅ اختبار تنبيهات Smart School (${c.env.APP_ENV || 'unknown'}) — ${new Date().toISOString()}`);
    if (!sent) return c.json({ error: 'تعذر إرسال رسالة Telegram؛ تحقق من التوكن ومعرّف المحادثة', code: 'telegram_send_failed' }, 502);
    return c.json({ data: { sent: true } });
  });
}
