const fs = require('fs');
let w = fs.readFileSync('src/worker.ts', 'utf8');

// 1) Fix login endpoint: add inactive user pre-check
const oldLogin = `    const row = await db.prepare(`+
"`"+`
      SELECT u.id, u.email, u.full_name, u.role_id, u.school_id, u.password_hash,
             r.key AS role_key, r.name AS role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email = ? AND u.status = 'active'
    `+"`"+`).bind(email).first<{
      id: number; email: string; full_name: string; role_id: number; school_id: number | null;
      password_hash: string | null; role_key: string; role_name: string;
    }>()`;

const newLogin = `    // Pre-check for inactive users to return clear message
    const inactiveCheck = await db.prepare(`+"`"+`SELECT id, status FROM users WHERE email = ?`+"`"+`).bind(email).first<{ id: number; status: string }>();
    if (inactiveCheck && inactiveCheck.status !== 'active') {
      return c.json({ error: 'هذا الحساب غير فعال، يرجى التواصل مع الإدارة' }, 403);
    }

    const row = await db.prepare(`+"`"+`
      SELECT u.id, u.email, u.full_name, u.role_id, u.school_id, u.password_hash,
             r.key AS role_key, r.name AS role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email = ? AND u.status = 'active'
    `+"`"+`).bind(email).first<{
      id: number; email: string; full_name: string; role_id: number; school_id: number | null;
      password_hash: string | null; role_key: string; role_name: string;
    }>()`;

if (!w.includes(oldLogin)) {
  console.error('Could not find oldLogin pattern');
  process.exit(1);
}
w = w.replace(oldLogin, newLogin);

// 2) Fix grade-settings PUT: add role-based restriction
const oldPut = `    const scope = c.get('scope');
    const resolvedSchoolId = c.get('resolvedSchoolId');

    // Non-admin users: school_id is derived from JWT. Reject body school_id that doesn't match.`;

const newPut = `    // Role-based permission: only admin, owner, principal, vice_principal can update
    if (user && !['system_admin', 'school_owner', 'principal', 'vice_principal'].includes(user.role_key)) {
      return c.json({ error: 'غير مسموح: لا تملك صلاحية تعديل إعدادات الدرجات' }, 403);
    }

    const scope = c.get('scope');
    const resolvedSchoolId = c.get('resolvedSchoolId');

    // Non-admin users: school_id is derived from JWT. Reject body school_id that doesn't match.`;

if (!w.includes(oldPut)) {
  console.error('Could not find oldPut pattern');
  process.exit(1);
}
w = w.replace(oldPut, newPut);

fs.writeFileSync('src/worker.ts', w, 'utf8');
console.log('worker.ts updated successfully');
