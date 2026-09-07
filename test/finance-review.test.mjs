import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {preflightFinance} from '../scripts/preflight-finance.mjs';
import {LocalD1} from './helpers/teaching-load-matrix-fixture.mjs';
import {assertFinanceSeed} from './helpers/finance-seed-assertions.mjs';
import {root,financeFixture,legacyFinanceSQL,migrationFiles,migrationSQL,snapshot,feeDraft,paymentDraft} from './helpers/finance-fixture.mjs';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');after(()=>vite.close());
const secret='generated-local-finance-review-only-secret';
const token=await signJWT({email:'owner@matrix.test',auth_version:1},secret);
async function call(f,method,path,input){const r=await app.request('http://localhost/api/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});return {status:r.status,body:await r.json()};}
function legacy(t,change=''){
 const f=financeFixture(t,{through:'0027',legacy:legacyFinanceSQL.replaceAll('60000','20000')});
 f.db.exec("UPDATE fee_receipts SET status='cancelled';"+change);
 f.db.exec(migrationSQL('0028_finance_fee_payment_integrity.sql'));return f;
}
test('review 1: exact fresh migrations then repository seed succeeds without weakening triggers',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
 for(const file of migrationFiles)db.exec(migrationSQL(file));
 assert.doesNotThrow(()=>db.exec(readFileSync(join(root,'seed.sql'),'utf8')));
 assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 await assertFinanceSeed(new LocalD1(db));assert.equal(preflightFinance(db).operational_ready,true);
});
for(const drift of ['fee','treasury'])for(const operation of ['payment','metadata','amount','cancel'])test('review 2: '+drift+' drift blocks '+operation+' without reconciliation',async t=>{
 const f=legacy(t,drift==='fee'?'UPDATE student_fees SET paid_amount=50000 WHERE id=1':'UPDATE treasury_accounts SET current_balance=current_balance+1');
 const before=snapshot(f.db),r=operation==='payment'?await call(f,'POST','fee-payments',paymentDraft(1,{amount:1000})):
  operation==='cancel'?await call(f,'PUT','fee-payments/1/cancel',{school_id:1,cancel_reason:'Local correction'}):
  await call(f,'PUT','student-fees/1',{school_id:1,...(operation==='metadata'?{notes:'Local edit'}:{amount:120000})});
 assert.equal(r.body.code,'finance_reconciliation_required',JSON.stringify(r));assert.ok(r.status>=400&&r.status<500);assert.deepEqual(snapshot(f.db),before);
});
test('review 3: fee year A rather than currently active B is snapshotted on receipt',async t=>{
 const f=financeFixture(t),a=await call(f,'POST','student-fees',feeDraft()),p=await call(f,'POST','fee-payments',paymentDraft(a.body.data.id));
 const year=f.db.prepare('SELECT name FROM academic_years WHERE id=1').get().name;
 f.db.exec('UPDATE academic_years SET is_active=0 WHERE school_id=1; UPDATE academic_years SET is_active=1 WHERE id=2;');
 const r=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[p.body.data.id]});assert.equal(r.status,200);assert.equal(r.body.data.receipt.academic_year_snapshot,year);
});
test('review 4: direct SQL key-only tampering cannot change fee identity',t=>{
 const f=legacy(t),before=snapshot(f.db);assert.throws(()=>f.db.exec("UPDATE student_fees SET fee_type_key='Other' WHERE id=1"),/invalid_finance_request/);assert.deepEqual(snapshot(f.db),before);
});

