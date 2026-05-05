// ===========================================
// Hono Backend - Phase 2 (Security Hardening)
// Cloudflare Pages Worker with D1 Database
// ===========================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

// ===========================================
// Types & Extended Bindings
// ===========================================
type Bindings = {
  DB: D1Database;
}

type RoleKey = 'system_admin' | 'school_owner' | 'principal' | 'vice_principal' | 'teacher' | 'accountant' | 'registrar' | 'parent';

interface UserContext {
  id: number;
  email: string;
  full_name: string;
  role_id: number;
  role_key: RoleKey;
  role_name: string;
  school_id: number | null;
}

type Variables = {
  user: UserContext;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ===========================================
// Helper Functions
// ===========================================

/**
 * Look up user in D1 by email and return a UserContext.
 * Returns null if user not found or inactive.
 */
async function getCurrentUserContext(db: D1Database, email: string): Promise<UserContext | null> {
  const row = await db.prepare(`
    SELECT u.id, u.email, u.full_name, u.role_id, u.school_id,
           r.key AS role_key, r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.email = ? AND u.status = 'active'
  `).bind(email).first<{
    id: number;
    email: string;
    full_name: string;
    role_id: number;
    school_id: number | null;
    role_key: string;
    role_name: string;
  }>();

  if (!row) return null;

  // Validate role_key is known
  const validRoles: RoleKey[] = ['system_admin', 'school_owner', 'principal', 'vice_principal', 'teacher', 'accountant', 'registrar', 'parent'];
  const role_key = validRoles.includes(row.role_key as RoleKey) ? (row.role_key as RoleKey) : 'teacher';

  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role_id: row.role_id,
    role_key,
    role_name: row.role_name || role_key,
    school_id: row.school_id,
  };
}

/**
 * Require authentication. Attach user to context if x-user-email header present.
 * For Phase 1.5→2 transition: if no header, allow anonymous but set user to null.
 * In full Phase 2, enforce header presence.
 */
async function requireAuth(c: any, enforce: boolean = false): Promise<UserContext | null> {
  const email = c.req.header('x-user-email');
  if (!email) {
    if (enforce) {
      c.json({ error: 'غير مصرح: رأس x-user-email مفقود' }, 401);
      return null;
    }
    return null;
  }
  const db = c.env.DB as D1Database;
  const user = await getCurrentUserContext(db, email);
  if (!user && enforce) {
    c.json({ error: 'غير مصرح: المستخدم غير موجود أو غير نشط' }, 401);
    return null;
  }
  if (user) {
    c.set('user', user);
  }
  return user;
}

/**
 * Resolve effective school_id for the request.
 * Rules:
 * - system_admin: can use query param ?school_id to filter, otherwise sees all (null).
 * - principal & other school users: forced to their own school_id; mismatched query param is ignored.
 * - Returns { schoolId, scope } where scope is 'all' | 'single'.
 */
function resolveSchoolScope(user: UserContext | null, querySchoolId: string | null): { schoolId: number | null; scope: 'all' | 'single'; forbidden: boolean } {
  if (!user) {
    // Unauthenticated: if school_id provided, treat as single-school scope for safety
    if (querySchoolId) {
      const id = parseInt(querySchoolId, 10);
      if (!isNaN(id)) return { schoolId: id, scope: 'single', forbidden: false };
    }
    return { schoolId: null, scope: 'all', forbidden: false };
  }

  if (user.role_key === 'system_admin') {
    if (querySchoolId) {
      const id = parseInt(querySchoolId, 10);
      if (!isNaN(id)) return { schoolId: id, scope: 'single', forbidden: false };
    }
    return { schoolId: null, scope: 'all', forbidden: false };
  }

  // Principal or any other school-scoped user
  if (user.school_id == null) {
    // School-scoped role but no school assigned → forbidden
    return { schoolId: null, scope: 'all', forbidden: true };
  }

  if (querySchoolId) {
    const requested = parseInt(querySchoolId, 10);
    if (!isNaN(requested) && requested !== user.school_id) {
      // Mismatched school_id in query → forbidden for principal
      return { schoolId: null, scope: 'all', forbidden: true };
    }
  }

  return { schoolId: user.school_id, scope: 'single', forbidden: false };
}

