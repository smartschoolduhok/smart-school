// ===========================================
// Hono Backend - Phase 2.6 (Auth Hardening)
// Cloudflare Pages Worker with D1 Database
// JWT Bearer Token Authentication via Web Crypto
// ===========================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

// ===========================================
// Types & Extended Bindings
// ===========================================

declare global {
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
  }
  interface D1PreparedStatement {
    bind(...values: any[]): D1PreparedStatement;
    first<T = any>(): Promise<T | null>;
    all<T = any>(): Promise<{ results?: T[]; success: boolean; meta?: any }>;
    run(): Promise<{ success: boolean; meta?: any; results?: any }>;
  }
}

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  ASSETS?: { fetch(url: URL): Promise<{ status: number; body: ReadableStream | null }> };
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
  resolvedSchoolId: number | null;
  scope: 'all' | 'single';
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ===========================================
// JWT Utilities (Web Crypto API - Worker Safe)
// ===========================================

function encodeBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(str: string): ArrayBuffer {
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function stringToBuffer(str: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(str).buffer;
}

function bufferToString(buf: ArrayBuffer): string {
  const decoder = new TextDecoder();
  return decoder.decode(buf);
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    stringToBuffer(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signJWT(payload: object, secret: string, expiresInSeconds: number = 86400): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const headerB64 = encodeBase64Url(stringToBuffer(JSON.stringify(header)));
  const payloadB64 = encodeBase64Url(stringToBuffer(JSON.stringify(fullPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, stringToBuffer(signingInput));
  const signatureB64 = encodeBase64Url(signature);
  return `${signingInput}.${signatureB64}`;
}

async function verifyJWT(token: string, secret: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await importKey(secret);
    const signature = decodeBase64Url(signatureB64);
    const valid = await crypto.subtle.verify('HMAC', key, signature, stringToBuffer(signingInput));
    if (!valid) return null;
    const payload = JSON.parse(bufferToString(decodeBase64Url(payloadB64)));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hashPassword(password: string, email: string): Promise<string> {
  const salt = 'smart-school-salt-2026';
  const data = stringToBuffer(password + salt + email);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ===========================================
// Helper Functions
// ===========================================

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

async function requireAuth(c: any, enforce: boolean = false): Promise<UserContext | null> {
  const token = extractBearerToken(c);
  if (!token) {
    if (enforce) {
      return c.json({ error: 'غير مصرح: رمز المصادقة مفقود' }, 401);
    }
    return null;
  }
  const secret = c.env.JWT_SECRET || 'default-dev-secret-change-me';
  const payload = await verifyJWT(token, secret);
  if (!payload || !payload.email) {
    if (enforce) {
      return c.json({ error: 'غير مصرح: رمز غير صالح أو منتهي الصلاحية' }, 401);
    }
    return null;
  }
  const db = c.env.DB as D1Database;
  const user = await getCurrentUserContext(db, payload.email);
  if (!user && enforce) {
    return c.json({ error: 'غير مصرح: المستخدم غير موجود أو غير نشط' }, 401);
  }
  if (user) {
    c.set('user', user);
  }
  return user;
}

function extractBearerToken(c: any): string | null {
  const auth = c.req.header('Authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function resolveSchoolScope(user: UserContext | null, querySchoolId: string | null): { schoolId: number | null; scope: 'all' | 'single'; forbidden: boolean } {
  if (!user) {
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

  if (user.school_id == null) {
    return { schoolId: null, scope: 'all', forbidden: true };
  }

  if (querySchoolId) {
    const requested = parseInt(querySchoolId, 10);
    if (!isNaN(requested) && requested !== user.school_id) {
      return { schoolId: null, scope: 'all', forbidden: true };
    }
  }

  return { schoolId: user.school_id, scope: 'single', forbidden: false };
}

function requireAuthEnforced() {
  return async (c: any, next: () => Promise<void>) => {
    const user: UserContext | null = c.get('user') || null;
    if (!user) {
      return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
    }
    await next();
  };
}

function requireSameSchoolOrAdmin() {
  return async (c: any, next: () => Promise<void>) => {
    const user: UserContext | null = c.get('user') || null;
    if (!user) {
      return c.json({ error: 'غير مسموح: يجب تسجيل الدخول أولاً' }, 401);
    }

    const querySchoolId = c.req.query('school_id');
    const resolved = resolveSchoolScope(user, querySchoolId);

    if (resolved.forbidden) {
      return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذه المدرسة' }, 403);
    }

    c.set('resolvedSchoolId', resolved.schoolId);
    c.set('scope', resolved.scope);
    await next();
  };
}

// ===========================================
// Middleware: CORS + JWT Auth
// ===========================================

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// JWT Authentication middleware
app.use('/api/*', async (c, next) => {
  const token = extractBearerToken(c);
  if (token) {
    const secret = c.env.JWT_SECRET || 'default-dev-secret-change-me';
    const payload = await verifyJWT(token, secret);
    if (payload && payload.email) {
      const blacklisted = await c.env.DB.prepare('SELECT id FROM token_blacklist WHERE token = ?').bind(token).first();
      if (!blacklisted) {
        const user = await getCurrentUserContext(c.env.DB, payload.email);
        if (user) {
          c.set('user', user);
        }
      }
    }
  }
  await next();
});

// ===========================================
// API ROUTES: Authentication
// ===========================================

app.post('/api/auth/login', async (c) => {
  const db = c.env.DB
  try {
    const body = await c.req.json()
    const { email, password } = body
    if (!email || !password) {
      return c.json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبة' }, 400)
    }

    // Pre-check for inactive users to return clear message
    const inactiveCheck = await db.prepare(`SELECT id, status FROM users WHERE email = ?`).bind(email).first<{ id: number; status: string }>();
    if (inactiveCheck && inactiveCheck.status !== 'active') {
      return c.json({ error: 'هذا الحساب غير فعال، يرجى التواصل مع الإدارة' }, 403);
    }

    const row = await db.prepare(`
      SELECT u.id, u.email, u.full_name, u.role_id, u.school_id, u.password_hash,
             r.key AS role_key, r.name AS role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email = ? AND u.status = 'active'
    `).bind(email).first<{
      id: number; email: string; full_name: string; role_id: number; school_id: number | null;
      password_hash: string | null; role_key: string; role_name: string;
    }>()

    if (!row) {
      return c.json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' }, 401)
    }

    const computedHash = await hashPassword(password, email)
    const storedHash = row.password_hash || ''
    if (computedHash !== storedHash) {
      return c.json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' }, 401)
    }

    const secret = c.env.JWT_SECRET || 'default-dev-secret-change-me'
    const token = await signJWT(
      { id: row.id, email: row.email, role_key: row.role_key, school_id: row.school_id },
      secret,
      86400
    )

    return c.json({
      data: {
        token,
        user: {
          id: row.id,
          full_name: row.full_name,
          email: row.email,
          role_id: row.role_id,
          role_key: row.role_key,
          role_name: row.role_name,
          school_id: row.school_id,
        },
      },
    })
  } catch (err: any) {
    return c.json({ error: 'فشل في تسجيل الدخول', detail: err.message }, 500)
  }
})

app.get('/api/auth/me', async (c) => {
  const user: UserContext | null = c.get('user') || null
  if (!user) {
    return c.json({ error: 'غير مصرح' }, 401)
  }
  return c.json({ data: user })
})

app.post('/api/auth/logout', async (c) => {
  const token = extractBearerToken(c);
  if (token) {
    const secret = c.env.JWT_SECRET || 'default-dev-secret-change-me';
    const payload = await verifyJWT(token, secret);
    if (payload && payload.exp) {
      await c.env.DB.prepare('INSERT INTO token_blacklist (token, expires_at) VALUES (?, ?)').bind(token, payload.exp).run();
    } else {
      await c.env.DB.prepare('INSERT INTO token_blacklist (token) VALUES (?)').bind(token).run();
    }
  }
  return c.json({ data: { success: true } });
});

// ===========================================
// Generic scoped-list helper
// ===========================================
function applySchoolFilter(query: string, resolvedSchoolId: number | null, scope: 'all' | 'single', tableAlias: string = 't'): { sql: string; hasWhere: boolean } {
  if (scope === 'single' && resolvedSchoolId != null) {
    const hasWhere = /\bWHERE\b/i.test(query);
    const condition = `${tableAlias}.school_id = ?`;
    if (hasWhere) {
      return { sql: `${query} AND ${condition}`, hasWhere: true };
    } else {
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

    if (scope === 'single' && resolvedSchoolId != null) {
      school_id = resolvedSchoolId
    }

    if (!school_id || !name || !stage) {
      return c.json({ error: 'المدرسة والاسم والمرحلة مطلوبة' }, 400)
    }

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
    const existing = await db.prepare(`SELECT school_id FROM classes WHERE id = ?`).bind(id).first<{ school_id: number }>()
    if (!existing) return c.json({ error: 'الصف غير موجود' }, 404)
    if (user && user.role_key !== 'system_admin' && existing.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك أرشفة صف في مدرسة أخرى' }, 403)
    }

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
// API ROUTES: Student Subjects (Phase 3)
// ===========================================

// Helper: verify a student and subject belong to the same school as the user
async function verifyStudentSubjectSchool(
  db: D1Database,
  user: UserContext | null,
  student_id: number,
  subject_id: number
): Promise<{ ok: boolean; school_id?: number; error?: string; status?: number }> {
  const st = await db.prepare('SELECT school_id, class_id, section_id FROM students WHERE id = ?').bind(student_id).first<{ school_id: number; class_id: number | null; section_id: number | null }>();
  const su = await db.prepare('SELECT school_id, class_id, section_id FROM subjects WHERE id = ?').bind(subject_id).first<{ school_id: number; class_id: number | null; section_id: number | null }>();
  if (!st) return { ok: false, error: 'الطالب غير موجود', status: 404 };
  if (!su) return { ok: false, error: 'المادة غير موجودة', status: 404 };
  if (st.school_id !== su.school_id) return { ok: false, error: 'الطالب والمادة لا ينتميان لنفس المدرسة', status: 400 };
  if (user && user.role_key !== 'system_admin' && st.school_id !== user.school_id) {
    return { ok: false, error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذه المدرسة', status: 403 };
  }
  return { ok: true, school_id: st.school_id };
}

// Helper: get current class_id/section_id from student record for assignment
async function getStudentClassSection(db: D1Database, student_id: number) {
  return db.prepare('SELECT class_id, section_id FROM students WHERE id = ?').bind(student_id).first<{ class_id: number | null; section_id: number | null }>();
}

// GET /api/student-subjects - list assignments with filters
app.get('/api/student-subjects', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId');
  const scope: 'all' | 'single' = c.get('scope');
  const qStudent = c.req.query('student_id');
  const qClass = c.req.query('class_id');
  const qSection = c.req.query('section_id');
  const qSubject = c.req.query('subject_id');
  const qActive = c.req.query('is_active');
  try {
    let query = `
      SELECT ss.*,
        st.full_name as student_name, st.student_number,
        su.name as subject_name, su.subject_type, su.counts_in_average, su.appears_in_report_card,
        c.name as class_name, se.name as section_name,
        u.full_name as assigned_by_name
      FROM student_subjects ss
      JOIN students st ON ss.student_id = st.id
      JOIN subjects su ON ss.subject_id = su.id
      LEFT JOIN classes c ON ss.class_id = c.id
      LEFT JOIN sections se ON ss.section_id = se.id
      LEFT JOIN users u ON ss.assigned_by_user_id = u.id
    `;
    const conditions: string[] = [];
    const binds: (string | number)[] = [];
    if (scope === 'single' && resolvedSchoolId != null) { conditions.push('ss.school_id = ?'); binds.push(resolvedSchoolId); }
    if (qStudent) { conditions.push('ss.student_id = ?'); binds.push(qStudent); }
    if (qClass) { conditions.push('ss.class_id = ?'); binds.push(qClass); }
    if (qSection) { conditions.push('ss.section_id = ?'); binds.push(qSection); }
    if (qSubject) { conditions.push('ss.subject_id = ?'); binds.push(qSubject); }
    if (qActive === '1' || qActive === '0') { conditions.push('ss.is_active = ?'); binds.push(Number(qActive)); }
    if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;
    query += ` ORDER BY ss.is_active DESC, ss.assigned_at DESC`;
    const { results } = await db.prepare(query).bind(...binds).all();
    return c.json({ data: results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب تعيينات المواد', detail: err.message }, 500);
  }
});

// GET /api/students/:id/subjects - active subjects for one student
app.get('/api/students/:id/subjects', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const id = Number(c.req.param('id'));
  try {
    const student = await db.prepare('SELECT school_id FROM students WHERE id = ?').bind(id).first<{ school_id: number }>();
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);
    if (user && user.role_key !== 'system_admin' && student.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى بيانات هذا الطالب' }, 403);
    }
    const { results } = await db.prepare(`
      SELECT ss.*, su.name as subject_name, su.subject_type, su.counts_in_average, su.appears_in_report_card, c.name as class_name, se.name as section_name
      FROM student_subjects ss
      JOIN subjects su ON ss.subject_id = su.id
      LEFT JOIN classes c ON ss.class_id = c.id
      LEFT JOIN sections se ON ss.section_id = se.id
      WHERE ss.student_id = ? AND ss.is_active = 1
      ORDER BY su.order_index, su.name
    `).bind(id).all();
    return c.json({ data: results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب مواد الطالب', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/assign-class - assign to all active students in a class
app.post('/api/student-subjects/assign-class', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const resolvedSchoolId: number | null = c.get('resolvedSchoolId');
  try {
    const body = await c.req.json();
    const { class_id, subject_ids } = body;
    if (!class_id) return c.json({ error: 'يجب اختيار الصف' }, 400);
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) return c.json({ error: 'يجب اختيار مادة واحدة على الأقل' }, 400);

    const cls = await db.prepare('SELECT school_id FROM classes WHERE id = ?').bind(class_id).first<{ school_id: number }>();
    if (!cls) return c.json({ error: 'الصف غير موجود' }, 404);
    if (user && user.role_key !== 'system_admin' && cls.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: الصف لا ينتمي إلى مدرستك' }, 403);
    }

    const school_id = cls.school_id;
    const { results: students } = await db.prepare('SELECT id, section_id FROM students WHERE class_id = ? AND status = \'active\'').bind(class_id).all<{ id: number; section_id: number | null }>();
    if (!students || students.length === 0) return c.json({ error: 'لا يوجد طلاب نشطون في هذا الصف' }, 400);

    // Validate all subjects belong to this school and class
    const subjectChecks = await db.prepare(`
      SELECT id, class_id, section_id FROM subjects WHERE id IN (${subject_ids.map(() => '?').join(',')}) AND school_id = ?
    `).bind(...subject_ids, school_id).all<{ id: number; class_id: number | null; section_id: number | null }>();
    const validSubjectIds = new Set((subjectChecks.results || []).map((s) => s.id));
    const mismatchedSubjects = (subjectChecks.results || []).filter((s) => s.class_id != null && String(s.class_id) !== String(class_id));
    if (mismatchedSubjects.length > 0) {
      return c.json({ error: `بعض المواد لا تنتمي لهذا الصف: ${mismatchedSubjects.map((s) => s.id).join(', ')}` }, 400);
    }

    const inserted: number[] = [];
    const skipped: number[] = [];
    for (const st of students) {
      for (const suId of subject_ids) {
        if (!validSubjectIds.has(Number(suId))) { skipped.push(st.id); continue; }
        const existing = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(school_id, st.id, suId).first();
        if (existing) { skipped.push(st.id); continue; }
        await db.prepare(`
          INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch(), unixepoch())
        `).bind(school_id, st.id, suId, class_id, st.section_id || null, user?.id || null).run();
        inserted.push(st.id);
      }
    }
    return c.json({ data: { inserted_count: inserted.length, skipped_count: skipped.length } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تعيين المواد للصف', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/assign-section - assign to all active students in a section
app.post('/api/student-subjects/assign-section', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { section_id, subject_ids } = body;
    if (!section_id) return c.json({ error: 'يجب اختيار الشعبة' }, 400);
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) return c.json({ error: 'يجب اختيار مادة واحدة على الأقل' }, 400);

    const sec = await db.prepare('SELECT school_id, class_id FROM sections WHERE id = ?').bind(section_id).first<{ school_id: number; class_id: number }>();
    if (!sec) return c.json({ error: 'الشعبة غير موجودة' }, 404);
    if (user && user.role_key !== 'system_admin' && sec.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: الشعبة لا تنتمي إلى مدرستك' }, 403);
    }

    const { results: students } = await db.prepare('SELECT id FROM students WHERE section_id = ? AND status = \'active\'').bind(section_id).all<{ id: number }>();
    if (!students || students.length === 0) return c.json({ error: 'لا يوجد طلاب نشطون في هذه الشعبة' }, 400);

    // Validate all subjects belong to this school, class, and section
    const subjectChecks = await db.prepare(`
      SELECT id, class_id, section_id FROM subjects WHERE id IN (${subject_ids.map(() => '?').join(',')}) AND school_id = ?
    `).bind(...subject_ids, sec.school_id).all<{ id: number; class_id: number | null; section_id: number | null }>();
    const validSubjectIds = new Set((subjectChecks.results || []).map((s) => s.id));
    const mismatchedSubjects = (subjectChecks.results || []).filter((s) =>
      (s.class_id != null && String(s.class_id) !== String(sec.class_id)) ||
      (s.section_id != null && String(s.section_id) !== String(section_id))
    );
    if (mismatchedSubjects.length > 0) {
      return c.json({ error: `بعض المواد لا تنتمي لهذه الشعبة: ${mismatchedSubjects.map((s) => s.id).join(', ')}` }, 400);
    }

    const inserted: number[] = [];
    const skipped: number[] = [];
    for (const st of students) {
      for (const suId of subject_ids) {
        if (!validSubjectIds.has(Number(suId))) { skipped.push(st.id); continue; }
        const existing = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(sec.school_id, st.id, suId).first();
        if (existing) { skipped.push(st.id); continue; }
        await db.prepare(`
          INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch(), unixepoch())
        `).bind(sec.school_id, st.id, suId, sec.class_id, section_id, user?.id || null).run();
        inserted.push(st.id);
      }
    }
    return c.json({ data: { inserted_count: inserted.length, skipped_count: skipped.length } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تعيين المواد للشعبة', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/assign-students - assign to a chosen list of students
app.post('/api/student-subjects/assign-students', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { student_ids, subject_ids } = body;
    if (!Array.isArray(student_ids) || student_ids.length === 0) return c.json({ error: 'يجب اختيار طالب واحد على الأقل' }, 400);
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) return c.json({ error: 'يجب اختيار مادة واحدة على الأقل' }, 400);

    const inserted: number[] = [];
    const skipped: number[] = [];
    for (const sid of student_ids) {
      const st = await getStudentClassSection(db, Number(sid));
      if (!st) { skipped.push(Number(sid)); continue; }
      const studentMeta = await db.prepare('SELECT school_id FROM students WHERE id = ?').bind(Number(sid)).first<{ school_id: number }>();
      if (!studentMeta) { skipped.push(Number(sid)); continue; }
      const school_id = studentMeta.school_id;
      if (user && user.role_key !== 'system_admin' && school_id !== user.school_id) {
        return c.json({ error: 'غير مسموح: أحد الطلاب لا ينتمي إلى مدرستك' }, 403);
      }
      for (const suId of subject_ids) {
        const su = await db.prepare('SELECT class_id, section_id FROM subjects WHERE id = ?').bind(Number(suId)).first<{ class_id: number | null; section_id: number | null }>();
        if (su && su.class_id != null && String(su.class_id) !== String(st.class_id)) { skipped.push(Number(sid)); continue; }
        if (su && su.section_id != null && String(su.section_id) !== String(st.section_id)) { skipped.push(Number(sid)); continue; }
        const existing = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(school_id, sid, suId).first();
        if (existing) { skipped.push(Number(sid)); continue; }
        await db.prepare(`
          INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch(), unixepoch())
        `).bind(school_id, sid, suId, st.class_id || null, st.section_id || null, user?.id || null).run();
        inserted.push(Number(sid));
      }
    }
    return c.json({ data: { inserted_count: inserted.length, skipped_count: skipped.length } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تعيين المواد للطلاب', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/assign-one - assign to a single student
app.post('/api/student-subjects/assign-one', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { student_id, subject_id } = body;
    if (!student_id || !subject_id) return c.json({ error: 'الطالب والمادة مطلوبان' }, 400);
    const check = await verifyStudentSubjectSchool(db, user, Number(student_id), Number(subject_id));
    if (!check.ok) return c.json({ error: check.error }, (check.status || 400) as any);
    const school_id = check.school_id!;

    // Validate class/section match for the subject
    const st = await getStudentClassSection(db, Number(student_id));
    const su = await db.prepare('SELECT class_id, section_id FROM subjects WHERE id = ?').bind(Number(subject_id)).first<{ class_id: number | null; section_id: number | null }>();
    if (su && su.class_id != null && String(su.class_id) !== String(st?.class_id)) {
      return c.json({ error: 'المادة مخصصة لصف مختلف عن صف الطالب' }, 400);
    }
    if (su && su.section_id != null && String(su.section_id) !== String(st?.section_id)) {
      return c.json({ error: 'المادة مخصصة لشعبة مختلفة عن شعبة الطالب' }, 400);
    }

    const existing = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(school_id, student_id, subject_id).first();
    if (existing) return c.json({ error: 'هذه المادة مضافة مسبقًا لهذا الطالب' }, 409);

    const result = await db.prepare(`
      INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch(), unixepoch())
    `).bind(school_id, student_id, subject_id, st?.class_id || null, st?.section_id || null, user?.id || null).run();
    return c.json({ data: { id: result.meta.last_row_id, student_id, subject_id, is_active: 1 } }, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في تعيين المادة', detail: err.message }, 500);
  }
});

// PUT /api/student-subjects/:id/reactivate - reactivate a deactivated assignment
app.put('/api/student-subjects/:id/reactivate', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const id = Number(c.req.param('id'));
  try {
    const row = await db.prepare('SELECT school_id, student_id, subject_id, is_active FROM student_subjects WHERE id = ?').bind(id).first<{ school_id: number; student_id: number; subject_id: number; is_active: number }>();
    if (!row) return c.json({ error: 'التعيين غير موجود' }, 404);
    if (user && user.role_key !== 'system_admin' && row.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل تعيين في مدرسة أخرى' }, 403);
    }
    if (row.is_active === 1) return c.json({ error: 'التعيين مفعّل مسبقًا' }, 400);

    // Prevent reactivation if another active assignment exists for same student+subject
    const existingActive = await db.prepare('SELECT id FROM student_subjects WHERE school_id = ? AND student_id = ? AND subject_id = ? AND is_active = 1').bind(row.school_id, row.student_id, row.subject_id).first();
    if (existingActive) {
      return c.json({ error: 'لا يمكن إعادة التفعيل: يوجد تعيين نشط آخر للطالب في نفس المادة' }, 409);
    }

    await db.prepare(`UPDATE student_subjects SET is_active = 1, removed_at = NULL, updated_at = unixepoch() WHERE id = ?`).bind(id).run();
    return c.json({ data: { id, is_active: 1, message: 'تم إعادة تفعيل التعيين بنجاح' } });
  } catch (err: any) {
    return c.json({ error: 'فشل في إعادة تفعيل التعيين', detail: err.message }, 500);
  }
});

// PUT /api/student-subjects/:id/deactivate - deactivate one assignment
app.put('/api/student-subjects/:id/deactivate', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const id = Number(c.req.param('id'));
  try {
    const row = await db.prepare('SELECT school_id FROM student_subjects WHERE id = ?').bind(id).first<{ school_id: number }>();
    if (!row) return c.json({ error: 'التعيين غير موجود' }, 404);
    if (user && user.role_key !== 'system_admin' && row.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك تعديل تعيين في مدرسة أخرى' }, 403);
    }
    await db.prepare(`UPDATE student_subjects SET is_active = 0, removed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).bind(id).run();
    return c.json({ data: { id, is_active: 0 } });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء التعيين', detail: err.message }, 500);
  }
});

// POST /api/student-subjects/bulk-deactivate - deactivate multiple assignments
app.post('/api/student-subjects/bulk-deactivate', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const ids: number[] = body.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'يجب اختيار تعيين واحد على الأقل' }, 400);
    let affected = 0;
    for (const id of ids) {
      const row = await db.prepare('SELECT school_id FROM student_subjects WHERE id = ?').bind(id).first<{ school_id: number }>();
      if (!row) continue;
      if (user && user.role_key !== 'system_admin' && row.school_id !== user.school_id) continue;
      await db.prepare(`UPDATE student_subjects SET is_active = 0, removed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).bind(id).run();
      affected++;
    }
    return c.json({ data: { affected } });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء التعيينات', detail: err.message }, 500);
  }
});

// ===========================================

// ===========================================
// Phase 4: Grades & Academic Calculations
// ===========================================

// ===========================================
// Phase 4: Grades & Academic Calculations API
// These routes are appended to worker.ts at build time or imported
// ===========================================

// NOTE: This file is meant to be concatenated into worker.ts manually
// since we can't use ES modules imports in the single-file worker pattern.

// ===========================================
// Grade Calculation Helpers
// ===========================================

function roundGrade(value: number | null | undefined): number | null {
  if (value === null || value === undefined || isNaN(value)) return null;
  return Math.round(value);
}

function avg(values: (number | null | undefined)[]): number | null {
  const valid = values.filter(v => v !== null && v !== undefined && !isNaN(v)) as number[];
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function calculateGrades(
  g: {
    first_month?: number | null;
    second_month?: number | null;
    third_month?: number | null;
    fourth_month?: number | null;
    mid_year_exam?: number | null;
    final_exam?: number | null;
    completion_exam?: number | null;
  },
  settings: { passing_grade: number; exemption_grade: number; max_grade: number; general_exemption_average_grade?: number; general_exemption_min_subject_grade?: number }
): {
  first_term_average: number | null;
  second_term_average: number | null;
  annual_effort: number | null;
  final_grade: number | null;
  grade_after_completion: number | null;
  effective_grade: number | null;
  result_status: string | null;
  exemption_status: number;
} {
  const fm = g.first_month ?? null;
  const sm = g.second_month ?? null;
  const tm = g.third_month ?? null;
  const fom = g.fourth_month ?? null;
  const mye = g.mid_year_exam ?? null;
  const fe = g.final_exam ?? null;
  const ce = g.completion_exam ?? null;

  const first_term_average = roundGrade(avg([fm, sm]));
  const second_term_average = roundGrade(avg([tm, fom]));
  const annual_effort = roundGrade(avg([first_term_average, mye, second_term_average]));
  const final_grade = roundGrade(avg([annual_effort, fe]));

  let grade_after_completion: number | null = null;
  let effective_grade: number | null = null;
  let result_status: string | null = null;
  let exemption_status = 0;

  if (final_grade !== null) {
    if (final_grade >= settings.passing_grade) {
      // Student passed — ignore completion exam entirely
      grade_after_completion = null;
      effective_grade = final_grade;
      result_status = 'ناجح';
    } else {
      // Student failed
      if (ce !== null) {
        grade_after_completion = Math.max(final_grade, ce);
        effective_grade = grade_after_completion;
        if (effective_grade >= settings.passing_grade) {
          result_status = 'ناجح';
        } else {
          result_status = 'راسب';
        }
      } else {
        grade_after_completion = null;
        effective_grade = final_grade;
        result_status = 'مكمل';
      }
    }

    // Individual exemption: based on annual_effort (NOT effective_grade)
    if (annual_effort !== null && annual_effort >= settings.exemption_grade) {
      exemption_status = 1;
    }
  }

  return {
    first_term_average,
    second_term_average,
    annual_effort,
    final_grade,
    grade_after_completion,
    effective_grade,
    result_status,
    exemption_status,
  };
}

function validateGradeValue(value: any, maxGrade: number, fieldName: string): { ok: boolean; error?: string; numeric?: number | null } {
  if (value === '' || value === null || value === undefined) {
    return { ok: true, numeric: null };
  }
  const num = Number(value);
  if (isNaN(num)) {
    return { ok: false, error: `القيمة في حقل ${fieldName} ليست رقمًا صحيحًا` };
  }
  if (num < 0 || num > maxGrade) {
    return { ok: false, error: `القيمة في حقل ${fieldName} يجب أن تكون بين ٠ و ${maxGrade}` };
  }
  return { ok: true, numeric: num };
}

// ===========================================
// Grade Settings Routes
// ===========================================

app.get('/api/grade-settings', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const scope = c.get('scope');
    const resolvedSchoolId = c.get('resolvedSchoolId');

    if (scope === 'single' && resolvedSchoolId) {
      const row = await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(resolvedSchoolId).first<any>();
      if (!row) {
        // Auto-create default settings for this school
        await db.prepare(`
          INSERT INTO grade_settings (school_id, max_grade, passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade, created_at, updated_at)
          VALUES (?, 100, 50, 90, 85, 75, unixepoch(), unixepoch())
        `).bind(resolvedSchoolId).run();
        const newRow = await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(resolvedSchoolId).first<any>();
        return c.json({ data: newRow });
      }
      return c.json({ data: row });
    }

    // Admin can list all
    const rows = await db.prepare('SELECT * FROM grade_settings ORDER BY school_id').all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب إعدادات الدرجات', detail: err.message }, 500);
  }
});

app.put('/api/grade-settings', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { school_id, max_grade, passing_grade, exemption_grade,
      general_exemption_average_grade, general_exemption_min_subject_grade,
      first_term_formula, second_term_formula, annual_effort_formula,
      final_grade_formula, completion_formula, effective_formula } = body;

    // Role-based permission: only admin, owner, principal, vice_principal can update
    if (user && !['system_admin', 'school_owner', 'principal', 'vice_principal'].includes(user.role_key)) {
      return c.json({ error: 'غير مسموح: لا تملك صلاحية تعديل إعدادات الدرجات' }, 403);
    }

    const scope = c.get('scope');
    const resolvedSchoolId = c.get('resolvedSchoolId');

    // Non-admin users: school_id is derived from JWT. Reject body school_id that doesn't match.
    if (scope === 'single' && resolvedSchoolId) {
      if (school_id && Number(school_id) !== resolvedSchoolId) {
        return c.json({ error: 'غير مسموح: لا يمكنك تعديل إعدادات مدرسة أخرى' }, 403);
      }
    }

    // Admin without query/body school_id must provide one
    const targetSchoolId = scope === 'single' ? resolvedSchoolId : (school_id || resolvedSchoolId);
    if (!targetSchoolId) return c.json({ error: 'معرف المدرسة مطلوب' }, 400);

    // Check existing
    const existing = await db.prepare('SELECT id FROM grade_settings WHERE school_id = ?').bind(targetSchoolId).first<{ id: number }>();

    // Resolve effective values for validation (use existing row or defaults)
    const existingRow = existing ? await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(targetSchoolId).first<any>() : null;
    const effMax = max_grade !== undefined && max_grade !== null ? Number(max_grade) : (existingRow?.max_grade ?? 100);
    const effPass = passing_grade !== undefined && passing_grade !== null ? Number(passing_grade) : (existingRow?.passing_grade ?? 50);
    const effExempt = exemption_grade !== undefined && exemption_grade !== null ? Number(exemption_grade) : (existingRow?.exemption_grade ?? 90);
    const effGenAvg = general_exemption_average_grade !== undefined && general_exemption_average_grade !== null ? Number(general_exemption_average_grade) : (existingRow?.general_exemption_average_grade ?? 85);
    const effGenMin = general_exemption_min_subject_grade !== undefined && general_exemption_min_subject_grade !== null ? Number(general_exemption_min_subject_grade) : (existingRow?.general_exemption_min_subject_grade ?? 75);

    if (!isFinite(effMax) || !isFinite(effPass) || !isFinite(effExempt) || !isFinite(effGenAvg) || !isFinite(effGenMin)) {
      return c.json({ error: 'قيم الدرجات يجب أن تكون أرقاماً صالحة' }, 400);
    }
    if (effMax <= 0) {
      return c.json({ error: 'الحد الأقصى للدرجة يجب أن يكون أكبر من 0' }, 400);
    }
    if (effPass < 0 || effPass > effMax) {
      return c.json({ error: 'درجة النجاح يجب أن تكون بين 0 والحد الأقصى' }, 400);
    }
    if (effExempt < effPass) {
      return c.json({ error: 'درجة الإعفاء يجب أن تكون أكبر من أو تساوي درجة النجاح' }, 400);
    }
    if (effExempt > effMax) {
      return c.json({ error: 'درجة الإعفاء يجب أن تكون أقل من أو تساوي الحد الأقصى' }, 400);
    }
    if (effGenAvg < effPass || effGenAvg > effMax) {
      return c.json({ error: 'متوسط الإعفاء العام يجب أن يكون بين درجة النجاح والحد الأقصى' }, 400);
    }
    if (effGenMin < effPass || effGenMin > effGenAvg) {
      return c.json({ error: 'أدنى درجة للإعفاء العام يجب أن تكون بين درجة النجاح ومتوسط الإعفاء العام' }, 400);
    }

    if (existing) {
      await db.prepare(`
        UPDATE grade_settings SET
          max_grade = COALESCE(?, max_grade),
          passing_grade = COALESCE(?, passing_grade),
          exemption_grade = COALESCE(?, exemption_grade),
          general_exemption_average_grade = COALESCE(?, general_exemption_average_grade),
          general_exemption_min_subject_grade = COALESCE(?, general_exemption_min_subject_grade),
          first_term_formula = COALESCE(?, first_term_formula),
          second_term_formula = COALESCE(?, second_term_formula),
          annual_effort_formula = COALESCE(?, annual_effort_formula),
          final_grade_formula = COALESCE(?, final_grade_formula),
          completion_formula = COALESCE(?, completion_formula),
          effective_formula = COALESCE(?, effective_formula),
          updated_at = unixepoch(),
          updated_by_user_id = ?
        WHERE school_id = ?
      `).bind(
        max_grade ?? null, passing_grade ?? null, exemption_grade ?? null,
        general_exemption_average_grade ?? null, general_exemption_min_subject_grade ?? null,
        first_term_formula ?? null, second_term_formula ?? null, annual_effort_formula ?? null,
        final_grade_formula ?? null, completion_formula ?? null, effective_formula ?? null,
        user?.id || null, targetSchoolId
      ).run();
    } else {
      await db.prepare(`
        INSERT INTO grade_settings (school_id, max_grade, passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade, first_term_formula, second_term_formula, annual_effort_formula, final_grade_formula, completion_formula, effective_formula, updated_by_user_id, created_at, updated_at)
        VALUES (?, COALESCE(?, 100), COALESCE(?, 50), COALESCE(?, 90), COALESCE(?, 85), COALESCE(?, 75), ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
      `).bind(
        targetSchoolId, max_grade ?? null, passing_grade ?? null, exemption_grade ?? null,
        general_exemption_average_grade ?? null, general_exemption_min_subject_grade ?? null,
        first_term_formula ?? null, second_term_formula ?? null, annual_effort_formula ?? null,
        final_grade_formula ?? null, completion_formula ?? null, effective_formula ?? null,
        user?.id || null
      ).run();
    }

    const row = await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(targetSchoolId).first<any>();
    return c.json({ data: row, message: 'تم حفظ إعدادات الدرجات بنجاح' });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث إعدادات الدرجات', detail: err.message }, 500);
  }
});

// ===========================================
// Grade Query Helpers
// ===========================================

async function getGradeSettings(db: D1Database, schoolId: number): Promise<any> {
  const row = await db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(schoolId).first<any>();
  if (!row) {
    // Insert defaults
    await db.prepare(`
      INSERT INTO grade_settings (school_id, max_grade, passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade, created_at, updated_at)
      VALUES (?, 100, 50, 90, 85, 75, unixepoch(), unixepoch())
    `).bind(schoolId).run();
    return db.prepare('SELECT * FROM grade_settings WHERE school_id = ?').bind(schoolId).first<any>();
  }
  return row;
}

async function getActiveStudentSubjects(db: D1Database, studentId: number, schoolId: number): Promise<any[]> {
  const rows = await db.prepare(`
    SELECT ss.id as student_subject_id, s.id as subject_id, s.name as subject_name,
           c.name as class_name, sec.name as section_name
    FROM student_subjects ss
    JOIN subjects s ON ss.subject_id = s.id
    LEFT JOIN classes c ON s.class_id = c.id
    LEFT JOIN sections sec ON s.section_id = sec.id
    WHERE ss.student_id = ? AND ss.school_id = ? AND ss.is_active = 1 AND s.status = 'active'
    ORDER BY s.name
  `).bind(studentId, schoolId).all<any>();
  return rows.results || [];
}

// ===========================================
// GET /api/grades
// ===========================================

app.get('/api/grades', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  try {
    const scope = c.get('scope');
    const resolvedSchoolId = c.get('resolvedSchoolId');

    const q = c.req.query();
    const studentId = q.student_id ? Number(q.student_id) : null;
    const subjectId = q.subject_id ? Number(q.subject_id) : null;
    const classId = q.class_id ? Number(q.class_id) : null;
    const sectionId = q.section_id ? Number(q.section_id) : null;
    const isActive = q.is_active !== undefined ? Number(q.is_active) : null;

    let sql = `
      SELECT g.*,
             st.full_name as student_name, st.student_number,
             s.name as subject_name,
             c.name as class_name, sec.name as section_name
      FROM grades g
      JOIN student_subjects ss ON g.student_subject_id = ss.id
      JOIN students st ON ss.student_id = st.id
      JOIN subjects s ON ss.subject_id = s.id
      LEFT JOIN classes c ON st.class_id = c.id
      LEFT JOIN sections sec ON st.section_id = sec.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ' AND g.school_id = ?';
      params.push(resolvedSchoolId);
    }
    if (studentId) {
      sql += ' AND ss.student_id = ?';
      params.push(studentId);
    }
    if (subjectId) {
      sql += ' AND ss.subject_id = ?';
      params.push(subjectId);
    }
    if (classId) {
      sql += ' AND st.class_id = ?';
      params.push(classId);
    }
    if (sectionId) {
      sql += ' AND st.section_id = ?';
      params.push(sectionId);
    }
    if (isActive !== null) {
      sql += ' AND g.is_active = ?';
      params.push(isActive);
    } else {
      sql += ' AND g.is_active = 1';
    }

    sql += ' ORDER BY st.full_name, s.name';

    const stmt = db.prepare(sql);
    const rows = await (params.length > 0 ? stmt.bind(...params).all<any>() : stmt.all<any>());
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الدرجات', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/students/:id/grades
// ===========================================

app.get('/api/students/:id/grades', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const studentId = Number(c.req.param('id'));
  try {
    const student = await db.prepare('SELECT school_id, full_name FROM students WHERE id = ?').bind(studentId).first<{ school_id: number; full_name: string }>();
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);

    if (user && user.role_key !== 'system_admin' && student.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: الطالب في مدرسة أخرى' }, 403);
    }

    const settings = await getGradeSettings(db, student.school_id);

    const rows = await db.prepare(`
      SELECT g.*, s.name as subject_name, s.id as subject_id
      FROM grades g
      JOIN student_subjects ss ON g.student_subject_id = ss.id
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ss.student_id = ? AND g.school_id = ? AND g.is_active = 1 AND ss.is_active = 1 AND s.status = 'active'
      ORDER BY s.name
    `).bind(studentId, student.school_id).all<any>();

    return c.json({ data: { student_name: student.full_name, settings, grades: rows.results || [] } });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب درجات الطالب', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/grades/initialize-student/:student_id
// Create empty grade rows for all active student_subjects
// ===========================================

app.post('/api/grades/initialize-student/:student_id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const studentId = Number(c.req.param('student_id'));
  try {
    const student = await db.prepare('SELECT school_id FROM students WHERE id = ?').bind(studentId).first<{ school_id: number }>();
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);

    if (user && user.role_key !== 'system_admin' && student.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const activeAssignments = await getActiveStudentSubjects(db, studentId, student.school_id);
    let created = 0;
    let skipped = 0;

    for (const assignment of activeAssignments) {
      const existing = await db.prepare('SELECT id FROM grades WHERE student_subject_id = ? AND is_active = 1').bind(assignment.student_subject_id).first<any>();
      if (existing) {
        skipped++;
        continue;
      }
      await db.prepare(`
        INSERT INTO grades (school_id, student_subject_id, is_active, created_at, updated_at, updated_by_user_id)
        VALUES (?, ?, 1, unixepoch(), unixepoch(), ?)
      `).bind(student.school_id, assignment.student_subject_id, user?.id || null).run();
      created++;
    }

    return c.json({ data: { created, skipped, total: activeAssignments.length } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تهيئة درجات الطالب', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/grades/initialize-section
// Initialize grades for all students in a section for given subjects
// ===========================================

app.post('/api/grades/initialize-section', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { section_id, subject_ids } = body;
    if (!section_id) return c.json({ error: 'معرف الشعبة مطلوب' }, 400);
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) return c.json({ error: 'يجب اختيار مادة واحدة على الأقل' }, 400);

    const section = await db.prepare('SELECT school_id, class_id FROM sections WHERE id = ?').bind(Number(section_id)).first<{ school_id: number; class_id: number }>();
    if (!section) return c.json({ error: 'الشعبة غير موجودة' }, 404);

    if (user && user.role_key !== 'system_admin' && section.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const students = await db.prepare('SELECT id FROM students WHERE section_id = ? AND school_id = ? AND status = "active"').bind(section_id, section.school_id).all<{ id: number }>();
    let created = 0;
    let skipped = 0;

    for (const st of (students.results || [])) {
      for (const suId of subject_ids) {
        const ss = await db.prepare(`
          SELECT id FROM student_subjects
          WHERE student_id = ? AND subject_id = ? AND school_id = ? AND is_active = 1
        `).bind(st.id, suId, section.school_id).first<{ id: number }>();
        if (!ss) { skipped++; continue; }

        const existing = await db.prepare('SELECT id FROM grades WHERE student_subject_id = ? AND is_active = 1').bind(ss.id).first<any>();
        if (existing) { skipped++; continue; }

        await db.prepare(`
          INSERT INTO grades (school_id, student_subject_id, is_active, created_at, updated_at, updated_by_user_id)
          VALUES (?, ?, 1, unixepoch(), unixepoch(), ?)
        `).bind(section.school_id, ss.id, user?.id || null).run();
        created++;
      }
    }

    return c.json({ data: { created, skipped } });
  } catch (err: any) {
    return c.json({ error: 'فشل في تهيئة درجات الشعبة', detail: err.message }, 500);
  }
});

// ===========================================
// PUT /api/grades/:id - update grade fields with calculations & audit log
// ===========================================

app.put('/api/grades/:id', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const gradeId = Number(c.req.param('id'));
  try {
    const gradeRow = await db.prepare(`
      SELECT g.*, ss.is_active as ss_active, s.status as subject_status
      FROM grades g
      JOIN student_subjects ss ON g.student_subject_id = ss.id
      JOIN subjects s ON ss.subject_id = s.id
      WHERE g.id = ?
    `).bind(gradeId).first<any>();
    if (!gradeRow) return c.json({ error: 'الدرجة غير موجودة' }, 404);

    if (gradeRow.ss_active !== 1 || gradeRow.subject_status !== 'active') {
      return c.json({ error: 'المادة غير مفعلة أو غير مسندة للطالب' }, 403);
    }

    if (user && user.role_key !== 'system_admin' && gradeRow.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const settings = await getGradeSettings(db, gradeRow.school_id);
    const body = await c.req.json();
    const { first_month, second_month, third_month, fourth_month,
      mid_year_exam, final_exam, completion_exam, notes, change_reason } = body;

    // Validate inputs
    const fields = [
      { val: first_month, name: 'الشهر الأول' },
      { val: second_month, name: 'الشهر الثاني' },
      { val: third_month, name: 'الشهر الثالث' },
      { val: fourth_month, name: 'الشهر الرابع' },
      { val: mid_year_exam, name: 'امتحان منتصف العام' },
      { val: final_exam, name: 'الامتحان النهائي' },
      { val: completion_exam, name: 'امتحان التكميل' },
    ];

    for (const f of fields) {
      if (f.val !== undefined) {
        const check = validateGradeValue(f.val, settings.max_grade, f.name);
        if (!check.ok) return c.json({ error: check.error }, 400);
      }
    }

    // Build update values
    const updates: Record<string, any> = {};
    const setNull = (v: any) => (v === '' || v === null || v === undefined) ? null : Number(v);

    if (first_month !== undefined) updates.first_month = setNull(first_month);
    if (second_month !== undefined) updates.second_month = setNull(second_month);
    if (third_month !== undefined) updates.third_month = setNull(third_month);
    if (fourth_month !== undefined) updates.fourth_month = setNull(fourth_month);
    if (mid_year_exam !== undefined) updates.mid_year_exam = setNull(mid_year_exam);
    if (final_exam !== undefined) updates.final_exam = setNull(final_exam);
    if (completion_exam !== undefined) updates.completion_exam = setNull(completion_exam);
    if (notes !== undefined) updates.notes = notes;

    // Calculate derived fields using new + existing values
    const calcInput = {
      first_month: updates.first_month !== undefined ? updates.first_month : gradeRow.first_month,
      second_month: updates.second_month !== undefined ? updates.second_month : gradeRow.second_month,
      third_month: updates.third_month !== undefined ? updates.third_month : gradeRow.third_month,
      fourth_month: updates.fourth_month !== undefined ? updates.fourth_month : gradeRow.fourth_month,
      mid_year_exam: updates.mid_year_exam !== undefined ? updates.mid_year_exam : gradeRow.mid_year_exam,
      final_exam: updates.final_exam !== undefined ? updates.final_exam : gradeRow.final_exam,
      completion_exam: updates.completion_exam !== undefined ? updates.completion_exam : gradeRow.completion_exam,
    };

    const derived = calculateGrades(calcInput, settings);

    // Merge derived into updates
    updates.first_term_average = derived.first_term_average;
    updates.second_term_average = derived.second_term_average;
    updates.annual_effort = derived.annual_effort;
    updates.final_grade = derived.final_grade;
    updates.grade_after_completion = derived.grade_after_completion;
    updates.effective_grade = derived.effective_grade;
    updates.result_status = derived.result_status;
    updates.exemption_status = derived.exemption_status;
    updates.updated_by_user_id = user?.id || null;

    // Perform update
    const setParts: string[] = [];
    const bindVals: any[] = [];
    for (const [k, v] of Object.entries(updates)) {
      setParts.push(`${k} = ?`);
      bindVals.push(v);
    }
    bindVals.push(gradeId);

    await db.prepare(`UPDATE grades SET ${setParts.join(', ')} WHERE id = ?`).bind(...bindVals).run();

    // Audit log for changed scalar fields
    const auditFields = ['first_month', 'second_month', 'third_month', 'fourth_month',
      'mid_year_exam', 'final_exam', 'completion_exam', 'notes'];
    for (const field of auditFields) {
      if (body[field] !== undefined) {
        const oldVal = gradeRow[field] === null || gradeRow[field] === undefined ? '' : String(gradeRow[field]);
        const newVal = body[field] === '' || body[field] === null || body[field] === undefined ? '' : String(body[field]);
        if (oldVal !== newVal) {
          await db.prepare(`
            INSERT INTO grade_change_logs (school_id, grade_id, field_name, old_value, new_value, changed_by_user_id, change_reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
          `).bind(gradeRow.school_id, gradeId, field, oldVal || null, newVal || null, user?.id || null, change_reason || null).run();
        }
      }
    }

    const updated = await db.prepare('SELECT * FROM grades WHERE id = ?').bind(gradeId).first<any>();
    return c.json({ data: updated });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الدرجة', detail: err.message }, 500);
  }
});

// ===========================================
// POST /api/grades/bulk-entry
// Body: { entries: [{ grade_id, first_month?, second_month?, ... }] }
// ===========================================

app.post('/api/grades/bulk-entry', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  try {
    const body = await c.req.json();
    const { entries } = body;
    if (!Array.isArray(entries) || entries.length === 0) return c.json({ error: 'يجب إرسال مدخلات واحدة على الأقل' }, 400);

    let updated = 0;
    const errors: string[] = [];

    for (const entry of entries) {
      const { grade_id, first_month, second_month, third_month, fourth_month,
        mid_year_exam, final_exam, completion_exam, notes, change_reason } = entry;
      if (!grade_id) { errors.push('معرف الدرجة مفقود في أحد المدخلات'); continue; }

      const gradeRow = await db.prepare('SELECT * FROM grades WHERE id = ?').bind(Number(grade_id)).first<any>();
      if (!gradeRow) { errors.push(`الدرجة ${grade_id} غير موجودة`); continue; }

      if (user && user.role_key !== 'system_admin' && gradeRow.school_id !== user.school_id) {
        errors.push(`غير مسموح بالدرجة ${grade_id}`); continue;
      }

      const settings = await getGradeSettings(db, gradeRow.school_id);

      // Validate
      const fields = [
        { val: first_month, name: 'الشهر الأول' },
        { val: second_month, name: 'الشهر الثاني' },
        { val: third_month, name: 'الشهر الثالث' },
        { val: fourth_month, name: 'الشهر الرابع' },
        { val: mid_year_exam, name: 'امتحان منتصف العام' },
        { val: final_exam, name: 'الامتحان النهائي' },
        { val: completion_exam, name: 'امتحان التكميل' },
      ];
      let valid = true;
      for (const f of fields) {
        if (f.val !== undefined) {
          const check = validateGradeValue(f.val, settings.max_grade, f.name);
          if (!check.ok) { errors.push(check.error!); valid = false; }
        }
      }
      if (!valid) continue;

      const setNull = (v: any) => (v === '' || v === null || v === undefined) ? null : Number(v);
      const updates: Record<string, any> = {};
      if (first_month !== undefined) updates.first_month = setNull(first_month);
      if (second_month !== undefined) updates.second_month = setNull(second_month);
      if (third_month !== undefined) updates.third_month = setNull(third_month);
      if (fourth_month !== undefined) updates.fourth_month = setNull(fourth_month);
      if (mid_year_exam !== undefined) updates.mid_year_exam = setNull(mid_year_exam);
      if (final_exam !== undefined) updates.final_exam = setNull(final_exam);
      if (completion_exam !== undefined) updates.completion_exam = setNull(completion_exam);
      if (notes !== undefined) updates.notes = notes;

      const calcInput = {
        first_month: updates.first_month !== undefined ? updates.first_month : gradeRow.first_month,
        second_month: updates.second_month !== undefined ? updates.second_month : gradeRow.second_month,
        third_month: updates.third_month !== undefined ? updates.third_month : gradeRow.third_month,
        fourth_month: updates.fourth_month !== undefined ? updates.fourth_month : gradeRow.fourth_month,
        mid_year_exam: updates.mid_year_exam !== undefined ? updates.mid_year_exam : gradeRow.mid_year_exam,
        final_exam: updates.final_exam !== undefined ? updates.final_exam : gradeRow.final_exam,
        completion_exam: updates.completion_exam !== undefined ? updates.completion_exam : gradeRow.completion_exam,
      };

      const derived = calculateGrades(calcInput, settings);
      updates.first_term_average = derived.first_term_average;
      updates.second_term_average = derived.second_term_average;
      updates.annual_effort = derived.annual_effort;
      updates.final_grade = derived.final_grade;
      updates.grade_after_completion = derived.grade_after_completion;
      updates.effective_grade = derived.effective_grade;
      updates.result_status = derived.result_status;
      updates.exemption_status = derived.exemption_status;
      updates.updated_by_user_id = user?.id || null;

      const setParts: string[] = [];
      const bindVals: any[] = [];
      for (const [k, v] of Object.entries(updates)) {
        setParts.push(`${k} = ?`);
        bindVals.push(v);
      }
      bindVals.push(Number(grade_id));
      await db.prepare(`UPDATE grades SET ${setParts.join(', ')} WHERE id = ?`).bind(...bindVals).run();

      // Audit log
      const auditFields = ['first_month', 'second_month', 'third_month', 'fourth_month',
        'mid_year_exam', 'final_exam', 'completion_exam', 'notes'];
      for (const field of auditFields) {
        if (entry[field] !== undefined) {
          const oldVal = gradeRow[field] === null || gradeRow[field] === undefined ? '' : String(gradeRow[field]);
          const newVal = entry[field] === '' || entry[field] === null || entry[field] === undefined ? '' : String(entry[field]);
          if (oldVal !== newVal) {
            await db.prepare(`
              INSERT INTO grade_change_logs (school_id, grade_id, field_name, old_value, new_value, changed_by_user_id, change_reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
            `).bind(gradeRow.school_id, Number(grade_id), field, oldVal || null, newVal || null, user?.id || null, change_reason || null).run();
          }
        }
      }
      updated++;
    }

    return c.json({ data: { updated, errors: errors.length > 0 ? errors : undefined } });
  } catch (err: any) {
    return c.json({ error: 'فشل في الإدخال المجمّع', detail: err.message }, 500);
  }
});

// ===========================================
// GET /api/grades/:id/history - audit log
// ===========================================

app.get('/api/grades/:id/history', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const gradeId = Number(c.req.param('id'));
  try {
    const gradeRow = await db.prepare('SELECT school_id FROM grades WHERE id = ?').bind(gradeId).first<{ school_id: number }>();
    if (!gradeRow) return c.json({ error: 'الدرجة غير موجودة' }, 404);

    if (user && user.role_key !== 'system_admin' && gradeRow.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const rows = await db.prepare(`
      SELECT l.*, u.full_name as changed_by_name
      FROM grade_change_logs l
      LEFT JOIN users u ON l.changed_by_user_id = u.id
      WHERE l.grade_id = ? AND l.school_id = ?
      ORDER BY l.created_at DESC
    `).bind(gradeId, gradeRow.school_id).all<any>();

    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب سجل التعديلات', detail: err.message }, 500);
  }
});

// ===========================================
// Phase 5: Analytics API Routes
// ===========================================

function getAnalyticsFilters(c: any) {
  const user: UserContext | null = c.get('user') || null;
  const querySchoolId = c.req.query('school_id');
  const queryClassId = c.req.query('class_id');
  const querySectionId = c.req.query('section_id');
  const querySubjectId = c.req.query('subject_id');

  const resolved = resolveSchoolScope(user, querySchoolId);
  const schoolId = resolved.schoolId;
  const classId = queryClassId ? parseInt(queryClassId, 10) : null;
  const sectionId = querySectionId ? parseInt(querySectionId, 10) : null;
  const subjectId = querySubjectId ? parseInt(querySubjectId, 10) : null;

  return { user, schoolId, classId, sectionId, subjectId, forbidden: resolved.forbidden };
}

function buildAnalyticsWhere(opts: { schoolId: number | null; classId: number | null; sectionId: number | null; subjectId: number | null }): { where: string; params: any[] } {
  const conditions: string[] = ['g.is_active = 1'];
  const params: any[] = [];
  if (opts.schoolId != null) {
    conditions.push('g.school_id = ?');
    params.push(opts.schoolId);
  }
  if (opts.classId != null) {
    conditions.push('st.class_id = ?');
    params.push(opts.classId);
  }
  if (opts.sectionId != null) {
    conditions.push('st.section_id = ?');
    params.push(opts.sectionId);
  }
  if (opts.subjectId != null) {
    conditions.push('ss.subject_id = ?');
    params.push(opts.subjectId);
  }
  return { where: conditions.join(' AND '), params };
}

function rowToAnalytics(row: any, passingGrade: number, exemptionGrade: number) {
  const effective = row.effective_grade;
  const annualEffort = row.annual_effort;
  const final = row.final_grade;
  const completion = row.grade_after_completion;
  const status = row.result_status;
  const exempt = row.exemption_status;
  // close-to-passing uses effective_grade (result-based)
  const closeToPassing = effective != null && effective < passingGrade && (passingGrade - effective) >= 1 && (passingGrade - effective) <= 5;
  // close-to-exemption uses annual_effort (individual exemption based)
  const closeToExemption = annualEffort != null && annualEffort < exemptionGrade && (exemptionGrade - annualEffort) >= 1 && (exemptionGrade - annualEffort) <= 5;
  return {
    ...row,
    close_to_passing: closeToPassing ? 1 : 0,
    close_to_exemption: closeToExemption ? 1 : 0,
    marks_needed_to_pass: closeToPassing && effective != null ? Math.round(passingGrade - effective) : null,
    marks_needed_to_exempt: closeToExemption && annualEffort != null ? Math.round(exemptionGrade - annualEffort) : null,
  };
}

// GET /api/analytics/overview
app.get('/api/analytics/overview', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    // Fetch passing/exemption thresholds from grade_settings for the resolved school
    let passingGrade = 50;
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade, exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number; exemption_grade: number }>();
      if (gs) { passingGrade = gs.passing_grade; exemptionGrade = gs.exemption_grade; }
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        g.result_status,
        g.exemption_status,
        g.effective_grade,
        g.annual_effort,
        g.grade_after_completion,
        g.final_grade
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN students st ON ss.student_id = st.id AND st.status = 'active'
      WHERE ${where}
    `).bind(...params).all<any>();

    const results = rows.results || [];
    const total = results.length;
    const passCount = results.filter((r: any) => r.result_status === 'ناجح').length;
    const incompleteCount = results.filter((r: any) => r.result_status === 'مكمل').length;
    const failCount = results.filter((r: any) => r.result_status === 'راسب').length;
    const exemptCount = results.filter((r: any) => r.exemption_status === 1).length;
    const closeToPassing = results.filter((r: any) => r.effective_grade != null && r.effective_grade < passingGrade && (passingGrade - r.effective_grade) >= 1 && (passingGrade - r.effective_grade) <= 5).length;
    const closeToExemption = results.filter((r: any) => r.annual_effort != null && r.annual_effort < exemptionGrade && (exemptionGrade - r.annual_effort) >= 1 && (exemptionGrade - r.annual_effort) <= 5).length;

    return c.json({
      data: {
        total,
        pass_count: passCount,
        incomplete_count: incompleteCount,
        fail_count: failCount,
        exempt_count: exemptCount,
        close_to_passing_count: closeToPassing,
        close_to_exemption_count: closeToExemption,
        pass_percentage: total > 0 ? Math.round((passCount / total) * 1000) / 10 : 0,
        incomplete_percentage: total > 0 ? Math.round((incompleteCount / total) * 1000) / 10 : 0,
        fail_percentage: total > 0 ? Math.round((failCount / total) * 1000) / 10 : 0,
        exempt_percentage: total > 0 ? Math.round((exemptCount / total) * 1000) / 10 : 0,
        passing_grade: passingGrade,
        exemption_grade: exemptionGrade,
      }
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب تحليل النظرة العامة', detail: err.message }, 500);
  }
});

// GET /api/analytics/by-class
app.get('/api/analytics/by-class', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let passingGrade = 50;
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade, exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number; exemption_grade: number }>();
      if (gs) { passingGrade = gs.passing_grade; exemptionGrade = gs.exemption_grade; }
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        cl.id AS class_id,
        cl.name AS class_name,
        g.result_status,
        g.exemption_status,
        g.effective_grade,
        g.annual_effort
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN students st ON ss.student_id = st.id AND st.status = 'active'
      INNER JOIN classes cl ON st.class_id = cl.id
      WHERE ${where}
    `).bind(...params).all<any>();

    const results = rows.results || [];
    const map: Record<string, any> = {};
    for (const r of results) {
      const key = String(r.class_id || 'unknown');
      if (!map[key]) map[key] = { class_id: r.class_id || null, class_name: r.class_name || 'غير محدد', total: 0, pass_count: 0, incomplete_count: 0, fail_count: 0, exempt_count: 0, close_to_passing: 0, close_to_exemption: 0 };
      map[key].total++;
      if (r.result_status === 'ناجح') map[key].pass_count++;
      if (r.result_status === 'مكمل') map[key].incomplete_count++;
      if (r.result_status === 'راسب') map[key].fail_count++;
      if (r.exemption_status === 1) map[key].exempt_count++;
      if (r.effective_grade != null && r.effective_grade < passingGrade && (passingGrade - r.effective_grade) >= 1 && (passingGrade - r.effective_grade) <= 5) map[key].close_to_passing++;
      if (r.annual_effort != null && r.annual_effort < exemptionGrade && (exemptionGrade - r.annual_effort) >= 1 && (exemptionGrade - r.annual_effort) <= 5) map[key].close_to_exemption++;
    }

    const data = Object.values(map).map((item: any) => ({
      ...item,
      pass_percentage: item.total > 0 ? Math.round((item.pass_count / item.total) * 1000) / 10 : 0,
      fail_percentage: item.total > 0 ? Math.round((item.fail_count / item.total) * 1000) / 10 : 0,
      incomplete_percentage: item.total > 0 ? Math.round((item.incomplete_count / item.total) * 1000) / 10 : 0,
      exempt_percentage: item.total > 0 ? Math.round((item.exempt_count / item.total) * 1000) / 10 : 0,
    }));

    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب التحليل حسب الصف', detail: err.message }, 500);
  }
});

// GET /api/analytics/by-section
app.get('/api/analytics/by-section', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let passingGrade = 50;
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade, exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number; exemption_grade: number }>();
      if (gs) { passingGrade = gs.passing_grade; exemptionGrade = gs.exemption_grade; }
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        se.id AS section_id,
        se.name AS section_name,
        cl.name AS class_name,
        g.result_status,
        g.exemption_status,
        g.effective_grade,
        g.annual_effort
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN students st ON ss.student_id = st.id AND st.status = 'active'
      INNER JOIN sections se ON st.section_id = se.id
      INNER JOIN classes cl ON st.class_id = cl.id
      WHERE ${where}
    `).bind(...params).all<any>();

    const results = rows.results || [];
    const map: Record<string, any> = {};
    for (const r of results) {
      const key = String(r.section_id || 'unknown');
      if (!map[key]) map[key] = { section_id: r.section_id || null, section_name: r.section_name || 'غير محدد', class_name: r.class_name || '', total: 0, pass_count: 0, incomplete_count: 0, fail_count: 0, exempt_count: 0, close_to_passing: 0, close_to_exemption: 0 };
      map[key].total++;
      if (r.result_status === 'ناجح') map[key].pass_count++;
      if (r.result_status === 'مكمل') map[key].incomplete_count++;
      if (r.result_status === 'راسب') map[key].fail_count++;
      if (r.exemption_status === 1) map[key].exempt_count++;
      if (r.effective_grade != null && r.effective_grade < passingGrade && (passingGrade - r.effective_grade) >= 1 && (passingGrade - r.effective_grade) <= 5) map[key].close_to_passing++;
      if (r.annual_effort != null && r.annual_effort < exemptionGrade && (exemptionGrade - r.annual_effort) >= 1 && (exemptionGrade - r.annual_effort) <= 5) map[key].close_to_exemption++;
    }

    const data = Object.values(map).map((item: any) => ({
      ...item,
      pass_percentage: item.total > 0 ? Math.round((item.pass_count / item.total) * 1000) / 10 : 0,
      fail_percentage: item.total > 0 ? Math.round((item.fail_count / item.total) * 1000) / 10 : 0,
      incomplete_percentage: item.total > 0 ? Math.round((item.incomplete_count / item.total) * 1000) / 10 : 0,
      exempt_percentage: item.total > 0 ? Math.round((item.exempt_count / item.total) * 1000) / 10 : 0,
    }));

    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب التحليل حسب الشعبة', detail: err.message }, 500);
  }
});

// GET /api/analytics/by-subject
app.get('/api/analytics/by-subject', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let passingGrade = 50;
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade, exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number; exemption_grade: number }>();
      if (gs) { passingGrade = gs.passing_grade; exemptionGrade = gs.exemption_grade; }
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        su.id AS subject_id,
        su.name AS subject_name,
        g.result_status,
        g.exemption_status,
        g.effective_grade,
        g.annual_effort
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN students st ON ss.student_id = st.id AND st.status = 'active'
      INNER JOIN subjects su ON ss.subject_id = su.id
      WHERE ${where}
    `).bind(...params).all<any>();

    const results = rows.results || [];
    const map: Record<string, any> = {};
    for (const r of results) {
      const key = String(r.subject_id || 'unknown');
      if (!map[key]) map[key] = { subject_id: r.subject_id || null, subject_name: r.subject_name || 'غير محدد', total: 0, pass_count: 0, incomplete_count: 0, fail_count: 0, exempt_count: 0, close_to_passing: 0, close_to_exemption: 0 };
      map[key].total++;
      if (r.result_status === 'ناجح') map[key].pass_count++;
      if (r.result_status === 'مكمل') map[key].incomplete_count++;
      if (r.result_status === 'راسب') map[key].fail_count++;
      if (r.exemption_status === 1) map[key].exempt_count++;
      if (r.effective_grade != null && r.effective_grade < passingGrade && (passingGrade - r.effective_grade) >= 1 && (passingGrade - r.effective_grade) <= 5) map[key].close_to_passing++;
      if (r.annual_effort != null && r.annual_effort < exemptionGrade && (exemptionGrade - r.annual_effort) >= 1 && (exemptionGrade - r.annual_effort) <= 5) map[key].close_to_exemption++;
    }

    const data = Object.values(map).map((item: any) => ({
      ...item,
      pass_percentage: item.total > 0 ? Math.round((item.pass_count / item.total) * 1000) / 10 : 0,
      fail_percentage: item.total > 0 ? Math.round((item.fail_count / item.total) * 1000) / 10 : 0,
      incomplete_percentage: item.total > 0 ? Math.round((item.incomplete_count / item.total) * 1000) / 10 : 0,
      exempt_percentage: item.total > 0 ? Math.round((item.exempt_count / item.total) * 1000) / 10 : 0,
    }));

    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب التحليل حسب المادة', detail: err.message }, 500);
  }
});

// GET /api/analytics/students-close-to-passing
app.get('/api/analytics/students-close-to-passing', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let passingGrade = 50;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT passing_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ passing_grade: number }>();
      if (gs) passingGrade = gs.passing_grade;
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        st.id AS student_id,
        st.full_name AS student_name,
        st.student_number,
        cl.name AS class_name,
        se.name AS section_name,
        su.name AS subject_name,
        g.effective_grade,
        g.final_grade,
        g.grade_after_completion,
        g.result_status
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN students st ON ss.student_id = st.id AND st.status = 'active'
      INNER JOIN classes cl ON st.class_id = cl.id
      INNER JOIN sections se ON st.section_id = se.id
      INNER JOIN subjects su ON ss.subject_id = su.id
      WHERE ${where}
        AND g.effective_grade IS NOT NULL
        AND g.effective_grade < ?
        AND (? - g.effective_grade) >= 1
        AND (? - g.effective_grade) <= 5
      ORDER BY (? - g.effective_grade) ASC, st.full_name
    `).bind(...params, passingGrade, passingGrade, passingGrade, passingGrade).all<any>();

    const results = (rows.results || []).map((r: any) => ({
      ...r,
      marks_needed: r.effective_grade != null ? Math.round(passingGrade - r.effective_grade) : null,
    }));

    return c.json({ data: results });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب قائمة الطلاب القريبين من النجاح', detail: err.message }, 500);
  }
});

// GET /api/analytics/students-close-to-exemption
app.get('/api/analytics/students-close-to-exemption', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    let exemptionGrade = 90;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT exemption_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ exemption_grade: number }>();
      if (gs) exemptionGrade = gs.exemption_grade;
    }

    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: filters.subjectId });

    const rows = await db.prepare(`
      SELECT
        st.id AS student_id,
        st.full_name AS student_name,
        st.student_number,
        cl.name AS class_name,
        se.name AS section_name,
        su.name AS subject_name,
        g.effective_grade,
        g.annual_effort,
        g.final_grade,
        g.grade_after_completion,
        g.result_status
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN students st ON ss.student_id = st.id AND st.status = 'active'
      INNER JOIN classes cl ON st.class_id = cl.id
      INNER JOIN sections se ON st.section_id = se.id
      INNER JOIN subjects su ON ss.subject_id = su.id
      WHERE ${where}
        AND g.annual_effort IS NOT NULL
        AND g.annual_effort < ?
        AND (? - g.annual_effort) >= 1
        AND (? - g.annual_effort) <= 5
      ORDER BY (? - g.annual_effort) ASC, st.full_name
    `).bind(...params, exemptionGrade, exemptionGrade, exemptionGrade, exemptionGrade).all<any>();

    const results = (rows.results || []).map((r: any) => ({
      ...r,
      marks_needed: r.annual_effort != null ? Math.round(exemptionGrade - r.annual_effort) : null,
    }));

    return c.json({ data: results });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب قائمة الطلاب القريبين من الإعفاء', detail: err.message }, 500);
  }
});

// GET /api/analytics/exemption-blockers
app.get('/api/analytics/exemption-blockers', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const filters = getAnalyticsFilters(c);
  if (filters.forbidden) return c.json({ error: 'غير مسموح' }, 403);

  try {
    const { where, params } = buildAnalyticsWhere({ schoolId: filters.schoolId, classId: filters.classId, sectionId: filters.sectionId, subjectId: null });

    let genMin = 75;
    if (filters.schoolId) {
      const gs = await db.prepare('SELECT general_exemption_min_subject_grade FROM grade_settings WHERE school_id = ?').bind(filters.schoolId).first<{ general_exemption_min_subject_grade: number }>();
      if (gs) genMin = gs.general_exemption_min_subject_grade;
    }

    const rows = await db.prepare(`
      SELECT
        su.id AS subject_id,
        su.name AS subject_name,
        COUNT(*) AS total_students,
        SUM(CASE WHEN g.exemption_status = 1 THEN 1 ELSE 0 END) AS exempt_count,
        SUM(CASE WHEN g.annual_effort IS NULL OR g.annual_effort < ? THEN 1 ELSE 0 END) AS blocker_count
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN students st ON ss.student_id = st.id AND st.status = 'active'
      INNER JOIN subjects su ON ss.subject_id = su.id
      WHERE ${where}
      GROUP BY su.id, su.name
      HAVING blocker_count > 0
      ORDER BY blocker_count DESC, su.name
    `).bind(...params, genMin).all<any>();

    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المواد التي منعت الإعفاء', detail: err.message }, 500);
  }
});

// GET /api/analytics/student-summary/:student_id
app.get('/api/analytics/student-summary/:student_id', requireAuthEnforced(), async (c) => {
  const db = c.env.DB;
  const user: UserContext | null = c.get('user') || null;
  const studentId = Number(c.req.param('student_id'));
  if (!isFinite(studentId)) return c.json({ error: 'معرف الطالب غير صالح' }, 400);

  try {
    const student = await db.prepare(`
      SELECT st.id, st.full_name, st.student_number, st.school_id, st.class_id, st.section_id,
             cl.name AS class_name, se.name AS section_name
      FROM students st
      LEFT JOIN classes cl ON st.class_id = cl.id
      LEFT JOIN sections se ON st.section_id = se.id
      WHERE st.id = ? AND st.status = 'active'
    `).bind(studentId).first<any>();

    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);

    if (user && user.role_key !== 'system_admin' && student.school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    let passingGrade = 50;
    let exemptionGrade = 90;
    let genAvg = 85;
    let genMin = 75;
    const gs = await db.prepare('SELECT passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade FROM grade_settings WHERE school_id = ?').bind(student.school_id).first<any>();
    if (gs) {
      passingGrade = gs.passing_grade;
      exemptionGrade = gs.exemption_grade;
      genAvg = gs.general_exemption_average_grade ?? 85;
      genMin = gs.general_exemption_min_subject_grade ?? 75;
    }

    const gradeRows = await db.prepare(`
      SELECT
        su.id AS subject_id,
        su.name AS subject_name,
        g.effective_grade,
        g.annual_effort,
        g.final_grade,
        g.grade_after_completion,
        g.result_status,
        g.exemption_status,
        g.first_month,
        g.second_month,
        g.third_month,
        g.fourth_month,
        g.mid_year_exam,
        g.final_exam,
        g.completion_exam
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN subjects su ON ss.subject_id = su.id
      WHERE ss.student_id = ? AND g.is_active = 1
      ORDER BY su.name
    `).bind(studentId).all<any>();

    const subjects = gradeRows.results || [];
    const totalSubjects = subjects.length;
    const passCount = subjects.filter((r: any) => r.result_status === 'ناجح').length;
    const incompleteCount = subjects.filter((r: any) => r.result_status === 'مكمل').length;
    const failCount = subjects.filter((r: any) => r.result_status === 'راسب').length;
    const exemptCount = subjects.filter((r: any) => r.exemption_status === 1).length;

    // General exemption: based on annual_effort only
    // 1. All active assigned subjects have grade records
    // 2. All have annual_effort calculated
    // 3. AVG(annual_effort) >= genAvg
    // 4. MIN(annual_effort) >= genMin
    const annualEfforts = subjects.map((r: any) => r.annual_effort).filter((v: any) => v !== null && v !== undefined && !isNaN(v)) as number[];
    const avgAnnualEffort = annualEfforts.length > 0 ? annualEfforts.reduce((a: number, b: number) => a + b, 0) / annualEfforts.length : null;
    const minAnnualEffort = annualEfforts.length > 0 ? Math.min(...annualEfforts) : null;
    const generalExemptionEligible = totalSubjects > 0 && annualEfforts.length === totalSubjects && avgAnnualEffort !== null && avgAnnualEffort >= genAvg && minAnnualEffort !== null && minAnnualEffort >= genMin;

    return c.json({
      data: {
        student,
        passing_grade: passingGrade,
        exemption_grade: exemptionGrade,
        summary: {
          total_subjects: totalSubjects,
          pass_count: passCount,
          incomplete_count: incompleteCount,
          fail_count: failCount,
          exempt_count: exemptCount,
          general_exemption_eligible: generalExemptionEligible,
        },
        subjects,
      }
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب تحليل الطالب', detail: err.message }, 500);
  }
});

// ===========================================
// Phase 6: Result Cards + QR Verification
// ===========================================

function canGenerateResultCards(roleKey: RoleKey): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal'].includes(roleKey);
}

function generateVerificationToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 32; i++) {
    token += chars[buf[i] % chars.length];
  }
  return token;
}

async function hashToken(token: string): Promise<string> {
  const data = stringToBuffer(token + 'smart-school-verification-salt-2026');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateCardNumber(schoolId: number, studentId: number): string {
  const ts = Math.floor(Date.now() / 1000);
  return `RC-${schoolId}-${studentId}-${ts}`;
}

// GET /api/result-cards
// ===========================================
app.get('/api/result-cards', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    const query = c.req.query();
    const classId = query.class_id ? parseInt(query.class_id, 10) : null;
    const sectionId = query.section_id ? parseInt(query.section_id, 10) : null;
    const studentId = query.student_id ? parseInt(query.student_id, 10) : null;
    const status = query.status || null;

    let sql = `SELECT rc.id, rc.card_number, rc.student_name_snapshot, rc.class_name_snapshot, rc.section_name_snapshot, rc.school_name_snapshot, rc.academic_year_snapshot, rc.general_exemption_status, rc.overall_result_status, rc.generated_at, rc.printed_at, rc.status, rc.verification_token FROM result_cards rc WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND rc.school_id = ?`;
      params.push(resolvedSchoolId);
    } else if (query.school_id && user?.role_key === 'system_admin') {
      sql += ` AND rc.school_id = ?`;
      params.push(parseInt(query.school_id, 10));
    }

    if (classId) { sql += ` AND rc.class_id = ?`; params.push(classId); }
    if (sectionId) { sql += ` AND rc.section_id = ?`; params.push(sectionId); }
    if (studentId) { sql += ` AND rc.student_id = ?`; params.push(studentId); }
    if (status) { sql += ` AND rc.status = ?`; params.push(status); }

    sql += ` ORDER BY rc.generated_at DESC`;

    const stmt = db.prepare(sql);
    const rows = await stmt.bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب كارتات النتائج', detail: err.message }, 500);
  }
});