for(const drift of ['fee','treasury'])for(const operation of ['payment','metadata','amount','cancel'])test('DB authority: '+drift+' drift blocks raw SQL '+operation, t=>{
 const f=legacy(t,drift==='fee'?'UPDATE student_fees SET paid_amount=50000 WHERE id=1':'UPDATE treasury_accounts SET current_balance=current_balance+1');
 const before=snapshot(f.db),sql=operation==='payment'?"INSERT INTO fee_payments(school_id,student_fee_id,student_id,amount,payment_method,payment_date,created_by_user_id,client_request_id,request_fingerprint) VALUES(1,1,1,1000,'cash',1788600000,1,'local-review-request-0001','local-fingerprint')":
 operation==='cancel'?"UPDATE fee_payments SET status='cancelled',cancelled_at=unixepoch(),cancelled_by_user_id=1,cancel_reason='Local test' WHERE id=1":
 operation==='metadata'?"UPDATE student_fees SET notes='Local test' WHERE id=1":'UPDATE student_fees SET amount=120000,net_fee=120000 WHERE id=1';
 assert.throws(()=>f.db.exec(sql),/finance_reconciliation_required/);assert.deepEqual(snapshot(f.db),before);
});
const readinessCases=[
 ['paid cache','UPDATE student_fees SET paid_amount=50000 WHERE id=1','fee_paid_ledger_mismatch'],
 ['status','UPDATE student_fees SET status=\'overdue\' WHERE id=1','fee_status_net_mismatch'],
 ['net discount','UPDATE student_fees SET discount_amount=1 WHERE id=1','fee_discount_net_mismatch'],
 ['fractional fee','UPDATE student_fees SET amount=100000.5 WHERE id=1','invalid_whole_iqd_fee'],
 ['fractional payment','UPDATE fee_payments SET amount=20000.5 WHERE id=1','invalid_whole_iqd_payment'],
 ['foreign payment student','UPDATE fee_payments SET student_id=2 WHERE id=1','payment_scope_mismatch'],
 ['missing treasury link','DELETE FROM treasury_transactions','payment_treasury_link_mismatch'],
 ['mismatched treasury link','UPDATE treasury_transactions SET category=\'other_income\'','payment_treasury_link_mismatch'],
 ['missing account','DELETE FROM treasury_accounts','treasury_account_missing'],
 ['treasury drift','UPDATE treasury_accounts SET current_balance=current_balance+1','treasury_balance_ledger_mismatch'],
 ['currency','UPDATE treasury_transactions SET currency=\'USD\'','unsupported_active_treasury_currency'],
];
for(const [label,change,code]of readinessCases)test('read-only preflight reports operational blocker: '+label,t=>{
 const f=financeFixture(t,{through:'0027',legacy:legacyFinanceSQL.replaceAll('60000','20000')});
 f.db.exec('DELETE FROM fee_receipts;'+change);const before=snapshot(f.db),result=preflightFinance(f.db);
 assert.equal(result.migration_safe,true,JSON.stringify(result));assert.equal(result.operational_ready,false);
 assert.ok(result.operational_blockers.some(x=>x.code===code),JSON.stringify(result));
 if(label==='status')assert.ok(result.warnings.some(x=>x.code==='legacy_fee_status_review'&&x.status==='overdue'));
 assert.deepEqual(snapshot(f.db),before);
 // Migration does not silently repair these operational blockers.
 f.db.exec(migrationSQL('0028_finance_fee_payment_integrity.sql'));
 const after=snapshot(f.db);
 for(const table of ['student_fees','fee_payments','treasury_accounts','treasury_transactions'])for(let i=0;i<before[table].length;i++)
  for(const [key,value]of Object.entries(before[table][i]))assert.deepEqual(after[table][i][key],value,table+'.'+key);
});
test('preflight distinguishes duplicate migration blocker from financial readiness',t=>{
 const f=financeFixture(t,{through:'0027',legacy:legacyFinanceSQL});
 f.db.exec("INSERT INTO student_fees(school_id,student_id,academic_year_id,fee_type,amount,currency) VALUES(1,1,1,'رسوم قديمة',100000,'IQD')");
 const before=snapshot(f.db),r=preflightFinance(f.db);assert.equal(r.migration_safe,false);assert.equal(r.operational_ready,false);
 assert.ok(r.migration_blockers.some(x=>x.code==='duplicate_student_fee'));assert.deepEqual(snapshot(f.db),before);
});
test('consistent legacy financial state still permits metadata, posting and cancellation',async t=>{
 const f=legacy(t);
 assert.equal((await call(f,'PUT','student-fees/1',{school_id:1,notes:'reviewed local metadata'})).status,200);
 const p=await call(f,'POST','fee-payments',paymentDraft(1,{amount:1000}));assert.equal(p.status,201);
 assert.equal((await call(f,'PUT','fee-payments/'+p.body.data.id+'/cancel',{school_id:1,cancel_reason:'local test'})).status,200);
 assert.equal(f.db.prepare('SELECT paid_amount FROM student_fees WHERE id=1').get().paid_amount,20000);
 assert.equal(f.db.prepare('SELECT current_balance FROM treasury_accounts WHERE school_id=1').get().current_balance,20000);
});
async function paidFee(f,patch={}){const a=await call(f,'POST','student-fees',feeDraft(patch));assert.equal(a.status,201,JSON.stringify(a));
 const p=await call(f,'POST','fee-payments',paymentDraft(a.body.data.id));assert.equal(p.status,201,JSON.stringify(p));return p.body.data.id;}