/**
 * Middleware that enforces the resolved school scope.
 * - If forbidden === true, returns 403 Arabic error immediately.
 * - Otherwise attaches resolvedSchoolId and scope to request context (optional).
 */
function requireSameSchoolOrAdmin() {
  return async (c: any, next: () => Promise<void>) => {
    const user: UserContext | null = c.get('user') || null;
    const querySchoolId = c.req.query('school_id');
    const resolved = resolveSchoolScope(user, querySchoolId);

    if (resolved.forbidden) {
      return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذه المدرسة' }, 403);
    }

    // Attach resolved scope for downstream handlers
    c.set('resolvedSchoolId', resolved.schoolId);
    c.set('scope', resolved.scope);
    await next();
  };
}

// ===========================================
// Middleware: Auth + CORS
// ===========================================

// Enable CORS for API routes
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'x-user-email'],
}))

// Authentication middleware: reads x-user-email, looks up user, attaches to context
app.use('/api/*', async (c, next) => {
  const email = c.req.header('x-user-email');
  if (email) {
    const user = await getCurrentUserContext(c.env.DB, email);
    if (user) {
      c.set('user', user);
    }
  }
  await next();
});

// ===========================================
// Generic scoped-list helper (applies school_id WHERE clause)
// ===========================================
function applySchoolFilter(query: string, resolvedSchoolId: number | null, scope: 'all' | 'single', tableAlias: string = 't'): { sql: string; hasWhere: boolean } {
  if (scope === 'single' && resolvedSchoolId != null) {
    // Need to inject WHERE school_id = ?
    // Heuristic: if query already contains WHERE, append AND; else add WHERE
    const hasWhere = /\bWHERE\b/i.test(query);
    const condition = `${tableAlias}.school_id = ?`;
    if (hasWhere) {
      return { sql: `${query} AND ${condition}`, hasWhere: true };
    } else {
      // Insert before ORDER BY or GROUP BY or at end
      const orderMatch = query.match(/\s+ORDER\s+BY\s+/i);
      const groupMatch = query.match(/\s+GROUP\s+BY\s+/i);
      const insertPos = orderMatch?.index ?? groupMatch?.index ?? query.length;
      const before = query.slice(0, insertPos);
      const after = query.slice(insertPos);
      return { sql: `${before} WHERE ${condition}${after ? ' ' + after.trim() : ''}`, hasWhere: true };
    }
  }
  return { sql: query, hasWhere: /\bWHERE\b/i.test(query) };
}

// ===========================================
// API ROUTES: Schools
// ===========================================
app.get('/api/schools', async (c) => {
  const db = c.env.DB
  try {
    const { results } = await db.prepare(`
      SELECT id, name, logo_url, school_type, city, status,
             created_at, updated_at
      FROM schools
      ORDER BY id
    `).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المدارس', detail: err.message }, 500)
  }
})