// GET /api/result-cards/:id
// ===========================================
app.get('/api/result-cards/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const row = await db.prepare(`SELECT * FROM result_cards WHERE id = ?`).bind(id).first<any>();
    if (!row) {
      return c.json({ error: 'كارت النتيجة غير موجود' }, 404);
    }
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى هذا الكارت' }, 403);
    }
    let data = row;
    try {
      data = { ...row, card_data_parsed: JSON.parse(row.card_data_json) };
    } catch { /* leave as-is */ }
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب كارت النتيجة', detail: err.message }, 500);
  }
});

// POST /api/result-cards/generate-student/:student_id
// ===========================================
app.post('/api/result-cards/generate-student/:student_id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canGenerateResultCards(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إنشاء كارتات النتائج' }, 403);
  }

  const studentId = parseInt(c.req.param('student_id'), 10);

  try {
    // Fetch student with class/section/school names
    const student = await db.prepare(`
      SELECT s.id, s.school_id, s.full_name, s.student_number, s.class_id, s.section_id,
             c.name AS class_name, sec.name AS section_name, sch.name AS school_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN schools sch ON s.school_id = sch.id
      WHERE s.id = ? AND s.status = 'active'
    `).bind(studentId).first<any>();

    if (!student) {
      return c.json({ error: 'الطالب غير موجود أو غير فعال' }, 404);
    }

    if (scope === 'single' && resolvedSchoolId && student.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك إنشاء كارت لطالب من مدرسة أخرى' }, 403);
    }

    // Active assigned subjects
    const subjectRows = await db.prepare(`
      SELECT su.id, su.name AS subject_name
      FROM student_subjects ss
      INNER JOIN subjects su ON ss.subject_id = su.id
      WHERE ss.student_id = ? AND ss.is_active = 1 AND su.status = 'active'
      ORDER BY su.name
    `).bind(studentId).all<any>();
    const activeSubjects = subjectRows.results || [];

    if (activeSubjects.length === 0) {
      return c.json({ error: 'لا توجد مواد مفعلة مسندة لهذا الطالب' }, 400);
    }

    // Grades for active subjects
    const gradeRows = await db.prepare(`
      SELECT
        su.id AS subject_id,
        su.name AS subject_name,
        g.annual_effort,
        g.final_exam,
        g.final_grade,
        g.completion_exam,
        g.grade_after_completion,
        g.effective_grade,
        g.result_status,
        g.exemption_status,
        g.first_month,
        g.second_month,
        g.third_month,
        g.fourth_month,
        g.mid_year_exam
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN subjects su ON ss.subject_id = su.id
      WHERE ss.student_id = ? AND g.is_active = 1
      ORDER BY su.name
    `).bind(studentId).all<any>();
    const grades = gradeRows.results || [];

    // Missing subjects check
    const gradedSubjectIds = new Set(grades.map((g: any) => g.subject_id));
    const missingSubjects = activeSubjects.filter((s: any) => !gradedSubjectIds.has(s.id));
    if (missingSubjects.length > 0) {
      return c.json({
        error: 'درجات ناقصة: لا يمكن إنشاء الكارت حتى يتم إكمال درجات المواد التالية',
        missing_subjects: missingSubjects.map((s: any) => s.subject_name),
      }, 400);
    }

    // Grade settings
    let passingGrade = 50;
    let exemptionGrade = 90;
    let genAvg = 85;
    let genMin = 75;
    const gs = await db.prepare(`
      SELECT passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade
      FROM grade_settings WHERE school_id = ?
    `).bind(student.school_id).first<any>();
    if (gs) {
      passingGrade = gs.passing_grade;
      exemptionGrade = gs.exemption_grade;
      genAvg = gs.general_exemption_average_grade ?? 85;
      genMin = gs.general_exemption_min_subject_grade ?? 75;
    }

    // Academic year
    const ay = await db.prepare(`SELECT id, name FROM academic_years WHERE school_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`).bind(student.school_id).first<any>();

    // Compute general exemption based on annual_effort only
    const annualEfforts = grades.map((r: any) => r.annual_effort).filter((v: any) => v !== null && v !== undefined && !isNaN(v)) as number[];
    const avgAnnualEffort = annualEfforts.length > 0 ? Math.round(annualEfforts.reduce((a: number, b: number) => a + b, 0) / annualEfforts.length) : null;
    const minAnnualEffort = annualEfforts.length > 0 ? Math.min(...annualEfforts) : null;
    const generalExemptionEligible = annualEfforts.length === grades.length && avgAnnualEffort !== null && avgAnnualEffort >= genAvg && minAnnualEffort !== null && minAnnualEffort >= genMin;

    // Overall result status
    const failCount = grades.filter((g: any) => g.result_status === 'راسب').length;
    const incompleteCount = grades.filter((g: any) => g.result_status === 'مكمل').length;
    const overallStatus = failCount > 0 ? 'راسب' : (incompleteCount > 0 ? 'مكمل' : 'ناجح');

    // Block duplicate active card for same student + academic year
    const existingActive = await db.prepare(`
      SELECT id FROM result_cards
      WHERE student_id = ? AND academic_year_id = ? AND status = 'active'
      LIMIT 1
    `).bind(studentId, ay?.id || 0).first<any>();
    if (existingActive) {
      return c.json({ error: 'يوجد كارت نتيجة فعّال بالفعل لهذا الطالب في نفس السنة الدراسية. يجب إلغاؤه أولاً أو استخدام خيار التجديد.' }, 409);
    }

    const token = generateVerificationToken();
    const tokenHash = await hashToken(token);
    const cardNumber = generateCardNumber(student.school_id, studentId);

    const cardData = {
      school: { id: student.school_id, name: student.school_name },
      student: { id: studentId, name: student.full_name, student_number: student.student_number },
      class: { id: student.class_id, name: student.class_name },
      section: { id: student.section_id, name: student.section_name },
      academic_year: ay ? { id: ay.id, name: ay.name } : null,
      settings: { passing_grade: passingGrade, exemption_grade: exemptionGrade, general_exemption_average_grade: genAvg, general_exemption_min_subject_grade: genMin },
      subjects: grades,
      summary: {
        total_subjects: grades.length,
        annual_effort_average: avgAnnualEffort,
        min_annual_effort: minAnnualEffort,
        general_exemption_eligible: generalExemptionEligible,
        overall_result_status: overallStatus,
      },
      generated_by: user.id,
      generated_at: Math.floor(Date.now() / 1000),
    };

    await db.prepare(`
      INSERT INTO result_cards (
        school_id, student_id, class_id, section_id, academic_year_id,
        card_number, verification_token, verification_hash,
        student_name_snapshot, class_name_snapshot, section_name_snapshot,
        school_name_snapshot, academic_year_snapshot,
        general_exemption_status, annual_effort_average, min_annual_effort,
        overall_result_status, card_data_json,
        generated_by_user_id, generated_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).bind(
      student.school_id, studentId, student.class_id || null, student.section_id || null, ay?.id || null,
      cardNumber, token, tokenHash,
      student.full_name, student.class_name || null, student.section_name || null,
      student.school_name || null, ay?.name || null,
      generalExemptionEligible ? 1 : 0, avgAnnualEffort, minAnnualEffort,
      overallStatus, JSON.stringify(cardData),
      user.id, Math.floor(Date.now() / 1000)
    ).run();

    const newCard = await db.prepare(`SELECT * FROM result_cards WHERE verification_token = ?`).bind(token).first<any>();

    return c.json({
      data: {
        card: newCard,
        verification_url: `/verify/result-card/${token}`,
      },
      message: 'تم إنشاء كارت النتيجة بنجاح',
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء كارت النتيجة', detail: err.message }, 500);
  }
});

// POST /api/result-cards/generate-section
// ===========================================
app.post('/api/result-cards/generate-section', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canGenerateResultCards(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إنشاء كارتات النتائج' }, 403);
  }

  try {
    const body = await c.req.json();
    const classId = body.class_id ? parseInt(body.class_id, 10) : null;
    const sectionId = body.section_id ? parseInt(body.section_id, 10) : null;

    if (!classId || !sectionId) {
      return c.json({ error: 'معرف الصف والشعبة مطلوبان' }, 400);
    }

    // Verify section belongs to school
    if (scope === 'single' && resolvedSchoolId) {
      const secCheck = await db.prepare(`SELECT school_id FROM sections WHERE id = ?`).bind(sectionId).first<{ school_id: number }>();
      if (!secCheck || secCheck.school_id !== resolvedSchoolId) {
        return c.json({ error: 'غير مسموح: الشعبة لا تنتمي إلى مدرستك' }, 403);
      }
    }

    // Fetch active students in section
    const studentsRows = await db.prepare(`
      SELECT s.id, s.school_id, s.full_name, s.student_number, s.class_id, s.section_id,
             c.name AS class_name, sec.name AS section_name, sch.name AS school_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN schools sch ON s.school_id = sch.id
      WHERE s.class_id = ? AND s.section_id = ? AND s.status = 'active'
    `).bind(classId, sectionId).all<any>();
    const students = studentsRows.results || [];

    const generated: any[] = [];
    const skipped: { student_id: number; student_name: string; reason: string; missing_subjects?: string[] }[] = [];

    for (const student of students) {
      // Active subjects
      const subjectRows = await db.prepare(`
        SELECT su.id, su.name AS subject_name
        FROM student_subjects ss
        INNER JOIN subjects su ON ss.subject_id = su.id
        WHERE ss.student_id = ? AND ss.is_active = 1 AND su.status = 'active'
      `).bind(student.id).all<any>();
      const activeSubjects = subjectRows.results || [];

      if (activeSubjects.length === 0) {
        skipped.push({ student_id: student.id, student_name: student.full_name, reason: 'لا توجد مواد مفعلة' });
        continue;
      }

      // Grades
      const gradeRows = await db.prepare(`
        SELECT su.id AS subject_id, su.name AS subject_name, g.annual_effort
        FROM grades g
        INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
        INNER JOIN subjects su ON ss.subject_id = su.id
        WHERE ss.student_id = ? AND g.is_active = 1
      `).bind(student.id).all<any>();
      const grades = gradeRows.results || [];

      const gradedIds = new Set(grades.map((g: any) => g.subject_id));
      const missing = activeSubjects.filter((s: any) => !gradedIds.has(s.id));
      if (missing.length > 0) {
        skipped.push({ student_id: student.id, student_name: student.full_name, reason: 'درجات ناقصة', missing_subjects: missing.map((s: any) => s.subject_name) });
        continue;
      }

      // Compute eligibility using annual_effort only
      const annualEfforts = grades.map((r: any) => r.annual_effort).filter((v: any) => v !== null && !isNaN(v)) as number[];
      const avgAE = annualEfforts.length > 0 ? Math.round(annualEfforts.reduce((a: number, b: number) => a + b, 0) / annualEfforts.length) : null;
      const minAE = annualEfforts.length > 0 ? Math.min(...annualEfforts) : null;

      let genAvg = 85;
      let genMin = 75;
      const gs = await db.prepare(`SELECT general_exemption_average_grade, general_exemption_min_subject_grade FROM grade_settings WHERE school_id = ?`).bind(student.school_id).first<any>();
      if (gs) { genAvg = gs.general_exemption_average_grade ?? 85; genMin = gs.general_exemption_min_subject_grade ?? 75; }

      const generalExemptionEligible = annualEfforts.length === grades.length && avgAE !== null && avgAE >= genAvg && minAE !== null && minAE >= genMin;

      const failCount = grades.filter((g: any) => g.result_status === 'راسب').length;
      const incompleteCount = grades.filter((g: any) => g.result_status === 'مكمل').length;
      const overallStatus = failCount > 0 ? 'راسب' : (incompleteCount > 0 ? 'مكمل' : 'ناجح');

      const ay = await db.prepare(`SELECT id, name FROM academic_years WHERE school_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`).bind(student.school_id).first<any>();

      // Block duplicate active card for same student + academic year
      const existingActive = await db.prepare(`
        SELECT id FROM result_cards
        WHERE student_id = ? AND academic_year_id = ? AND status = 'active'
        LIMIT 1
      `).bind(student.id, ay?.id || 0).first<any>();
      if (existingActive) {
        skipped.push({ student_id: student.id, student_name: student.full_name, reason: 'يوجد كارت نتيجة فعّال بالفعل في نفس السنة الدراسية' });
        continue;
      }

      const token = generateVerificationToken();
      const tokenHash = await hashToken(token);
      const cardNumber = generateCardNumber(student.school_id, student.id);

      const cardData = {
        school: { id: student.school_id, name: student.school_name },
        student: { id: student.id, name: student.full_name, student_number: student.student_number },
        class: { id: student.class_id, name: student.class_name },
        section: { id: student.section_id, name: student.section_name },
        academic_year: ay ? { id: ay.id, name: ay.name } : null,
        settings: { general_exemption_average_grade: genAvg, general_exemption_min_subject_grade: genMin },
        subjects: grades,
        summary: {
          total_subjects: grades.length,
          annual_effort_average: avgAE,
          min_annual_effort: minAE,
          general_exemption_eligible: generalExemptionEligible,
          overall_result_status: overallStatus,
        },
        generated_by: user.id,
        generated_at: Math.floor(Date.now() / 1000),
      };

      await db.prepare(`
        INSERT INTO result_cards (
          school_id, student_id, class_id, section_id, academic_year_id,
          card_number, verification_token, verification_hash,
          student_name_snapshot, class_name_snapshot, section_name_snapshot,
          school_name_snapshot, academic_year_snapshot,
          general_exemption_status, annual_effort_average, min_annual_effort,
          overall_result_status, card_data_json,
          generated_by_user_id, generated_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
      `).bind(
        student.school_id, student.id, student.class_id || null, student.section_id || null, ay?.id || null,
        cardNumber, token, tokenHash,
        student.full_name, student.class_name || null, student.section_name || null,
        student.school_name || null, ay?.name || null,
        generalExemptionEligible ? 1 : 0, avgAE, minAE,
        overallStatus, JSON.stringify(cardData),
        user.id, Math.floor(Date.now() / 1000)
      ).run();

      generated.push({ student_id: student.id, student_name: student.full_name, card_number: cardNumber });
    }

    return c.json({
      data: {
        generated_count: generated.length,
        skipped_count: skipped.length,
        generated,
        skipped,
      },
      message: `تم إنشاء ${generated.length} كارت وتم تخطي ${skipped.length} طالب`,
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء كارتات الشعبة', detail: err.message }, 500);
  }
});

// PUT /api/result-cards/:id/mark-printed
// ===========================================
app.put('/api/result-cards/:id/mark-printed', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const row = await db.prepare(`SELECT school_id, status FROM result_cards WHERE id = ?`).bind(id).first<any>();
    if (!row) return c.json({ error: 'كارت النتيجة غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    if (row.status !== 'active') {
      return c.json({ error: 'لا يمكن تعليم كارت غير فعال كمطبوع' }, 400);
    }
    await db.prepare(`UPDATE result_cards SET printed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).bind(id).run();
    return c.json({ data: { id, printed_at: Math.floor(Date.now() / 1000) }, message: 'تم تعليم الكارت كمطبوع' });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الكارت', detail: err.message }, 500);
  }
});