const receiptInput=ids=>({school_id:1,student_id:1,payment_ids:ids});
for(const years of [[1,1],[null,null]])test('receipt accepts multiple fee types in same nullable year: '+JSON.stringify(years),async t=>{
 const f=financeFixture(t),ids=[];for(let i=0;i<years.length;i++)ids.push(await paidFee(f,{fee_type:'Fee '+i,academic_year_id:years[i]}));
 const r=await call(f,'POST','fee-receipts/generate',receiptInput(ids));assert.equal(r.status,200,JSON.stringify(r));
 const doc=r.body.data.receipt,year=years[0]===null?null:f.db.prepare('SELECT name FROM academic_years WHERE id=1').get().name;
 assert.equal(doc.academic_year_snapshot,year);const details=JSON.parse(doc.payments_snapshot_json);
 assert.ok(details.every(p=>p.academic_year_id===years[0]&&p.academic_year_name===year&&p.student_fee_id>0));
});
for(const years of [[1,2],[1,null]])test('mixed nullable fee years reject entire receipt: '+JSON.stringify(years),async t=>{
 const f=financeFixture(t),ids=[];for(let i=0;i<years.length;i++)ids.push(await paidFee(f,{fee_type:'Fee '+i,academic_year_id:years[i]}));
 const before=snapshot(f.db),r=await call(f,'POST','fee-receipts/generate',receiptInput(ids));
 assert.equal(r.body.code,'receipt_academic_year_conflict');assert.equal(r.status,400);assert.deepEqual(snapshot(f.db),before);
 assert.throws(()=>f.db.prepare("INSERT INTO fee_receipts(school_id,student_id,receipt_number,total_amount,payment_ids_json,verification_token,verification_hash,created_by_user_id) VALUES(1,1,'local',120000,?,'local-token','hash',1)").run(JSON.stringify(ids)),/receipt_academic_year_conflict/);
 assert.deepEqual(snapshot(f.db),before);
});
test('public verification and print retain immutable fee year after active year and name changes',async t=>{
 const f=financeFixture(t),p=await paidFee(f),doc=(await call(f,'POST','fee-receipts/generate',receiptInput([p]))).body.data.receipt;
 f.db.exec("UPDATE academic_years SET is_active=0 WHERE school_id=1; UPDATE academic_years SET is_active=1 WHERE id=2; UPDATE academic_years SET name='Renamed local old year' WHERE id=1;");
 const verified=await app.request('http://localhost/api/verify/receipt/'+doc.verification_token,{}, {DB:f.d1,APP_ENV:'test'});
 const publicBody=await verified.json();assert.equal(verified.status,200);
 assert.equal(publicBody.academic_year,doc.academic_year_snapshot);
 assert.deepEqual(publicBody.payments,JSON.parse(doc.payments_snapshot_json));
 assert.equal((await call(f,'PUT','fee-receipts/'+doc.id+'/mark-printed',{school_id:1})).status,200);
 const printed=await call(f,'GET','fee-receipts/'+doc.id+'?school_id=1');assert.equal(printed.body.data.academic_year_snapshot,doc.academic_year_snapshot);
 assert.equal(printed.body.data.payments_snapshot_json,doc.payments_snapshot_json);
 assert.match(readFileSync(join(root,'src/modules/print/PrintReceiptPage.tsx'),'utf8'),/academic_year_snapshot/);
});
test('legacy null-year payment snapshot never invents active academic year',async t=>{
 const f=legacy(t,"UPDATE student_fees SET academic_year_id=NULL WHERE id=1;");
 const r=await call(f,'POST','fee-receipts/generate',receiptInput([1]));assert.equal(r.status,200);
 assert.equal(r.body.data.receipt.academic_year_snapshot,null);assert.equal(JSON.parse(r.body.data.receipt.payments_snapshot_json)[0].academic_year_id,null);
});
test('fee-year scope revalidated inside receipt transaction against invalid relationship',async t=>{
 const f=legacy(t,"UPDATE student_fees SET academic_year_id=3 WHERE id=1;");
 const before=snapshot(f.db),r=await call(f,'POST','fee-receipts/generate',receiptInput([1]));
 assert.equal(r.body.code,'receipt_academic_year_conflict');assert.deepEqual(snapshot(f.db),before);
});
test('legacy display text remains untouched by metadata edit while canonical rename is allowed',async t=>{
 const f=legacy(t),old=f.db.prepare('SELECT fee_type,fee_type_key FROM student_fees WHERE id=1').get();
 f.db.exec("UPDATE student_fees SET notes='local only' WHERE id=1");
 assert.deepEqual(f.db.prepare('SELECT fee_type,fee_type_key FROM student_fees WHERE id=1').get(),old);
 const r=await call(f,'PUT','student-fees/1',{school_id:1,fee_type:' New\t Canonical  Name '});assert.equal(r.status,200);
 assert.equal(r.body.data.fee_type_key,'New Canonical Name');
});
for(const key of ['', 'a'.repeat(121),' double  space','New\tName','New\u00a0Name'])test('raw SQL rejects noncanonical renamed fee key '+JSON.stringify(key),t=>{
 const f=legacy(t),before=snapshot(f.db);assert.throws(()=>f.db.prepare('UPDATE student_fees SET fee_type=?,fee_type_key=? WHERE id=1').run(key,key),/invalid_finance_request/);assert.deepEqual(snapshot(f.db),before);
});