app.get('/api/schools/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const school = await db.prepare(`
      SELECT * FROM schools WHERE id = ?
    `).bind(id).first()
    if (!school) return c.json({ error: 'المدرسة غير موجودة' }, 404)
    return c.json({ data: school })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المدرسة', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Users (with RBAC + school_id filtering)
// ===========================================
app.get('/api/users', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const querySchoolId = c.req.query('school_id')

  try {
    let query = `
      SELECT u.id, u.school_id, u.full_name, u.email, u.role_id, u.status,
             u.created_at, u.updated_at,
             r.name as role_name, r.key as role_key,
             s.name as school_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN schools s ON u.school_id = s.id
    `
    const binds: (string | number)[] = []
    const conditions: string[] = []

    if (scope === 'single' && resolvedSchoolId != null) {
      conditions.push('u.school_id = ?')
      binds.push(resolvedSchoolId)
    } else if (querySchoolId) {
      conditions.push('(u.school_id = ? OR u.school_id IS NULL)')
      binds.push(querySchoolId)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }

    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المستخدمين', detail: err.message }, 500)
  }
})

app.get('/api/users/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const user: UserContext | null = c.get('user') || null
  try {
    const row = await db.prepare(`
      SELECT u.*, r.name as role_name, r.key as role_key, s.name as school_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN schools s ON u.school_id = s.id
      WHERE u.id = ?
    `).bind(id).first()
    if (!row) return c.json({ error: 'المستخدم غير موجود' }, 404)

    // RBAC: non-admin can only view users of same school
    if (user && user.role_key !== 'system_admin') {
      if (row.school_id !== user.school_id) {
        return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذا المستخدم' }, 403)
      }
    }

    return c.json({ data: row })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المستخدم', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Roles
// ===========================================
app.get('/api/roles', async (c) => {
  const db = c.env.DB
  try {
    const { results } = await db.prepare(`
      SELECT id, key, name, description, is_system, created_at
      FROM roles
      ORDER BY id
    `).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الأدوار', detail: err.message }, 500)
  }
})

app.get('/api/roles/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const role = await db.prepare(`
      SELECT * FROM roles WHERE id = ?
    `).bind(id).first()
    if (!role) return c.json({ error: 'الدور غير موجود' }, 404)
    return c.json({ data: role })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الدور', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Role Permissions
// ===========================================
app.get('/api/role-permissions', async (c) => {
  const db = c.env.DB
  try {
    const { results } = await db.prepare(`
      SELECT rp.role_id, rp.permission_id,
             r.key as role_key, r.name as role_name,
             p.key as permission_key, p.name as permission_name, p.resource, p.action
      FROM role_permissions rp
      JOIN roles r ON rp.role_id = r.id
      JOIN permissions p ON rp.permission_id = p.id
    `).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الصلاحيات', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Permissions
// ===========================================
app.get('/api/permissions', async (c) => {
  const db = c.env.DB
  try {
    const { results } = await db.prepare(`
      SELECT id, key, name, description, resource, action, created_at
      FROM permissions
      ORDER BY id
    `).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الصلاحيات', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Modules
// ===========================================
app.get('/api/modules', async (c) => {
  const db = c.env.DB
  try {
    const { results } = await db.prepare(`
      SELECT id, key, name, description, status, is_core, created_at
      FROM modules
      ORDER BY id
    `).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الموديلات', detail: err.message }, 500)
  }
})

app.get('/api/modules/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  try {
    const mod = await db.prepare(`
      SELECT * FROM modules WHERE id = ?
    `).bind(id).first()
    if (!mod) return c.json({ error: 'الموديل غير موجود' }, 404)
    return c.json({ data: mod })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الموديل', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: School Modules (with RBAC + school_id filtering)
// ===========================================
app.get('/api/school-modules', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const querySchoolId = c.req.query('school_id')
  try {
    let query = `
      SELECT sm.id, sm.school_id, sm.module_id, sm.is_enabled,
             sm.enabled_at, sm.disabled_at, sm.notes,
             m.key as module_key, m.name as module_name, m.is_core
      FROM school_modules sm
      JOIN modules m ON sm.module_id = m.id
    `
    const binds: (string | number)[] = []
    const conditions: string[] = []

    if (scope === 'single' && resolvedSchoolId != null) {
      conditions.push('sm.school_id = ?')
      binds.push(resolvedSchoolId)
    } else if (querySchoolId) {
      conditions.push('sm.school_id = ?')
      binds.push(querySchoolId)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }

    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب موديلات المدرسة', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Academic Years (with RBAC + school_id filtering)
// ===========================================
app.get('/api/academic-years', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const querySchoolId = c.req.query('school_id')
  try {
    let query = `
      SELECT id, school_id, name, starts_at, ends_at, is_active, created_at
      FROM academic_years
    `
    const binds: (string | number)[] = []
    const conditions: string[] = []

    if (scope === 'single' && resolvedSchoolId != null) {
      conditions.push('school_id = ?')
      binds.push(resolvedSchoolId)
    } else if (querySchoolId) {
      conditions.push('school_id = ?')
      binds.push(querySchoolId)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }

    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب السنوات الدراسية', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Dashboard Stats (RBAC-aware)
// ===========================================
app.get('/api/dashboard/stats', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  try {
    let schoolFilter = ''
    let schoolBind: number | null = null
    if (scope === 'single' && resolvedSchoolId != null) {
      schoolFilter = 'WHERE school_id = ?'
      schoolBind = resolvedSchoolId
    }

    const activeSchools = await db.prepare(`
      SELECT COUNT(*) as count FROM schools ${schoolFilter ? (schoolFilter.replace('school_id', 'id')) : 'WHERE status = \'active\''}
    `).bind(...(schoolBind ? [schoolBind] : [])).first<{ count: number }>()

    const activeUsers = await db.prepare(`
      SELECT COUNT(*) as count FROM users WHERE status = 'active' ${schoolFilter ? 'AND ' + schoolFilter.replace('WHERE ', '') : ''}
    `).bind(...(schoolBind ? [schoolBind] : [])).first<{ count: number }>()

    const totalUsers = await db.prepare(`
      SELECT COUNT(*) as count FROM users ${schoolFilter || ''}
    `).bind(...(schoolBind ? [schoolBind] : [])).first<{ count: number }>()

    const currentYear = await db.prepare(`
      SELECT name FROM academic_years WHERE is_active = 1 ${schoolFilter ? 'AND ' + schoolFilter.replace('WHERE ', '') : ''} LIMIT 1
    `).bind(...(schoolBind ? [schoolBind] : [])).first<{ name: string }>()

    const totalModules = await db.prepare(`
      SELECT COUNT(*) as count FROM modules WHERE status = 'active'
    `).first<{ count: number }>()

    const coreModules = await db.prepare(`
      SELECT COUNT(*) as count FROM modules WHERE is_core = 1 AND status = 'active'
    `).first<{ count: number }>()

    return c.json({
      data: {
        active_schools: activeSchools?.count || 0,
        active_users: activeUsers?.count || 0,
        total_users: totalUsers?.count || 0,
        current_academic_year: currentYear?.name || '---',
        total_modules: totalModules?.count || 0,
        core_modules: coreModules?.count || 0,
      }
    })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الإحصائيات', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Classes (with RBAC + school_id filtering)
// ===========================================
app.get('/api/classes', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  try {
    let query = `
      SELECT c.*,
        (SELECT COUNT(*) FROM sections WHERE class_id = c.id) as sections_count,
        (SELECT COUNT(*) FROM students WHERE class_id = c.id AND status = 'active') as students_count
      FROM classes c
    `
    const binds: (string | number)[] = []
    if (scope === 'single' && resolvedSchoolId != null) {
      query += ` WHERE c.school_id = ?`
      binds.push(resolvedSchoolId)
    }
    query += ` ORDER BY c.order_index, c.id`
    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الصفوف', detail: err.message }, 500)
  }
})

app.post('/api/classes', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  try {
    const body = await c.req.json()
    let { school_id, name, stage, order_index } = body

    // Ignore frontend-supplied school_id for non-admin; force resolved school
    if (scope === 'single' && resolvedSchoolId != null) {
      school_id = resolvedSchoolId
    }

    if (!school_id || !name || !stage) {
      return c.json({ error: 'المدرسة والاسم والمرحلة مطلوبة' }, 400)
    }

    // RBAC: non-admin cannot create for another school
    if (user && user.role_key !== 'system_admin' && school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك إنشاء صف في مدرسة أخرى' }, 403)
    }

    const result = await db.prepare(`
      INSERT INTO classes (school_id, name, stage, order_index, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).bind(school_id, name, stage, order_index || 0).run()
    return c.json({ data: { id: result.meta.last_row_id, school_id, name, stage, order_index: order_index || 0, status: 'active' } }, 201)
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الصف', detail: err.message }, 500)
  }
})

