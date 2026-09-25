'use strict';
// Emergency password reset from the server console.
// Usage: npm run reset-password -- <username> <new-password>
const bcrypt = require('bcryptjs');
const { db } = require('../server/db');

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 6) {
  console.log('Usage: npm run reset-password -- <username> <new-password (min 6 chars)>');
  process.exit(1);
}
const r = db.prepare('UPDATE users SET password_hash = ?, active = 1, must_change_password = 1 WHERE username = ?')
  .run(bcrypt.hashSync(password, 10), username);
if (!r.changes) { console.log(`No user named "${username}"`); process.exit(1); }
db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
console.log(`Password for "${username}" reset. They must change it at next login.`);
