import assert from 'node:assert/strict';
import test from 'node:test';
import {financeFixture,migrationFiles,snapshot} from './helpers/finance-fixture.mjs';
import {collectOperationalReadiness} from '../scripts/lib/operational-readiness.mjs';
import {DatabaseSync} from 'node:sqlite';
import {prepareLocalRestore,orderRestoreTables} from '../scripts/lib/local-d1-restore.mjs';

test('D1 export restores a rebuilt parent defined after its populated child',()=>{
 const sql="PRAGMA defer_foreign_keys=TRUE; CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES(1,7); CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(7);";
 const plan=prepareLocalRestore(sql),db=new DatabaseSync(':memory:');
 try{db.exec('BEGIN;'+plan.baseSql+'COMMIT;');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('SELECT parent_id FROM child').get().parent_id,7);}finally{db.close();}
});

test('oversized timetable archive restores exact Unicode snapshot with bound parameters',()=>{
 const text=JSON.stringify({snapshot:'اختبار '.repeat(20000)});
 const sql="CREATE TABLE timetable_week_archives(id INTEGER PRIMARY KEY,snapshot_json TEXT); INSERT INTO timetable_week_archives VALUES(1,'"+text.replaceAll("'","''")+"');";
 const plan=prepareLocalRestore(sql),db=new DatabaseSync(':memory:');
 try{assert.equal(plan.inserts.length,1);db.exec(plan.baseSql);for(const row of plan.inserts)db.prepare(row.sql).run(...row.values);assert.equal(db.prepare('SELECT snapshot_json FROM timetable_week_archives').get().snapshot_json,text);}finally{db.close();}
 assert.throws(()=>prepareLocalRestore(sql.replaceAll('timetable_week_archives','fee_payments')),/Unsupported oversized table/);
});

test('table ordering preserves literal and trigger bodies without reordering data writes',()=>{
 const sql="CREATE TABLE a(id INTEGER); INSERT INTO a VALUES(1); CREATE TABLE b(id INTEGER); CREATE TRIGGER t AFTER INSERT ON b BEGIN INSERT INTO a VALUES(2); END; INSERT INTO b VALUES(3);";
 const db=new DatabaseSync(':memory:');try{db.exec(orderRestoreTables(sql));assert.deepEqual(db.prepare('SELECT id FROM a ORDER BY id').all().map(r=>r.id),[1,2]);}finally{db.close();}
});

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