app.put('/api/classes/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const { name, stage, order_index, status } = body

    // Verify ownership before update
    const existing = await db.prepare(`SELECT school_id FROM classes WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'الصف غير موجود' }, 404)
    if (user && user.role_key !== 'system_admin' && existing.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل صف في مدرسة أخرى' }, 403)
    }

    await db.prepare(`
      UPDATE classes SET name = ?, stage = ?, order_index = ?, status = ?, updated_at = unixepoch()
      WHERE id = ?
    `).bind(name, stage, order_index || 0, status || 'active', id).run()
    return c.json({ data: { id, name, stage, order_index, status } })
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الصف', detail: err.message }, 500)
  }
})

app.put('/api/classes/:id/archive', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    // Verify ownership before archive
    const existing = await db.prepare(`SELECT school_id FROM classes WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'الصف غير موجود' }, 404)
    if (user && user.role_key !== 'system_admin' && existing.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك أرشفة صف في مدرسة أخرى' }, 403)
    }

    // Check if class has active students
    const students = await db.prepare(`SELECT COUNT(*) as count FROM students WHERE class_id = ? AND status = 'active'`).bind(id).first<{ count: number }>()
    if (students && students.count > 0) {
      return c.json({ error: 'لا يمكن أرشفة الصف لأنه يحتوي على طلاب نشطين', detail: `عدد الطلاب: ${students.count}` }, 400)
    }
    await db.prepare(`UPDATE classes SET status = 'archived', updated_at = unixepoch() WHERE id = ?`).bind(id).run()
    return c.json({ data: { id, status: 'archived' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة الصف', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Sections (with RBAC + school_id filtering)
// ===========================================
app.get('/api/sections', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const classId = c.req.query('class_id')
  try {
    let query = `
      SELECT s.*, c.name as class_name,
        (SELECT COUNT(*) FROM students WHERE section_id = s.id AND status = 'active') as students_count
      FROM sections s
      JOIN classes c ON s.class_id = c.id
    `
    const conditions: string[] = []
    const binds: (string | number)[] = []
    if (scope === 'single' && resolvedSchoolId != null) { conditions.push('s.school_id = ?'); binds.push(resolvedSchoolId) }
    if (classId) { conditions.push('s.class_id = ?'); binds.push(classId) }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }
    query += ` ORDER BY c.order_index, s.id`
    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الشعب', detail: err.message }, 500)
  }
})

app.post('/api/sections', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  try {
    const body = await c.req.json()
    let { school_id, class_id, name, capacity } = body

    if (scope === 'single' && resolvedSchoolId != null) {
      school_id = resolvedSchoolId
    }

    if (!school_id || !class_id || !name) {
      return c.json({ error: 'المدرسة والصف والاسم مطلوبة' }, 400)
    }

    if (user && user.role_key !== 'system_admin' && school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك إنشاء شعبة في مدرسة أخرى' }, 403)
    }

    // Verify class belongs to same school
    const cls = await db.prepare(`SELECT school_id FROM classes WHERE id = ?`).bind(class_id).first<{ school_id: number }>()
    if (!cls) return c.json({ error: 'الصف غير موجود' }, 404)
    if (user && user.role_key !== 'system_admin' && cls.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: الصف لا ينتمي إلى مدرستك' }, 403)
    }

    const result = await db.prepare(`
      INSERT INTO sections (school_id, class_id, name, capacity, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).bind(school_id, class_id, name, capacity || 30).run()
    return c.json({ data: { id: result.meta.last_row_id, school_id, class_id, name, capacity: capacity || 30, status: 'active' } }, 201)
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الشعبة', detail: err.message }, 500)
  }
})

app.put('/api/sections/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const { class_id, name, capacity, status } = body

    const existing = await db.prepare(`SELECT school_id, class_id FROM sections WHERE id = ?`).bind(id).first<{ school_id: number; class_id: number }>()
    if (!existing) return c.json({ error: 'الشعبة غير موجودة' }, 404)
    if (user && user.role_key !== 'system_admin' && existing.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل شعبة في مدرسة أخرى' }, 403)
    }

    if (class_id && class_id !== existing.class_id) {
      const cls = await db.prepare(`SELECT school_id FROM classes WHERE id = ?`).bind(class_id).first<{ school_id: number }>()
      if (!cls) return c.json({ error: 'الصف غير موجود' }, 404)
      if (user && user.role_key !== 'system_admin' && cls.school_id !== user.school_id) {
        return c.json({ error: 'غير مسموح: الصف لا ينتمي إلى مدرستك' }, 403)
      }
    }

    await db.prepare(`
      UPDATE sections SET class_id = ?, name = ?, capacity = ?, status = ?, updated_at = unixepoch()
      WHERE id = ?
    `).bind(class_id, name, capacity || 30, status || 'active', id).run()
    return c.json({ data: { id, class_id, name, capacity, status } })
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الشعبة', detail: err.message }, 500)
  }
})

app.put('/api/sections/:id/archive', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const existing = await db.prepare(`SELECT school_id FROM sections WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'الشعبة غير موجودة' }, 404)
    if (user && user.role_key !== 'system_admin' && existing.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك أرشفة شعبة في مدرسة أخرى' }, 403)
    }

    const students = await db.prepare(`SELECT COUNT(*) as count FROM students WHERE section_id = ? AND status = 'active'`).bind(id).first<{ count: number }>()
    if (students && students.count > 0) {
      return c.json({ error: 'لا يمكن أرشفة الشعبة لأنها تحتوي على طلاب نشطين', detail: `عدد الطلاب: ${students.count}` }, 400)
    }
    await db.prepare(`UPDATE sections SET status = 'archived', updated_at = unixepoch() WHERE id = ?`).bind(id).run()
    return c.json({ data: { id, status: 'archived' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة الشعبة', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Students (with RBAC + school_id filtering)
// ===========================================
app.get('/api/students', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const classId = c.req.query('class_id')
  const sectionId = c.req.query('section_id')
  try {
    let query = `
      SELECT st.*, c.name as class_name, s.name as section_name
      FROM students st
      LEFT JOIN classes c ON st.class_id = c.id
      LEFT JOIN sections s ON st.section_id = s.id
    `
    const conditions: string[] = []
    const binds: (string | number)[] = []
    if (scope === 'single' && resolvedSchoolId != null) { conditions.push('st.school_id = ?'); binds.push(resolvedSchoolId) }
    if (classId) { conditions.push('st.class_id = ?'); binds.push(classId) }
    if (sectionId) { conditions.push('st.section_id = ?'); binds.push(sectionId) }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }
    query += ` ORDER BY st.class_id, st.section_id, st.full_name`
    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الطلاب', detail: err.message }, 500)
  }
})

app.get('/api/students/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  const user: UserContext | null = c.get('user') || null
  try {
    const student = await db.prepare(`
      SELECT st.*, c.name as class_name, s.name as section_name
      FROM students st
      LEFT JOIN classes c ON st.class_id = c.id
      LEFT JOIN sections s ON st.section_id = s.id
      WHERE st.id = ?
    `).bind(id).first()
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404)

    // RBAC
    if (user && user.role_key !== 'system_admin') {
      if (student.school_id !== user.school_id) {
        return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذا الطالب' }, 403)
      }
    }

    return c.json({ data: student })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب بيانات الطالب', detail: err.message }, 500)
  }
})

app.post('/api/students', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  try {
    const body = await c.req.json()
    let {
      school_id, student_number, full_name, father_name, mother_name,
      gender, birth_date, phone, guardian_name, guardian_phone,
      address, class_id, section_id, photo_url, notes
    } = body

    if (scope === 'single' && resolvedSchoolId != null) {
      school_id = resolvedSchoolId
    }

    if (!school_id || !student_number || !full_name || !gender) {
      return c.json({ error: 'المدرسة ورقم الطالب والاسم والجنس مطلوبة' }, 400)
    }

    if (user && user.role_key !== 'system_admin' && school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك إنشاء طالب في مدرسة أخرى' }, 403)
    }

    const result = await db.prepare(`
      INSERT INTO students (
        school_id, student_number, full_name, father_name, mother_name,
        gender, birth_date, phone, guardian_name, guardian_phone,
        address, class_id, section_id, status, photo_url, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, unixepoch(), unixepoch())
    `).bind(
      school_id, student_number, full_name, father_name || null, mother_name || null,
      gender, birth_date || null, phone || null, guardian_name || null, guardian_phone || null,
      address || null, class_id || null, section_id || null, photo_url || null, notes || null
    ).run()
    return c.json({ data: { id: result.meta.last_row_id, school_id, student_number, full_name, status: 'active' } }, 201)
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الطالب', detail: err.message }, 500)
  }
})

