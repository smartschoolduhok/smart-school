// Computes SHA-256(password + salt + email) to match worker.ts hashPassword
async function hashPassword(password, email) {
  const salt = 'smart-school-salt-2026';
  const data = new TextEncoder().encode(password + salt + email);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const users = [
  { id: 1, email: 'admin@smart-school.iq', password: 'admin123' },
  { id: 2, email: 'principal@nukhba.iq', password: 'school123' },
  { id: 3, email: 'teacher@nukhba.iq', password: 'teacher123' },
  { id: 4, email: 'owner@rafidain.iq', password: 'owner123' },
  { id: 5, email: 'accountant@rafidain.iq', password: 'accountant123' },
  { id: 6, email: 'registrar@eman.iq', password: 'registrar123' },
];

for (const u of users) {
  const hash = await hashPassword(u.password, u.email);
  console.log(`UPDATE users SET password_hash = '${hash}' WHERE id = ${u.id}; -- ${u.email}`);
}
