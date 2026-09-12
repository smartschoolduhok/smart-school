import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureSQL } from './helpers/teaching-load-matrix-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const migrations = readdirSync(join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort();

function tableSnapshot(db, names) {
  return Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row => ({ ...row }))]));
}

test('0033 is additive, preserves every historical table value and exposes healthy guards', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of migrations.filter(name => !name.startsWith('0033_'))) {
    db.exec(readFileSync(join(root, 'migrations', name), 'utf8'));
  }
  db.exec(fixtureSQL);
  const historicalTables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const before = tableSnapshot(db, historicalTables);

  db.exec(readFileSync(join(root, 'migrations/0033_academic_grade_policies.sql'), 'utf8'));
  assert.deepEqual(tableSnapshot(db, historicalTables), before);
  assert.deepEqual(
    db.prepare("SELECT name,type FROM sqlite_schema WHERE name LIKE 'academic_grade_%' ORDER BY name").all().map(row => [row.name, row.type]),
    [
      ['academic_grade_decision_sets', 'table'],
      ['academic_grade_decision_write_assertions', 'table'],
      ['academic_grade_policies', 'table'],
      ['academic_grade_policy_logs', 'table'],
      ['academic_grade_policy_readiness', 'view'],
      ['academic_grade_policy_write_assertions', 'table'],
    ],
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const readiness = db.prepare('SELECT school_id,active_classes,configured_classes,status FROM academic_grade_policy_readiness ORDER BY school_id').all().map(row => ({ ...row }));
  assert.deepEqual(readiness, [
    { school_id: 1, active_classes: 2, configured_classes: 0, status: 'not_configured' },
    { school_id: 2, active_classes: 1, configured_classes: 0, status: 'not_configured' },
  ]);
  assert.throws(() => db.exec(`
    INSERT INTO academic_grade_policies(
      school_id,academic_year_id,class_id,version,is_current,status,policy_kind,
      exemption_enabled,created_by_user_id,updated_by_user_id
    ) VALUES(1,1,1,1,1,'draft','terminal',1,1,1)
  `), /grade_policy_invalid/);
  assert.throws(() => db.exec(`
    INSERT INTO academic_grade_policies(
      school_id,academic_year_id,class_id,version,is_current,status,policy_kind,
      approved_at,approved_by_user_id,created_by_user_id,updated_by_user_id
    ) VALUES(1,1,1,1,1,'approved','terminal',unixepoch(),1,1,1)
  `), /grade_policy_invalid/);

  db.exec(`
    INSERT INTO academic_grade_policies(
      school_id,academic_year_id,class_id,version,is_current,status,policy_kind,
      source_reference,approved_at,approved_by_user_id,created_by_user_id,updated_by_user_id
    ) VALUES
      (1,1,1,1,1,'approved','terminal','قرار اختباري',unixepoch(),1,1,1),
      (1,1,2,1,1,'approved','non_terminal','قرار اختباري',unixepoch(),1,1,1);
    UPDATE academic_grade_policies SET is_current=0 WHERE school_id=1 AND class_id=1;
    INSERT INTO academic_grade_policies(
      school_id,academic_year_id,class_id,version,is_current,status,policy_kind,
      created_by_user_id,updated_by_user_id
    ) VALUES(1,1,1,2,1,'draft','terminal',1,1);
  `);
  assert.deepEqual(
    { ...db.prepare(`
      SELECT active_classes,configured_classes,approved_classes,pending_draft_classes,status
      FROM academic_grade_policy_readiness WHERE school_id=1
    `).get() },
    {
      active_classes: 2,
      configured_classes: 2,
      approved_classes: 2,
      pending_draft_classes: 1,
      status: 'amendments_pending',
    },
  );
  db.close();
});