app.put('/api/students/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json()

    const existing = await db.prepare(`SELECT * FROM students WHERE id = ?`).bind(id).first<{
      school_id: number; student_number: string; full_name: string; father_name: string | null; mother_name: string | null;
      gender: string; birth_date: string | null; phone: string | null; guardian_name: string | null; guardian_phone: string | null;
      address: string | null; class_id: number | null; section_id: number | null; photo_url: string | null; notes: string | null; status: string;
    }>()
    if (!existing) return c.json({ error: 'الطالب غير موجود' }, 404)
    if (user && user.role_key !== 'system_admin' && existing.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل طالب في مدرسة أخرى' }, 403)
    }

    // Merge partial update with existing record
    const student_number = body.student_number ?? existing.student_number
    const full_name = body.full_name ?? existing.full_name
    const father_name = body.father_name !== undefined ? body.father_name : existing.father_name
    const mother_name = body.mother_name !== undefined ? body.mother_name : existing.mother_name
    const gender = body.gender ?? existing.gender
    const birth_date = body.birth_date !== undefined ? body.birth_date : existing.birth_date
    const phone = body.phone !== undefined ? body.phone : existing.phone
    const guardian_name = body.guardian_name !== undefined ? body.guardian_name : existing.guardian_name
    const guardian_phone = body.guardian_phone !== undefined ? body.guardian_phone : existing.guardian_phone
    const address = body.address !== undefined ? body.address : existing.address
    const class_id = body.class_id !== undefined ? body.class_id : existing.class_id
    const section_id = body.section_id !== undefined ? body.section_id : existing.section_id
    const photo_url = body.photo_url !== undefined ? body.photo_url : existing.photo_url
    const notes = body.notes !== undefined ? body.notes : existing.notes
    const status = body.status ?? existing.status

    await db.prepare(`
      UPDATE students SET
        student_number = ?, full_name = ?, father_name = ?, mother_name = ?,
        gender = ?, birth_date = ?, phone = ?, guardian_name = ?, guardian_phone = ?,
        address = ?, class_id = ?, section_id = ?, photo_url = ?, notes = ?, status = ?,
        updated_at = unixepoch()
      WHERE id = ?
    `).bind(
      student_number, full_name, father_name, mother_name,
      gender, birth_date, phone, guardian_name, guardian_phone,
      address, class_id, section_id, photo_url, notes, status, id
    ).run()
    return c.json({ data: { id, student_number, full_name, status } })
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث بيانات الطالب', detail: err.message }, 500)
  }
})

