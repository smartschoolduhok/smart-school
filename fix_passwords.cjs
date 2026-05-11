const crypto = require('crypto');

function hashPassword(password, email) {
  const salt = 'smart-school-salt-2026';
  const data = password + salt + email;
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

const passwords = [
  ['principal@nukhba.iq', 'principal123'],
  ['accountant@rafidain.iq', 'accountant123'],
];

for (const [email, password] of passwords) {
  console.log(`UPDATE users SET password_hash = '${hashPassword(password, email)}' WHERE email = '${email}';`);
}
