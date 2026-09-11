import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {allocateInstallments,parseInstallmentPlan} from '../src/lib/financeFees.ts';
import {root,financeFixture,feeDraft,paymentDraft,snapshot,migrationSQL,legacyFinanceSQL} from './helpers/finance-fixture.mjs';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());
const secret='generated-local-installment-parent-secret';
const tokens=Object.fromEntries(await Promise.all(['owner','parent','teacher','accountant'].map(async role=>[role,await signJWT({email:role+'@matrix.test',auth_version:1},secret)])));

async function call(f,method,path,input,role='owner'){
 const response=await app.request('http://localhost/api/'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[role]},body:input===undefined?undefined:JSON.stringify(input)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
 return {status:response.status,body:await response.json()};
}
async function createFee(f,patch={}){const response=await call(f,'POST','student-fees',feeDraft(patch));assert.equal(response.status,201,JSON.stringify(response));return response.body.data;}
async function pay(f,feeId,patch={}){const response=await call(f,'POST','fee-payments',paymentDraft(feeId,patch));assert.ok([200,201].includes(response.status),JSON.stringify(response));return response.body.data;}
async function plan(f,fee,items,patch={}){return call(f,'PUT',`student-fees/${fee.id}/installment-plan`,{school_id:1,expected_fee_revision:fee.finance_revision,items,...patch});}
const standardPlan=[
 {label:'الدفعة الأولى',amount:50000,due_date:'2026-09-01'},
 {label:'الدفعة الثانية',amount:25000,due_date:'2027-01-01'},
 {label:'الدفعة الثالثة',amount:25000,due_date:'2027-04-01'},
];

test('populated 0031 to 0032 migration preserves every historical value and adds only the versioned schema',t=>{
 const f=financeFixture(t,{through:'0027',legacy:legacyFinanceSQL});
 for(const file of ['0028_finance_fee_payment_integrity.sql','0029_resource_access_links.sql','0030_grade_revision.sql','0031_treasury_payroll_integrity.sql'])f.db.exec(migrationSQL(file));
 const before=snapshot(f.db);f.db.exec('BEGIN');f.db.exec(migrationSQL('0032_fee_installments_receipt_snapshots.sql'));f.db.exec('COMMIT');const after=snapshot(f.db);
 for(const [table,rows] of Object.entries(before)){
  assert.equal(after[table].length,rows.length,table);const keys=rows.length?Object.keys(rows[0]):f.db.prepare(`PRAGMA table_info("${table}")`).all().map(column=>column.name).filter(key=>Object.hasOwn(rows[0]??{},key));
  const project=row=>Object.fromEntries(keys.map(key=>[key,row[key]]));assert.deepEqual(after[table].map(project),rows.map(project),table);
 }
 assert.equal(after.fee_installment_plans.length,0);assert.equal(after.fee_installment_items.length,0);
 const columns=f.db.prepare("PRAGMA table_info('fee_receipts')").all().map(column=>column.name);
 for(const column of ['receipt_schema_version','student_number_snapshot','currency_snapshot','received_by_snapshot','financial_summary_snapshot_json','installment_plan_snapshot_json','replaces_receipt_id'])assert.ok(columns.includes(column),column);
 assert.ok(after.fee_receipts.every(receipt=>receipt.receipt_schema_version===1&&receipt.replaces_receipt_id===null));
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger' AND (name LIKE 'trg_fee_installment_%' OR name LIKE 'trg_student_fees_%installment%' OR name LIKE 'trg_fee_receipts_snapshot_extension_%')").get().n,11);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('installment parser is exact whole-IQD metadata and allocation is deterministic oldest-first',()=>{
 const parsed=parseInstallmentPlan({school_id:1,expected_fee_revision:0,items:standardPlan},100000);
 assert.deepEqual(parsed.items.map(item=>item.percentage_basis_points),[5000,2500,2500]);
 assert.deepEqual(allocateInstallments(parsed.items.map((item,index)=>({...item,id:index+1,sequence_no:item.sequence})),60000,'2026-09-10').map(item=>[item.paid_amount,item.remaining_amount,item.status]),[
  [50000,0,'paid'],[10000,15000,'partial'],[0,25000,'upcoming'],
 ]);
 for(const bad of [
  {school_id:1,expected_fee_revision:0,items:[...standardPlan.slice(0,2)]},
  {school_id:1,expected_fee_revision:0,items:[{label:'x',amount:100000,due_date:'2026-02-30'}]},
  {school_id:1,expected_fee_revision:0,items:[{label:'first',amount:50000,due_date:'2027-01-01'},{label:'second',amount:50000,due_date:'2026-09-01'}]},
  {school_id:1,expected_fee_revision:0,items:[{label:'x',amount:99999.5,due_date:'2026-09-01'}]},
 ])assert.throws(()=>parseInstallmentPlan(bad,100000));
});