// PUT /api/result-cards/:id/cancel
// ===========================================
app.put('/api/result-cards/:id/cancel', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const row = await db.prepare(`SELECT school_id, status FROM result_cards WHERE id = ?`).bind(id).first<any>();
    if (!row) return c.json({ error: 'كارت النتيجة غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    await db.prepare(`UPDATE result_cards SET status = 'cancelled', updated_at = unixepoch() WHERE id = ?`).bind(id).run();
    return c.json({ data: { id, status: 'cancelled' }, message: 'تم إلغاء الكارت' });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء الكارت', detail: err.message }, 500);
  }
});

// GET /api/verify/result-card/:token
// Public endpoint — no JWT required
// ===========================================
app.get('/api/verify/result-card/:token', async (c) => {
  const db = c.env.DB;
  const token = c.req.param('token');

  try {
    const row = await db.prepare(`
      SELECT card_number, student_name_snapshot, class_name_snapshot, section_name_snapshot,
             school_name_snapshot, academic_year_snapshot, generated_at, status,
             overall_result_status, general_exemption_status
      FROM result_cards WHERE verification_token = ?
    `).bind(token).first<any>();

    if (!row) {
      return c.json({
        valid: false,
        message: 'الكارت غير موجود أو رمز التحقق غير صحيح',
      }, 404);
    }

    if (row.status === 'cancelled') {
      return c.json({
        valid: false,
        cancelled: true,
        message: 'هذا الكارت ملغى ولا يُعتد به',
        card_number: row.card_number,
        student_name: row.student_name_snapshot,
        school_name: row.school_name_snapshot,
        generated_at: row.generated_at,
      });
    }

    return c.json({
      valid: true,
      card_number: row.card_number,
      student_name: row.student_name_snapshot,
      school_name: row.school_name_snapshot,
      class_name: row.class_name_snapshot,
      section_name: row.section_name_snapshot,
      academic_year: row.academic_year_snapshot,
      generated_at: row.generated_at,
      status: row.status,
      overall_result_status: row.overall_result_status,
      general_exemption_status: row.general_exemption_status === 1,
    });
  } catch (err: any) {
    return c.json({ valid: false, message: 'خطأ في التحقق', detail: err.message }, 500);
  }
});

