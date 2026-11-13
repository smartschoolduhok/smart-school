import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { businessDate } from './businessTime';
import {
  SCHOOL_MODULES, SCHOOL_MODULE_KEYS, SUBSCRIPTION_PLANS, SubscriptionValidationError, effectiveModules,
  normalizeOverrides, parseSubscriptionUpdate, subscriptionAccessState,
  type ModuleOverrides, type SchoolAccess, type SchoolModuleKey, type SchoolSubscriptionRow, type SubscriptionPlanKey,
} from './schoolSubscriptions';

type Env = { Bindings: Bindings; Variables: Variables };
type C = Context<Env>;

export type SchoolAccessColumns = {
  sub_plan_key: SubscriptionPlanKey | null;
  sub_status: 'active' | 'suspended' | null;
  sub_ends_on: string | null;
  sub_grace_days: number | null;
  sub_overrides: string | null;
};

// Columns to add to a query that LEFT JOINs `school_subscriptions sub`, so the
// authenticated-user lookup also returns the school's access in the same query.
export function schoolAccessColumnsSql(schoolIdExpr: string): string {
  return `sub.plan_key AS sub_plan_key, sub.status AS sub_status, sub.ends_on AS sub_ends_on, sub.grace_days AS sub_grace_days,
    (SELECT json_group_object(o.module_key, o.is_enabled) FROM school_module_overrides o WHERE o.school_id = ${schoolIdExpr}) AS sub_overrides`;
}

// A database that has not received migration 0061 yet: callers fall back to
// no restriction, so deploying the code before the migration never locks schools out.
export function isMissingSubscriptionSchema(error: unknown): boolean {
  return /no such table: (school_subscriptions|school_module_overrides)/i.test(String((error as Error)?.message));
}

function parseOverrides(json: string | null): ModuleOverrides {
  const result: ModuleOverrides = {};
  if (!json) return result;
  for (const [key, value] of Object.entries(JSON.parse(json) as Record<string, number>)) {
    if (SCHOOL_MODULE_KEYS.includes(key as SchoolModuleKey)) result[key as SchoolModuleKey] = Number(value) === 1;
  }
  return result;
}

// A school without a subscription row is treated as full and open-ended.
export function schoolAccessFromColumns(schoolId: number, row: SchoolAccessColumns, today = businessDate()): SchoolAccess {
  const plan = row.sub_plan_key ?? 'full';
  const status = row.sub_status ?? 'active';
  const state = subscriptionAccessState({ status, ends_on: row.sub_ends_on, grace_days: row.sub_grace_days ?? 14 }, today);
  return {
    school_id: schoolId,
    plan_key: plan,
    status,
    ends_on: row.sub_ends_on,
    ...state,
    modules: effectiveModules(plan, parseOverrides(row.sub_overrides)),
  };
}

export async function loadSchoolAccess(db: D1Database, schoolId: number, today = businessDate()): Promise<SchoolAccess | null> {
  let row: SchoolAccessColumns | null;
  try {
    row = await db.prepare(`
      SELECT ${schoolAccessColumnsSql('school.id')}
      FROM schools school
      LEFT JOIN school_subscriptions sub ON sub.school_id = school.id
      WHERE school.id = ?
    `).bind(schoolId).first<SchoolAccessColumns>();
  } catch (error) {
    if (isMissingSubscriptionSchema(error)) return null;
    throw error;
  }
  return row ? schoolAccessFromColumns(schoolId, row, today) : null;
}

const catalog = {
  modules: SCHOOL_MODULE_KEYS.map(key => ({ key, label: SCHOOL_MODULES[key].label })),
  plans: Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => ({ key, label: plan.label, modules: plan.modules })),
};

async function subscriptionDetails(db: D1Database, schoolId: number) {
  const [sub, overrides, students, audit] = await db.batch<any>([
    db.prepare('SELECT * FROM school_subscriptions WHERE school_id = ?').bind(schoolId),
    db.prepare('SELECT module_key, is_enabled FROM school_module_overrides WHERE school_id = ? ORDER BY module_key').bind(schoolId),
    db.prepare("SELECT COUNT(*) AS n FROM students WHERE school_id = ? AND status = 'active'").bind(schoolId),
    db.prepare(`
      SELECT a.id, a.before_json, a.after_json, a.created_at, u.full_name AS actor_name
      FROM school_subscription_audit a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.school_id = ? ORDER BY a.id DESC LIMIT 20
    `).bind(schoolId),
  ]);
  const row = (sub.results?.[0] ?? null) as SchoolSubscriptionRow | null;
  const overrideMap: ModuleOverrides = {};
  for (const o of overrides.results ?? []) overrideMap[o.module_key as SchoolModuleKey] = Number(o.is_enabled) === 1;
  const plan = row?.plan_key ?? 'full';
  return {
    subscription: row,
    overrides: overrideMap,
    modules: effectiveModules(plan, overrideMap),
    access: subscriptionAccessState({ status: row?.status ?? 'active', ends_on: row?.ends_on ?? null, grace_days: row?.grace_days ?? 14 }, businessDate()),
    active_students: Number(students.results?.[0]?.n ?? 0),
    audit: audit.results ?? [],
    catalog,
  };
}