app.put('/api/students/:id/archive', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const existing = await db.prepare(`SELECT school_id FROM students WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'الطالب غير موجود' }, 404)
    if (user && user.role_key !== 'system_admin' && existing.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك أرشفة طالب في مدرسة أخرى' }, 403)
    }

    await db.prepare(`UPDATE students SET status = 'archived', updated_at = unixepoch() WHERE id = ?`).bind(id).run()
    return c.json({ data: { id, status: 'archived' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة الطالب', detail: err.message }, 500)
  }
})

// ===========================================
// API ROUTES: Subjects (with RBAC + school_id filtering)
// ===========================================
app.get('/api/subjects', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  const classId = c.req.query('class_id')
  const sectionId = c.req.query('section_id')
  try {
    let query = `
      SELECT sb.*, c.name as class_name, s.name as section_name
      FROM subjects sb
      JOIN classes c ON sb.class_id = c.id
      LEFT JOIN sections s ON sb.section_id = s.id
    `
    const conditions: string[] = []
    const binds: (string | number)[] = []
    if (scope === 'single' && resolvedSchoolId != null) { conditions.push('sb.school_id = ?'); binds.push(resolvedSchoolId) }
    if (classId) { conditions.push('sb.class_id = ?'); binds.push(classId) }
    if (sectionId) { conditions.push('sb.section_id = ?'); binds.push(sectionId) }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }
    query += ` ORDER BY c.order_index, sb.order_index, sb.id`
    const { results } = await db.prepare(query).bind(...binds).all()
    return c.json({ data: results || [] })
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المواد', detail: err.message }, 500)
  }
})

app.post('/api/subjects', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId')
  const scope: 'all' | 'single' = c.get('scope')
  try {
    const body = await c.req.json()
    let {
      school_id, class_id, section_id, name, subject_type,
      counts_in_average, appears_in_report_card,
      passing_grade, exemption_grade, order_index
    } = body

    if (scope === 'single' && resolvedSchoolId != null) {
      school_id = resolvedSchoolId
    }

    if (!school_id || !class_id || !name) {
      return c.json({ error: 'المدرسة والصف واسم المادة مطلوبة' }, 400)
    }

    if (user && user.role_key !== 'system_admin' && school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك إنشاء مادة في مدرسة أخرى' }, 403)
    }

    // Verify class belongs to same school
    const cls = await db.prepare(`SELECT school_id FROM classes WHERE id = ?`).bind(class_id).first<{ school_id: number }>()
    if (!cls) return c.json({ error: 'الصف غير موجود' }, 404)
    if (user && user.role_key !== 'system_admin' && cls.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: الصف لا ينتمي إلى مدرستك' }, 403)
    }

    const result = await db.prepare(`
      INSERT INTO subjects (
        school_id, class_id, section_id, name, subject_type,
        counts_in_average, appears_in_report_card,
        passing_grade, exemption_grade, order_index,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).bind(
      school_id, class_id, section_id || null, name, subject_type || 'أساسية',
      counts_in_average !== undefined ? (counts_in_average ? 1 : 0) : 1,
      appears_in_report_card !== undefined ? (appears_in_report_card ? 1 : 0) : 1,
      passing_grade || 50, exemption_grade || 25, order_index || 0
    ).run()
    return c.json({ data: { id: result.meta.last_row_id, school_id, class_id, name, status: 'active' } }, 201)
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء المادة', detail: err.message }, 500)
  }
})