test('database authority rejects a nonchronological installment schedule',async t=>{
 const f=financeFixture(t),fee=await createFee(f);
 f.db.prepare("INSERT INTO fee_installment_plans(plan_key,school_id,student_fee_id,fee_revision_snapshot,status,created_by_user_id) VALUES('raw-plan-key-0001',1,?,0,'draft',1)").run(fee.id);
 const planId=f.db.prepare("SELECT id FROM fee_installment_plans WHERE plan_key='raw-plan-key-0001'").get().id;
 f.db.prepare("INSERT INTO fee_installment_items(plan_id,school_id,sequence_no,label,amount,percentage_basis_points,due_date) VALUES(?,1,1,'first',50000,5000,'2027-01-01'),(?,1,2,'second',50000,5000,'2026-09-01')").run(planId,planId);
 assert.throws(()=>f.db.prepare("UPDATE fee_installment_plans SET status='active',updated_at=unixepoch() WHERE id=?").run(planId),/installment_plan_invalid/);
 assert.equal(f.db.prepare('SELECT status FROM fee_installment_plans WHERE id=?').get(planId).status,'draft');
});

test('plan create, payment allocation, replacement and soft disable preserve history',async t=>{
 const f=financeFixture(t),fee=await createFee(f);
 let response=await plan(f,fee,standardPlan);assert.equal(response.status,200,JSON.stringify(response));
 const first=response.body.data.plan;assert.equal(first.items.length,3);assert.equal(first.items.reduce((sum,item)=>sum+item.amount,0),100000);
 await pay(f,fee.id);
 response=await call(f,'GET',`student-fees/${fee.id}/installment-plan?school_id=1`);assert.equal(response.status,200);
 assert.deepEqual(response.body.data.plan.items.map(item=>[item.paid_amount,item.remaining_amount,item.status]),[[50000,0,'paid'],[10000,15000,'partial'],[0,25000,'upcoming']]);
 response=await call(f,'PUT',`student-fees/${fee.id}/installment-plan`,{school_id:1,expected_fee_revision:1,items:[
  {label:'الأولى',amount:40000,due_date:'2026-09-01'},{label:'الثانية',amount:60000,due_date:'2027-02-01'},
 ]});assert.equal(response.status,200,JSON.stringify(response));
 const second=response.body.data.plan;assert.notEqual(second.id,first.id);
 assert.equal(f.db.prepare('SELECT status FROM fee_installment_plans WHERE id=?').get(first.id).status,'superseded');
 assert.throws(()=>f.db.prepare('DELETE FROM fee_installment_plans WHERE id=?').run(first.id),/finance_operation_stale/);
 assert.throws(()=>f.db.prepare('UPDATE fee_installment_items SET amount=1 WHERE plan_id=?').run(second.id),/finance_operation_stale/);
 response=await call(f,'PUT',`student-fees/${fee.id}`,{school_id:1,amount:120000});assert.equal(response.status,409);assert.equal(response.body.code,'installment_plan_active');
 response=await call(f,'DELETE',`student-fees/${fee.id}/installment-plan`,{school_id:1,expected_plan_id:second.id});assert.equal(response.status,200);
 assert.equal(f.db.prepare('SELECT status FROM fee_installment_plans WHERE id=?').get(second.id).status,'cancelled');
 response=await call(f,'PUT',`student-fees/${fee.id}`,{school_id:1,amount:120000});assert.equal(response.status,200,JSON.stringify(response));
});

test('invalid or stale plan requests roll back every plan row',async t=>{
 const f=financeFixture(t),fee=await createFee(f),before=snapshot(f.db);
 let response=await call(f,'PUT',`student-fees/${fee.id}/installment-plan`,{school_id:1,expected_fee_revision:0,items:[{label:'ناقص',amount:99999,due_date:'2026-09-01'}]});
 assert.equal(response.body.code,'installment_plan_total_mismatch');assert.deepEqual(snapshot(f.db),before);
 await pay(f,fee.id,{amount:1000});
 response=await plan(f,fee,standardPlan);assert.equal(response.status,409);assert.equal(response.body.code,'finance_operation_stale');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fee_installment_plans').get().n,0);
});