function requireSystemAdmin(c: C): Response | null {
  const user = c.get('user');
  if (!user) return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
  if (user.role_key !== 'system_admin') return c.json({ error: 'غير مسموح: إدارة الاشتراكات لمدير النظام فقط' }, 403);
  return null;
}

function schoolIdParam(c: C): number | null {
  const id = Number(c.req.param('id'));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function registerSchoolSubscriptionRoutes(app: Hono<Env>): void {
  app.get('/api/schools/:id/subscription', async c => {
    const denied = requireSystemAdmin(c);
    if (denied) return denied;
    const schoolId = schoolIdParam(c);
    if (!schoolId) return c.json({ error: 'المعرّف غير صالح' }, 400);
    const school = await c.env.DB.prepare('SELECT id FROM schools WHERE id = ?').bind(schoolId).first();
    if (!school) return c.json({ error: 'المدرسة غير موجودة' }, 404);
    return c.json({ data: await subscriptionDetails(c.env.DB, schoolId) });
  });

  app.put('/api/schools/:id/subscription', async c => {
    const denied = requireSystemAdmin(c);
    if (denied) return denied;
    const schoolId = schoolIdParam(c);
    if (!schoolId) return c.json({ error: 'المعرّف غير صالح' }, 400);
    let update;
    try {
      update = parseSubscriptionUpdate(await c.req.json().catch(() => null));
    } catch (error) {
      if (error instanceof SubscriptionValidationError) return c.json({ error: error.message, code: 'invalid_subscription' }, 400);
      throw error;
    }
    const db = c.env.DB;
    const before = await subscriptionDetails(db, schoolId);
    if (!before.subscription) {
      const school = await db.prepare('SELECT id FROM schools WHERE id = ?').bind(schoolId).first();
      if (!school) return c.json({ error: 'المدرسة غير موجودة' }, 404);
      await db.prepare('INSERT OR IGNORE INTO school_subscriptions(school_id) VALUES (?)').bind(schoolId).run();
    }
    const overrides = normalizeOverrides(update.plan_key, update.overrides);
    const after = {
      plan_key: update.plan_key, status: update.status, starts_on: update.starts_on, ends_on: update.ends_on,
      grace_days: update.grace_days, max_students: update.max_students, notes: update.notes, overrides,
    };
    const token = crypto.randomUUID();
    const user = c.get('user');
    try {
      await db.batch([
        db.prepare(`INSERT INTO workflow_write_guards(token, valid)
          SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM school_subscriptions WHERE school_id = ? AND revision = ?) THEN 1 ELSE 0 END`)
          .bind(token, schoolId, update.expected_revision),
        db.prepare(`UPDATE school_subscriptions SET plan_key = ?, status = ?, starts_on = ?, ends_on = ?, grace_days = ?,
            max_students = ?, notes = ?, revision = revision + 1, updated_by_user_id = ?, updated_at = unixepoch()
          WHERE school_id = ?`)
          .bind(update.plan_key, update.status, update.starts_on, update.ends_on, update.grace_days, update.max_students, update.notes, user.id, schoolId),
        db.prepare('DELETE FROM school_module_overrides WHERE school_id = ?').bind(schoolId),
        ...Object.entries(overrides).map(([key, enabled]) => db.prepare(
          'INSERT INTO school_module_overrides(school_id, module_key, is_enabled) VALUES (?, ?, ?)',
        ).bind(schoolId, key, enabled ? 1 : 0)),
        db.prepare('INSERT INTO school_subscription_audit(school_id, actor_user_id, before_json, after_json) VALUES (?, ?, ?, ?)')
          .bind(schoolId, user.id, before.subscription ? JSON.stringify({ ...before.subscription, overrides: before.overrides }) : null, JSON.stringify(after)),
        db.prepare('DELETE FROM workflow_write_guards WHERE token = ?').bind(token),
      ]);
    } catch (error) {
      if (/workflow_write_guard/i.test(String((error as Error)?.message))) {
        return c.json({ error: 'تغيّر الاشتراك من مستخدم آخر؛ أعد تحميله ثم احفظ', code: 'subscription_stale' }, 409);
      }
      throw error;
    }
    return c.json({ data: await subscriptionDetails(db, schoolId) });
  });
}