// ===========================================
// Phase 7: Student Fees & Financial Receipts
// ===========================================

function toArabicIndic(num: number | null | undefined): string {
  if (num === null || num === undefined) return '';
  return String(num).replace(/\d/g, d => String.fromCharCode(0x0660 + parseInt(d, 10)));
}

function generateReceiptNumber(schoolId: number, studentId: number): string {
  const ts = Math.floor(Date.now() / 1000);
  return `REC-${schoolId}-${studentId}-${ts}`;
}

function canManageFees(roleKey: RoleKey): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal', 'accountant', 'registrar'].includes(roleKey);
}

// GET /api/student-fees
// ===========================================
app.get('/api/student-fees', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    const query = c.req.query();
    const studentId = query.student_id ? parseInt(query.student_id, 10) : null;
    const status = query.status || null;

    let sql = `SELECT sf.id, sf.school_id, sf.student_id, sf.academic_year_id, sf.fee_type, sf.amount, sf.currency, sf.due_date, sf.paid_amount, sf.status, sf.notes, sf.created_at, sf.updated_at, st.full_name as student_name, st.student_number, c.name as class_name, s.name as section_name FROM student_fees sf LEFT JOIN students st ON sf.student_id = st.id LEFT JOIN classes c ON st.class_id = c.id LEFT JOIN sections s ON st.section_id = s.id WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND sf.school_id = ?`;
      params.push(resolvedSchoolId);
    }

    if (studentId) { sql += ` AND sf.student_id = ?`; params.push(studentId); }
    if (status) { sql += ` AND sf.status = ?`; params.push(status); }

    sql += ` ORDER BY sf.created_at DESC`;

    const stmt = db.prepare(sql);
    const rows = await stmt.bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الأقساط', detail: err.message }, 500);
  }
});