test('version-2 receipt snapshots account, installment, receiver and replacement chain immutably',async t=>{
 const f=financeFixture(t),fee=await createFee(f,{discount_type:'fixed',discount_value:10000});
 const items=[{label:'الأولى',amount:45000,due_date:'2026-09-01'},{label:'الثانية',amount:45000,due_date:'2027-01-01'}];
 assert.equal((await plan(f,fee,items)).status,200);
 const payment=await pay(f,fee.id,{amount:25000,notes:'Payment snapshot note'});
 let response=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[payment.id]});assert.equal(response.status,200,JSON.stringify(response));
 const first=response.body.data.receipt,summary=JSON.parse(first.financial_summary_snapshot_json),plans=JSON.parse(first.installment_plan_snapshot_json);
 assert.equal(first.receipt_schema_version,2);assert.equal(first.student_number_snapshot,'FIN-001');assert.equal(first.currency_snapshot,'IQD');assert.equal(first.received_by_snapshot,'Owner');
 assert.deepEqual([summary.original_fee,summary.discount_amount,summary.net_due,summary.paid_before,summary.this_payment,summary.total_paid,summary.remaining_after,summary.payment_ratio_basis_points],[100000,10000,90000,0,25000,25000,65000,2777]);
 assert.equal(plans.length,1);assert.deepEqual(plans[0].items.map(item=>item.status),['partial','upcoming']);
 assert.throws(()=>f.db.prepare("UPDATE fee_receipts SET financial_summary_snapshot_json='{}' WHERE id=?").run(first.id),/finance_operation_stale/);

 response=await call(f,'PUT',`fee-receipts/${first.id}/cancel`,{school_id:1,cancel_reason:'نسخة بديلة'});assert.equal(response.status,200);
 response=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[payment.id]});assert.equal(response.status,200,JSON.stringify(response));
 const replacement=response.body.data.receipt;assert.equal(replacement.replaces_receipt_id,first.id);assert.notEqual(replacement.id,first.id);
 assert.equal(f.db.prepare('SELECT status FROM fee_receipts WHERE id=?').get(first.id).status,'cancelled');
 const verified=await app.request('http://localhost/api/verify/receipt/'+replacement.verification_token,{}, {DB:f.d1,APP_ENV:'test'}),publicBody=await verified.json();
 assert.equal(publicBody.valid,true,JSON.stringify(publicBody));assert.equal(publicBody.status,'active');assert.equal(publicBody.currency,'IQD');
 for(const privateField of ['payments','class_name','section_name'])assert.equal(Object.hasOwn(publicBody,privateField),false);
 await call(f,'PUT',`fee-receipts/${replacement.id}/cancel`,{school_id:1,cancel_reason:'اختبار الإلغاء'});
 const cancelled=await (await app.request('http://localhost/api/verify/receipt/'+replacement.verification_token,{}, {DB:f.d1,APP_ENV:'test'})).json();
 assert.equal(cancelled.cancelled,true);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.total_amount,25000);
});

test('parent finance is read-only, resource-linked, sanitized and revoked immediately',async t=>{
 const f=financeFixture(t),fee=await createFee(f,{notes:'PRIVATE FEE NOTE'});
 await plan(f,fee,standardPlan,{notes:'PRIVATE PLAN NOTE'});const payment=await pay(f,fee.id,{amount:25000,notes:'PRIVATE PAYMENT NOTE'});
 const receipt=(await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[payment.id]})).body.data.receipt;
 let response=await call(f,'GET','parent/students/1/finance',undefined,'parent');assert.equal(response.status,404);
 f.db.exec("INSERT INTO parent_student_links(school_id,parent_user_id,student_id,status,created_by_user_id) VALUES(1,8,1,'active',1),(1,8,2,'active',1)");
 response=await call(f,'GET','parent/students/1/finance',undefined,'parent');assert.equal(response.status,200,JSON.stringify(response));
 assert.deepEqual(response.body.data.totals,{original_fee:100000,discount_amount:0,net_due:100000,paid_amount:25000,remaining_amount:75000,payment_ratio_basis_points:2500});
 assert.equal(response.body.data.linked_students.length,2);assert.equal(response.body.data.fees[0].installment_plan.items[0].paid_amount,25000);
 const serialized=JSON.stringify(response.body);assert.ok(!serialized.includes('PRIVATE FEE NOTE'));assert.ok(!serialized.includes('PRIVATE PLAN NOTE'));assert.ok(!serialized.includes('PRIVATE PAYMENT NOTE'));assert.ok(!serialized.includes('cancel_reason'));assert.ok(!serialized.includes('created_by_user_id'));
 assert.equal((await call(f,'GET','student-fees?school_id=1',undefined,'parent')).status,403);
 response=await call(f,'GET',`parent/fee-receipts/${receipt.id}`,undefined,'parent');assert.equal(response.status,200);assert.equal(response.body.data.student_number_snapshot,'FIN-001');assert.ok(!JSON.stringify(response.body).includes('PRIVATE PLAN NOTE'));assert.ok(!JSON.stringify(response.body).includes('PRIVATE PAYMENT NOTE'));
 f.db.exec("UPDATE parent_student_links SET status='inactive' WHERE parent_user_id=8 AND student_id=1");
 assert.equal((await call(f,'GET','parent/students/1/finance',undefined,'parent')).status,404);
 assert.equal((await call(f,'GET',`parent/fee-receipts/${receipt.id}`,undefined,'parent')).status,404);
 assert.equal((await call(f,'GET','parent/students/2/finance',undefined,'parent')).status,200);
 assert.equal((await call(f,'GET','parent/students/1/finance',undefined,'teacher')).status,403);
});
