import assert from 'node:assert/strict';
import test from 'node:test';
import {financeFixture,migrationFiles,snapshot} from './helpers/finance-fixture.mjs';
import {collectOperationalReadiness} from '../scripts/lib/operational-readiness.mjs';

test('diagnosis identifies missing policies and process-specific rules without writing or exposing students',async t=>{
 const f=financeFixture(t);f.db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT)');
 migrationFiles.forEach((n,i)=>f.db.prepare('INSERT INTO d1_migrations VALUES(?,?)').run(i+1,n));
 const before=snapshot(f.db);const read=async sql=>{assert.match(sql,/^(SELECT|PRAGMA foreign_key_check)/);return f.db.prepare(sql).all();};
 const report=await collectOperationalReadiness(read,'2026-09-26');
 assert.equal(report.summary.grade_policy_gaps,3);assert.equal(report.summary.regulation_gaps,9);
 assert.deepEqual(new Set(report.regulation_coverage.map(r=>r.process)),new Set(['admission','transfer_in','transfer_out']));
 assert.equal(report.production_ready,false);assert.equal(report.official_sources_verified,false);
 assert.equal(JSON.stringify(report).includes('Generated Student'),false);assert.equal(JSON.stringify(report).includes('password'),false);
 assert.deepEqual(snapshot(f.db),before);
 await assert.rejects(collectOperationalReadiness(read,"2026-01-01';DELETE"));
});