// POST /api/student-fees
// ===========================================
app.post('/api/student-fees', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إدارة الأقساط' }, 403);
  }

  try {
    const body = await c.req.json();
    let { school_id, student_id, academic_year_id, fee_type, amount, currency, due_date, notes } = body;

    if (scope === 'single' && resolvedSchoolId != null) {
      school_id = resolvedSchoolId;
    }

    if (!school_id || !student_id || !amount) {
      return c.json({ error: 'المدرسة والطالب والمبلغ مطلوبة' }, 400);
    }

    if (user && user.role_key !== 'system_admin' && school_id !== user.school_id) {
      return c.json({ error: 'غير مسموح: لا يمكنك إنشاء قسط في مدرسة أخرى' }, 403);
    }

    const student = await db.prepare('SELECT school_id, status FROM students WHERE id = ?').bind(student_id).first<{ school_id: number; status: string }>();
    if (!student) return c.json({ error: 'الطالب غير موجود' }, 404);
    if (student.school_id !== school_id) return c.json({ error: 'الطالب لا ينتمي لهذه المدرسة' }, 400);
    if (student.status !== 'active') return c.json({ error: 'لا يمكن إنشاء قسط لطالب غير نشط' }, 400);

    const result = await db.prepare(`
      INSERT INTO student_fees (school_id, student_id, academic_year_id, fee_type, amount, currency, due_date, paid_amount, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, unixepoch(), unixepoch())
    `).bind(school_id, student_id, academic_year_id || null, fee_type || 'رسوم دراسية', amount, currency || 'EGP', due_date || null, notes || null).run();

    return c.json({ data: { id: result.meta.last_row_id, school_id, student_id, amount, status: 'pending' } }, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء القسط', detail: err.message }, 500);
  }
});

