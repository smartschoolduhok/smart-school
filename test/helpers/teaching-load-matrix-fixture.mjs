import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const migrationFiles = readdirSync(join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort();
export const migrationSQL = f => readFileSync(join(root, 'migrations', f), 'utf8');
export const fixtureSQL = `
INSERT INTO schools(id,name,school_type,city,status) VALUES (1,'A','خاص','Duhok','active'),(2,'Secret School','خاص','Duhok','active');
INSERT INTO academic_years(id,school_id,name,starts_at,ends_at,is_active) VALUES (1,1,'2026-2027','2026-09-01','2027-06-01',1),(2,1,'2025-2026','2025-09-01','2026-06-01',0),(3,2,'Other','2026-09-01','2027-06-01',1);
INSERT INTO classes(id,school_id,name,stage,order_index,status) VALUES (1,1,'Class A','ابتدائي',2,'active'),(2,1,'Class B','ابتدائي',1,'active'),(3,2,'Secret Class','ابتدائي',1,'active'),(4,1,'Archived','ابتدائي',3,'archived');
INSERT INTO sections(id,school_id,class_id,name,status) VALUES (1,1,1,'A','active'),(2,1,1,'B','active'),(3,2,3,'Secret Section','active'),(4,1,1,'Old','archived');
INSERT INTO subjects(id,school_id,class_id,section_id,name,status,order_index) VALUES
 (1,1,1,NULL,'Math','active',1),(2,1,1,NULL,'Arabic','active',2),(3,1,1,1,'Special A','active',3),
 (4,1,2,NULL,'Whole class','active',1),(5,2,3,NULL,'Secret Subject','active',1),(6,1,1,NULL,'Old','archived',4);
INSERT INTO employees(id,school_id,full_name,role,status) VALUES
 (1,1,'Teacher A','teacher','active'),(2,1,'Teacher B','teacher','active'),(3,1,'Accountant','accountant','active'),
 (4,1,'Archived Teacher','teacher','archived'),(5,2,'Secret Teacher','teacher','active'),(6,1,'Teacher C','teacher','active'),(7,1,'Staff','staff','active');
INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version) VALUES
 (1,1,'Owner','owner@matrix.test',2,'active',1),(2,NULL,'Admin','admin@matrix.test',1,'active',1),
 (3,1,'Teacher','teacher@matrix.test',5,'active',1),(4,1,'Accountant','accountant@matrix.test',6,'active',1),
 (5,1,'Principal','principal@matrix.test',3,'active',1),(6,1,'Vice','vice@matrix.test',4,'active',1),(7,1,'Registrar','registrar@matrix.test',7,'active',1);
INSERT INTO timetable_days(school_id,academic_year_id,day_of_week,is_active,order_index) VALUES (1,1,0,1,0),(1,1,1,1,1),(1,1,2,1,2),(1,2,0,1,0),(2,3,0,1,0);
INSERT INTO timetable_slots(id,school_id,academic_year_id,day_of_week,slot_index,slot_type,lesson_number,label,start_time,end_time,is_active) VALUES
 (1,1,1,0,1,'lesson',1,'One','08:00','08:40',1),(2,1,1,0,2,'lesson',2,'Two','08:40','09:20',1),
 (3,1,1,0,3,'lesson',3,'Three','09:20','10:00',1),(4,1,1,0,4,'break',NULL,'Break','10:00','10:10',1),
 (5,1,1,0,5,'lesson',4,'Four','10:10','10:50',1),(6,1,1,1,1,'lesson',1,'One','08:00','08:40',1),
 (7,1,1,2,1,'lesson',1,'One','08:00','08:40',1),(8,1,2,0,1,'lesson',1,'Old','08:00','08:40',1),
 (9,2,3,0,1,'lesson',1,'Secret','08:00','08:40',1);
INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES
 (1,1,1,1,1,1,NULL,4,'active'),(2,1,1,1,2,1,2,4,'active'),(3,1,1,2,NULL,4,6,4,'active'),
 (4,1,2,1,1,1,1,3,'active'),(5,1,2,1,2,2,2,2,'active'),(6,2,3,3,3,5,5,3,'active');
`;
export function fixture({ upgrade = true } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  for (const f of migrationFiles.filter(f => upgrade || !f.startsWith('0027'))) db.exec(migrationSQL(f));
  db.exec(fixtureSQL);
  return { db, d1: new LocalD1(db) };
}
class Statement {
  constructor(owner, sql, args=[]) { this.owner=owner; this.sql=sql; this.args=args; }
  bind(...args) { return new Statement(this.owner,this.sql,args); }
  async first() { this.owner.record(this); return this.owner.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { this.owner.record(this); return {success:true, results:this.owner.db.prepare(this.sql).all(...this.args), meta:{}}; }
  async run() {
    this.owner.record(this);
    const stmt=this.owner.db.prepare(this.sql);
    if (stmt.columns().length) return {success:true,results:stmt.all(...this.args),meta:{}};
    const r=stmt.run(...this.args);
    return {success:true,results:[],meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}};
  }
}
export class LocalD1 {
  constructor(db) { this.db=db; this.sql=[]; this.batchSizes=[]; this.beforeWrite=null; this.failAt=null; this.executions=[]; this.queryBudget=Infinity; }
  resetQueryBudget(limit=50) { this.executions=[]; this.queryBudget=limit; }
  record(statement) {
    if (this.executions.length >= this.queryBudget) throw new Error('D1 request query budget exceeded');
    if (statement.args.length > 100) throw new Error('D1 bound parameter limit exceeded');
    this.executions.push({sql:statement.sql,parameters:statement.args.length});
  }
  prepare(sql) { this.sql.push(sql); return new Statement(this,sql); }
  async batch(statements) {
    this.batchSizes.push(statements.length);
    const write=statements.some(s=>/^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql));
    if(write && this.beforeWrite) { const f=this.beforeWrite; this.beforeWrite=null; f(); }
    this.db.exec('BEGIN');
    try {
      const results=[];
      for(let i=0;i<statements.length;i++){
        if(write && i===this.failAt) throw new Error('injected middle failure');
        results.push(await statements[i].run());
      }
      this.db.exec('COMMIT'); return results;
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
}
export function entry(db,loadId,slotId,locked=0) {
  return Number(db.prepare('INSERT INTO timetable_entries(school_id,academic_year_id,teaching_load_id,slot_id,is_locked,created_by_user_id,updated_by_user_id) VALUES (1,1,?,?,?,1,1)').run(loadId,slotId,locked).lastInsertRowid);
}
export function revision(db) { return db.prepare('SELECT revision FROM timetable_revisions WHERE school_id=1 AND academic_year_id=1').get().revision; }
export function snapshot(db) {
  const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(tables.map(({name})=>[name,db.prepare(`SELECT * FROM "${name}"`).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
}
export function addConstraints(db, employee, values) {
  const keys=Object.keys(values);
  db.prepare(`INSERT INTO timetable_teacher_constraints(school_id,academic_year_id,employee_id,${keys.join(',')}) VALUES(1,1,?,${keys.map(()=>'?').join(',')})`).run(employee,...Object.values(values));
}
export function addAvailability(db,employee,slot,status) {
  db.prepare('INSERT INTO timetable_teacher_availability(school_id,academic_year_id,employee_id,slot_id,status) VALUES(1,1,?,?,?)').run(employee,slot,status);
}

export function invalidateAssignedTeacher(db, kind) {
  if (kind === 'archived') db.exec("UPDATE employees SET status='archived' WHERE id=2");
  else if (kind === 'nonteacher') db.exec("UPDATE employees SET role='accountant' WHERE id=2");
  else if (kind === 'other-school') db.exec("UPDATE employees SET school_id=2, full_name='Secret moved teacher' WHERE id=2");
  else if (kind === 'missing') {
    // Defensive corrupted-read fixture only: keep the dangling ID without
    // weakening or synthetically altering the genuine schema/triggers.
    db.exec('PRAGMA foreign_keys=OFF; DELETE FROM employees WHERE id=2; PRAGMA foreign_keys=ON;');
  } else throw new Error('Unknown defensive fixture');
}

export function benchmarkMatrix(db, subjectCount, sectionCount, populated=false) {
  db.exec("INSERT INTO classes(id,school_id,name,stage,order_index,status) VALUES(10,1,'Benchmark','ابتدائي',10,'active')");
  for(let s=0;s<sectionCount;s++) db.prepare("INSERT INTO sections(id,school_id,class_id,name,status) VALUES(?,1,10,?,'active')").run(100+s,'Section '+s);
  const changes=[];
  for(let i=0;i<subjectCount;i++) {
    db.prepare("INSERT INTO subjects(id,school_id,class_id,name,status,order_index) VALUES(?,1,10,?,'active',?)").run(100+i,'Subject '+i,i);
    for(let s=0;s<sectionCount;s++) {
      if(populated) db.prepare("INSERT INTO timetable_teaching_loads(school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(1,1,10,?,?,1,3,'active')").run(100+s,100+i);
      changes.push({subject_id:100+i,section_id:100+s,action:'upsert',employee_id:populated?2:1,weekly_periods:3});
    }
  }
  return changes;
}
