import {DatabaseSync} from 'node:sqlite';
import {fixtureSQL,migrationFiles,migrationSQL,LocalD1,snapshot} from './teaching-load-matrix-fixture.mjs';
export {root,migrationFiles,migrationSQL,snapshot} from './teaching-load-matrix-fixture.mjs';
export const financeFixtureSQL=fixtureSQL+`
INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id) VALUES
 (1,1,'FIN-001','Generated Student A','ذكر','active',1,1),(2,1,'FIN-002','Generated Student B','أنثى','active',1,2),
 (3,2,'SECRET','Foreign Student','ذكر','active',3,3),(4,1,'INACTIVE','Inactive student','ذكر','archived',1,1);
INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version) VALUES(8,1,'Parent','parent@matrix.test',8,'active',1);
`;
export function financeFixture(t,{through='9999',legacy=''}={}) {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');t?.after(()=>db.close());
 for(const file of migrationFiles.filter(f=>f.slice(0,4)<=through))db.exec(migrationSQL(file));
 db.exec(financeFixtureSQL+legacy);return {db,d1:new FinanceLocalD1(db)};
}
// SQLite is synchronous; do not yield half-way through a single-connection
// batch (that would invent nested-transaction failures absent from D1).
class FinanceLocalD1 extends LocalD1 {
 async batch(statements) {
  this.batchSizes.push(statements.length);
  if(this.beforeWrite){const hook=this.beforeWrite;this.beforeWrite=null;hook();}
  this.db.exec('BEGIN');
  try {const rows=statements.map((s,i)=>{
   if(i===this.failAt)throw new Error('injected finance batch stage');
   this.record(s);const stmt=this.db.prepare(s.sql);
   if(stmt.columns().length)return {success:true,results:stmt.all(...s.args),meta:{}};
   const r=stmt.run(...s.args);return {success:true,results:[],meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}};
  });this.db.exec('COMMIT');return rows;}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
}
export const feeDraft=(patch={})=>({school_id:1,student_id:1,academic_year_id:1,fee_type:'رسوم دراسية',amount:100000,currency:'IQD',discount_type:'none',discount_value:0,due_date:null,notes:null,...patch});
export const paymentDraft=(id,patch={})=>({school_id:1,student_fee_id:id,amount:60000,payment_method:'cash',payment_date:1788600000,notes:null,client_request_id:crypto.randomUUID(),...patch});
export const legacyFinanceSQL=`
 INSERT INTO school_settings(school_id) VALUES(1);
 INSERT INTO grade_settings(school_id,updated_by_user_id) VALUES(1,1);
 INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,created_by_user_id,updated_by_user_id) VALUES(1,1,1,1,1,1,1);
 INSERT INTO student_subjects(id,school_id,student_id,subject_id,class_id,section_id,assigned_by_user_id) VALUES(1,1,1,1,1,1,1);
 INSERT INTO grades(school_id,student_subject_id,first_month,second_month,third_month,fourth_month,mid_year_exam,final_exam,annual_effort,final_grade,effective_grade,result_status,updated_by_user_id)
 VALUES(1,1,70,72,74,76,80,80,75,78,78,'ناجح',1);
 INSERT INTO result_cards(school_id,student_id,class_id,section_id,academic_year_id,card_number,verification_token,verification_hash,student_name_snapshot,card_data_json,generated_by_user_id)
 VALUES(1,1,1,1,1,'LOCAL-CARD','LOCAL-CARD-TOKEN','local-hash','Generated student','{"snapshot_version":3,"card_mode":"complete"}',1);
 INSERT INTO employee_salaries(school_id,employee_id,month,year,base_salary,bonus_amount,deduction_amount,net_salary,created_by_user_id) VALUES(1,1,1,2026,750000,10000,5000,755000,1);
 INSERT INTO official_book_templates(id,school_id,title,body_text,created_by_user_id) VALUES(1,1,'Generated template','Generated content',1);
 INSERT INTO official_books(school_id,template_id,document_number,title,body_text,student_id,school_name_snapshot,created_by_user_id) VALUES(1,1,'LOCAL-BOOK','Generated document','Generated immutable body',1,'Generated school',1);
 INSERT INTO timetable_schedule_versions(id,version_key,school_id,academic_year_id,source,previous_revision,created_by_user_id,old_entry_count,new_entry_count,locked_entry_count,proposal_digest)
 VALUES(1,'finance-fixture',1,1,'automatic_adoption',0,1,1,1,1,'local-fixture');
 INSERT INTO timetable_schedule_version_entries(version_id,original_entry_id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked) VALUES(1,1,1,1,1,2,1);
 INSERT INTO student_fees(id,school_id,student_id,academic_year_id,fee_type,amount,currency,paid_amount,status,discount_type,discount_value,discount_amount,net_fee) VALUES
 (1,1,1,1,' رسوم  قديمة ',100000,'IQD',60000,'partial','none',0,0,100000),(2,1,2,NULL,'Legacy USD',150,'USD',0,'pending','none',0,0,150);
 INSERT INTO fee_payments(id,school_id,student_fee_id,student_id,amount,payment_method,payment_date,created_by_user_id) VALUES(1,1,1,1,60000,'cash',1788600000,1);
 INSERT INTO treasury_transactions(id,school_id,transaction_type,category,amount,currency,source_type,source_id,status,created_by) VALUES(1,1,'income','tuition_fee',60000,'IQD','fee_payment',1,'active',1);
 INSERT INTO treasury_accounts(school_id,current_balance) VALUES(1,60000);
 INSERT INTO fee_receipts(id,school_id,student_id,receipt_number,total_amount,payment_ids_json,payments_snapshot_json,verification_token,verification_hash,status,created_by_user_id) VALUES
 (1,1,1,'LEGACY-CANCELLED',60000,'[1]','[{"payment_id":1,"amount":60000}]','legacy-cancelled','hash','cancelled',1),
 (2,1,1,'LEGACY-ACTIVE',60000,'[1]','[{"payment_id":1,"amount":60000}]','legacy-active','hash','active',1);
`;