// PUT /api/student-fees/:id
// ===========================================
app.put('/api/student-fees/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية تعديل الأقساط' }, 403);
  }

  try {
    const existing = await db.prepare('SELECT * FROM student_fees WHERE id = ?').bind(id).first<any>();
    if (!existing) return c.json({ error: 'القسط غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && existing.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }

    const body = await c.req.json();
    const fee_type = body.fee_type !== undefined ? body.fee_type : existing.fee_type;
    const amount = body.amount !== undefined ? body.amount : existing.amount;
    const currency = body.currency !== undefined ? body.currency : existing.currency;
    const due_date = body.due_date !== undefined ? body.due_date : existing.due_date;
    const notes = body.notes !== undefined ? body.notes : existing.notes;

    await db.prepare(`
      UPDATE student_fees SET fee_type = ?, amount = ?, currency = ?, due_date = ?, notes = ?, updated_at = unixepoch() WHERE id = ?
    `).bind(fee_type, amount, currency, due_date, notes, id).run();

    return c.json({ data: { id, fee_type, amount, currency, due_date, notes }, message: 'تم تحديث القسط' });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث القسط', detail: err.message }, 500);
  }
});

// DELETE /api/student-fees/:id
// ===========================================
app.delete('/api/student-fees/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية حذف الأقساط' }, 403);
  }

  try {
    const existing = await db.prepare('SELECT school_id, paid_amount FROM student_fees WHERE id = ?').bind(id).first<{ school_id: number; paid_amount: number }>();
    if (!existing) return c.json({ error: 'القسط غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && existing.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    if (existing.paid_amount > 0) {
      return c.json({ error: 'لا يمكن حذف قسط تم سداد جزء منه' }, 400);
    }

    await db.prepare('DELETE FROM student_fees WHERE id = ?').bind(id).run();
    return c.json({ data: { id }, message: 'تم حذف القسط' });
  } catch (err: any) {
    return c.json({ error: 'فشل في حذف القسط', detail: err.message }, 500);
  }
});