app.put('/api/subjects/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const body = await c.req.json()
    const {
      class_id, section_id, name, subject_type,
      counts_in_average, appears_in_report_card,
      passing_grade, exemption_grade, order_index, status
    } = body

    const existing = await db.prepare(`SELECT school_id, class_id FROM subjects WHERE id = ?`).bind(id).first<{ school_id: number; class_id: number }>()
    if (!existing) return c.json({ error: 'المادة غير موجودة' }, 404)
    if (user && user.role_key !== 'system_admin' && existing.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل مادة في مدرسة أخرى' }, 403)
    }

    if (class_id && class_id !== existing.class_id) {
      const cls = await db.prepare(`SELECT school_id FROM classes WHERE id = ?`).bind(class_id).first<{ school_id: number }>()
      if (!cls) return c.json({ error: 'الصف غير موجود' }, 404)
      if (user && user.role_key !== 'system_admin' && cls.school_id !== user.school_id) {
        return c.json({ error: 'غير مسموح: الصف لا ينتمي إلى مدرستك' }, 403)
      }
    }

    await db.prepare(`
      UPDATE subjects SET
        class_id = ?, section_id = ?, name = ?, subject_type = ?,
        counts_in_average = ?, appears_in_report_card = ?,
        passing_grade = ?, exemption_grade = ?, order_index = ?, status = ?,
        updated_at = unixepoch()
      WHERE id = ?
    `).bind(
      class_id, section_id || null, name, subject_type || 'أساسية',
      counts_in_average !== undefined ? (counts_in_average ? 1 : 0) : 1,
      appears_in_report_card !== undefined ? (appears_in_report_card ? 1 : 0) : 1,
      passing_grade || 50, exemption_grade || 25, order_index || 0, status || 'active', id
    ).run()
    return c.json({ data: { id, name, status: status || 'active' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث المادة', detail: err.message }, 500)
  }
})

app.put('/api/subjects/:id/archive', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB
  const user: UserContext | null = c.get('user') || null
  const id = c.req.param('id')
  try {
    const existing = await db.prepare(`SELECT school_id FROM subjects WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'المادة غير موجودة' }, 404)
    if (user && user.role_key !== 'system_admin' && existing.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك أرشفة مادة في مدرسة أخرى' }, 403)
    }

    await db.prepare(`UPDATE subjects SET status = 'archived', updated_at = unixepoch() WHERE id = ?`).bind(id).run()
    return c.json({ data: { id, status: 'archived' } })
  } catch (err: any) {
    return c.json({ error: 'فشل في أرشفة المادة', detail: err.message }, 500)
  }
})

// ===========================================
// Serve static files (assets, static)
// ===========================================
app.use('/assets/*', serveStatic({ root: './' }))
app.use('/static/*', serveStatic({ root: './' }))

// ===========================================
// SPA Fallback: serve index.html for all non-API routes
// ===========================================
app.get('/*', async (c) => {
  try {
    const html = await c.env.ASSETS.fetch(new URL('/index.html', c.req.url))
    if (html.status === 200) {
      return new Response(html.body, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }
  } catch (e) {
    // fallback below
  }
  // Direct fallback if ASSETS binding isn't available
  return c.html(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>نظام المدرسة الذكي</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script type="module" crossorigin src="/assets/main-Bq_OpL6C.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/main-X0FolEOP.css">
</head>
<body>
  <div id="root"></div>
</body>
</html>`)
})

export default app