// GET /api/fee-payments
// ===========================================
app.get('/api/fee-payments', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    const query = c.req.query();
    const studentId = query.student_id ? parseInt(query.student_id, 10) : null;
    const studentFeeId = query.student_fee_id ? parseInt(query.student_fee_id, 10) : null;

    let sql = `SELECT fp.id, fp.school_id, fp.student_fee_id, fp.student_id, fp.amount, fp.payment_method, fp.payment_date, fp.receipt_number, fp.notes, fp.created_by_user_id, fp.created_at, st.full_name as student_name, st.student_number, u.full_name as created_by_name FROM fee_payments fp LEFT JOIN students st ON fp.student_id = st.id LEFT JOIN users u ON fp.created_by_user_id = u.id WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND fp.school_id = ?`;
      params.push(resolvedSchoolId);
    }

    if (studentId) { sql += ` AND fp.student_id = ?`; params.push(studentId); }
    if (studentFeeId) { sql += ` AND fp.student_fee_id = ?`; params.push(studentFeeId); }

    sql += ` ORDER BY fp.payment_date DESC`;

    const stmt = db.prepare(sql);
    const rows = await stmt.bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب المدفوعات', detail: err.message }, 500);
  }
});

// POST /api/fee-payments
// ===========================================
app.post('/api/fee-payments', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية تسجيل المدفوعات' }, 403);
  }

  try {
    const body = await c.req.json();
    const { student_fee_id, amount, payment_method, payment_date, notes } = body;

    if (!student_fee_id || !amount || !payment_date) {
      return c.json({ error: 'معرف القسط والمبلغ وتاريخ الدفع مطلوبة' }, 400);
    }

    const fee = await db.prepare('SELECT * FROM student_fees WHERE id = ?').bind(student_fee_id).first<any>();
    if (!fee) return c.json({ error: 'القسط غير موجود' }, 404);

    if (scope === 'single' && resolvedSchoolId && fee.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: القسط لا ينتمي إلى مدرستك' }, 403);
    }

    const remaining = fee.amount - fee.paid_amount;
    if (amount > remaining) {
      return c.json({ error: `المبلغ المدفوع (${amount}) يتجاوز المتبقي (${remaining})` }, 400);
    }

    const newPaid = fee.paid_amount + amount;
    const newStatus = newPaid >= fee.amount ? 'paid' : (newPaid > 0 ? 'partial' : 'pending');

    const result = await db.prepare(`
      INSERT INTO fee_payments (school_id, student_fee_id, student_id, amount, payment_method, payment_date, notes, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).bind(fee.school_id, student_fee_id, fee.student_id, amount, payment_method || 'cash', payment_date, notes || null, user.id).run();

    await db.prepare(`
      UPDATE student_fees SET paid_amount = ?, status = ?, updated_at = unixepoch() WHERE id = ?
    `).bind(newPaid, newStatus, student_fee_id).run();

    return c.json({ data: { id: result.meta.last_row_id, amount, payment_method, remaining: fee.amount - newPaid } }, 201);
  } catch (err: any) {
    return c.json({ error: 'فشل في تسجيل الدفع', detail: err.message }, 500);
  }
});

// GET /api/fee-receipts
// ===========================================
app.get('/api/fee-receipts', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    const query = c.req.query();
    const studentId = query.student_id ? parseInt(query.student_id, 10) : null;

    let sql = `SELECT fr.id, fr.school_id, fr.student_id, fr.receipt_number, fr.total_amount, fr.student_name_snapshot, fr.class_name_snapshot, fr.section_name_snapshot, fr.school_name_snapshot, fr.academic_year_snapshot, fr.status, fr.verification_token, fr.created_at, fr.created_by_user_id, u.full_name as created_by_name FROM fee_receipts fr LEFT JOIN users u ON fr.created_by_user_id = u.id WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND fr.school_id = ?`;
      params.push(resolvedSchoolId);
    }

    if (studentId) { sql += ` AND fr.student_id = ?`; params.push(studentId); }

    sql += ` ORDER BY fr.created_at DESC`;

    const stmt = db.prepare(sql);
    const rows = await stmt.bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الإيصالات', detail: err.message }, 500);
  }
});

// GET /api/fee-receipts/:id
// ===========================================
app.get('/api/fee-receipts/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const row = await db.prepare('SELECT * FROM fee_receipts WHERE id = ?').bind(id).first<any>();
    if (!row) return c.json({ error: 'الإيصال غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    let data = row;
    try {
      data = { ...row, payments_snapshot: JSON.parse(row.payments_snapshot_json || '[]'), payment_ids: JSON.parse(row.payment_ids_json || '[]') };
    } catch { /* leave as-is */ }
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب الإيصال', detail: err.message }, 500);
  }
});

// POST /api/fee-receipts/generate
// ===========================================
app.post('/api/fee-receipts/generate', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إنشاء الإيصالات' }, 403);
  }

  try {
    const body = await c.req.json();
    const { student_id, payment_ids } = body;

    if (!student_id || !Array.isArray(payment_ids) || payment_ids.length === 0) {
      return c.json({ error: 'الطالب ومعرفات المدفوعات مطلوبة' }, 400);
    }

    const student = await db.prepare(`
      SELECT s.id, s.school_id, s.full_name, s.student_number, s.class_id, s.section_id,
             c.name AS class_name, sec.name AS section_name, sch.name AS school_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN schools sch ON s.school_id = sch.id
      WHERE s.id = ? AND s.status = 'active'
    `).bind(student_id).first<any>();

    if (!student) return c.json({ error: 'الطالب غير موجود أو غير نشط' }, 404);
    if (scope === 'single' && resolvedSchoolId && student.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: الطالب لا ينتمي إلى مدرستك' }, 403);
    }

    // Fetch payments
    const placeholders = payment_ids.map(() => '?').join(',');
    const paymentRows = await db.prepare(`
      SELECT fp.*, sf.fee_type FROM fee_payments fp
      JOIN student_fees sf ON fp.student_fee_id = sf.id
      WHERE fp.id IN (${placeholders}) AND fp.student_id = ? AND fp.school_id = ?
    `).bind(...payment_ids, student_id, student.school_id).all<any>();
    const payments = paymentRows.results || [];

    if (payments.length === 0) return c.json({ error: 'لا توجد مدفوعات صالحة' }, 400);

    const totalAmount = payments.reduce((sum: number, p: any) => sum + p.amount, 0);

    const ay = await db.prepare(`SELECT id, name FROM academic_years WHERE school_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`).bind(student.school_id).first<any>();

    const token = generateVerificationToken();
    const tokenHash = await hashToken(token);
    const receiptNumber = generateReceiptNumber(student.school_id, student_id);

    const paymentsSnapshot = payments.map((p: any) => ({
      payment_id: p.id,
      amount: p.amount,
      payment_method: p.payment_method,
      payment_date: p.payment_date,
      fee_type: p.fee_type,
    }));

    await db.prepare(`
      INSERT INTO fee_receipts (
        school_id, student_id, receipt_number, total_amount,
        payment_ids_json, payments_snapshot_json,
        student_name_snapshot, class_name_snapshot, section_name_snapshot,
        school_name_snapshot, academic_year_snapshot,
        verification_token, verification_hash,
        status, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, unixepoch(), unixepoch())
    `).bind(
      student.school_id, student_id, receiptNumber, totalAmount,
      JSON.stringify(payment_ids), JSON.stringify(paymentsSnapshot),
      student.full_name, student.class_name || null, student.section_name || null,
      student.school_name || null, ay?.name || null,
      token, tokenHash,
      user.id
    ).run();

    const newReceipt = await db.prepare('SELECT * FROM fee_receipts WHERE verification_token = ?').bind(token).first<any>();

    return c.json({
      data: {
        receipt: newReceipt,
        verification_url: `/verify/receipt/${token}`,
      },
      message: 'تم إنشاء الإيصال بنجاح',
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء الإيصال', detail: err.message }, 500);
  }
});

// PUT /api/fee-receipts/:id/cancel
// ===========================================
app.put('/api/fee-receipts/:id/cancel', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  if (!user || !canManageFees(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إلغاء الإيصالات' }, 403);
  }

  try {
    const row = await db.prepare('SELECT school_id, status FROM fee_receipts WHERE id = ?').bind(id).first<any>();
    if (!row) return c.json({ error: 'الإيصال غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    if (row.status !== 'active') {
      return c.json({ error: 'لا يمكن إلغاء إيصال غير نشط' }, 400);
    }

    await db.prepare(`UPDATE fee_receipts SET status = 'cancelled', updated_at = unixepoch() WHERE id = ?`).bind(id).run();
    return c.json({ data: { id, status: 'cancelled' }, message: 'تم إلغاء الإيصال' });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء الإيصال', detail: err.message }, 500);
  }
});

// GET /api/verify/receipt/:token
// Public endpoint — no JWT required
// ===========================================
app.get('/api/verify/receipt/:token', async (c) => {
  const db = c.env.DB;
  const token = c.req.param('token');

  try {
    const row = await db.prepare(`
      SELECT receipt_number, student_name_snapshot, class_name_snapshot, section_name_snapshot,
             school_name_snapshot, academic_year_snapshot, total_amount, status, created_at,
             payments_snapshot_json
      FROM fee_receipts WHERE verification_token = ?
    `).bind(token).first<any>();

    if (!row) {
      return c.json({
        valid: false,
        message: 'الإيصال غير موجود أو رمز التحقق غير صحيح',
      }, 404);
    }

    if (row.status === 'cancelled') {
      return c.json({
        valid: false,
        cancelled: true,
        message: 'هذا الإيصال ملغى ولا يُعتد به',
        receipt_number: row.receipt_number,
        student_name: row.student_name_snapshot,
        school_name: row.school_name_snapshot,
        created_at: row.created_at,
      });
    }

    let payments = [];
    try {
      payments = JSON.parse(row.payments_snapshot_json || '[]');
    } catch { /* ignore */ }

    return c.json({
      valid: true,
      receipt_number: row.receipt_number,
      student_name: row.student_name_snapshot,
      school_name: row.school_name_snapshot,
      class_name: row.class_name_snapshot,
      section_name: row.section_name_snapshot,
      academic_year: row.academic_year_snapshot,
      total_amount: row.total_amount,
      created_at: row.created_at,
      status: row.status,
      payments,
    });
  } catch (err: any) {
    return c.json({ valid: false, message: 'خطأ في التحقق', detail: err.message }, 500);
  }
});

// Serve static files (assets, static)
// ===========================================
app.use('/assets/*', serveStatic({ root: './', manifest: {} as any }))
app.use('/static/*', serveStatic({ root: './', manifest: {} as any }))

// ===========================================
// SPA Fallback: serve index.html for all non-API routes
// ===========================================
app.get('/*', async (c) => {
  try {
    const html = await c.env.ASSETS!.fetch(new URL('/index.html', c.req.url))
    if (html.status === 200) {
      return new Response(html.body, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }
  } catch (e) {
    // fallback below
  }
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
