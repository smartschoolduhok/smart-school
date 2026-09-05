import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {root,financeFixture,feeDraft,paymentDraft,snapshot} from './helpers/finance-fixture.mjs';
import {legacyFinanceSQL,migrationSQL} from './helpers/finance-fixture.mjs';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');after(()=>vite.close());
const secret='generated-local-finance-only-secret-no-remote-usage';
const tokens=Object.fromEntries(await Promise.all(['owner','admin','teacher','accountant','principal','vice','registrar','parent'].map(async role=>[role,await signJWT({email:role+'@matrix.test',auth_version:1},secret)])));

test('legacy non-IQD fees preserved but payments/edits blocked after migration',async t=>{
 const f=financeFixture(t,{through:'0027',legacy:legacyFinanceSQL});f.db.exec(migrationSQL('0028_finance_fee_payment_integrity.sql'));
 const before=snapshot(f.db),p=await call(f,'POST','fee-payments',paymentDraft(2,{amount:10}));assert.equal(p.body.code,'unsupported_finance_currency');
 const edit=await call(f,'PUT','student-fees/2',{school_id:1,currency:'IQD'});assert.equal(edit.body.code,'unsupported_finance_currency');assert.deepEqual(snapshot(f.db),before);
});
test('cancelled payment excluded from receipts; overlapping different receipts blocked',async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id,{amount:1000}),p2=await pay(f,id,{amount:1000});
 await receipt(f,[p]);await receipt(f,[p2]);const overlap=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[p,p2]});assert.equal(overlap.body.code,'receipt_payment_already_receipted');
 const p3=await pay(f,id,{amount:1000});await call(f,'PUT','fee-payments/'+p3+'/cancel',{school_id:1,cancel_reason:'x'});const before=snapshot(f.db);
 const r=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[p3]});assert.equal(r.body.code,'receipt_payment_invalid');assert.deepEqual(snapshot(f.db),before);
});
test('mixed-currency treasury cannot be recomputed as IQD and aggregate safe integer overflow rolls back',async t=>{
 const f=financeFixture(t),id=await createFee(f);f.db.exec("INSERT INTO treasury_transactions(school_id,transaction_type,category,amount,currency,status,created_by) VALUES(1,'income','other_income',1,'USD','active',1)");
 let before=snapshot(f.db),r=await call(f,'POST','fee-payments',paymentDraft(id));assert.equal(r.body.code,'unsupported_finance_currency');assert.deepEqual(snapshot(f.db),before);
 // Build a consistent large LOCAL opening balance; historical cache drift is
 // now a separate reconciliation blocker, not a valid overflow fixture.
 f.db.exec("UPDATE treasury_transactions SET currency='IQD',amount=9007199254740991; INSERT INTO treasury_accounts(school_id,current_balance) VALUES(1,9007199254740991)");before=snapshot(f.db);r=await call(f,'POST','fee-payments',paymentDraft(id));assert.equal(r.body.code,'invalid_finance_amount');assert.deepEqual(snapshot(f.db),before);
});
test('receipt insertion and printing injected middle failures leave no reservations or printed timestamp',async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id);f.d1.failAt=1;let before=snapshot(f.db);
 const r=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[p]});assert.equal(r.status,500);assert.deepEqual(snapshot(f.db),before);
 f.d1.failAt=null;const doc=await receipt(f,[p]);f.d1.failAt=1;before=snapshot(f.db);
 assert.equal((await call(f,'PUT','fee-receipts/'+doc.id+'/mark-printed',{school_id:1})).status,500);assert.deepEqual(snapshot(f.db),before);
});
test('true stale fee update does not overwrite concurrent payment summary',async t=>{
 const f=financeFixture(t),id=await createFee(f),prepare=f.d1.prepare.bind(f.d1);let changed=false;
 f.d1.prepare=sql=>{const stmt=prepare(sql);if(sql.startsWith('UPDATE student_fees SET fee_type=')){const bind=stmt.bind.bind(stmt);stmt.bind=(...args)=>{const result=bind(...args),first=result.first.bind(result);result.first=async()=>{
  if(!changed){changed=true;await pay(f,id,{amount:1000});}return first();
 };return result;};}return stmt;};
 const r=await call(f,'PUT','student-fees/'+id,{school_id:1,amount:120000});assert.equal(r.status,409);assert.equal(r.body.code,'finance_operation_stale');ledger(f,id,1000);assert.equal(one(f,'SELECT amount FROM student_fees').amount,100000);
});

async function call(f,method,path,input,role='owner') {
 const response=await app.request('http://localhost/api/'+path,{method,headers:{'Content-Type':'application/json',...(role?{Authorization:'Bearer '+tokens[role]}:{})},body:input===undefined?undefined:JSON.stringify(input)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
 return {status:response.status,body:await response.json()};
}
async function createFee(f,patch={}) {const r=await call(f,'POST','student-fees',feeDraft(patch));assert.equal(r.status,201,JSON.stringify(r));return r.body.data.id;}
async function pay(f,id,patch={}) {const r=await call(f,'POST','fee-payments',paymentDraft(id,patch));assert.ok([200,201].includes(r.status),JSON.stringify(r));return r.body.data.id;}
async function receipt(f,ids,student=1){const r=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:student,payment_ids:ids});assert.equal(r.status,200,JSON.stringify(r));return r.body.data.receipt;}
const one=(f,sql,...args)=>f.db.prepare(sql).get(...args);
function ledger(f,id,paid){const fee=one(f,'SELECT * FROM student_fees WHERE id=?',id);assert.equal(fee.paid_amount,paid);assert.equal(one(f,"SELECT coalesce(SUM(amount),0) n FROM fee_payments WHERE student_fee_id=? AND status='active'",id).n,paid);assert.equal(one(f,"SELECT current_balance FROM treasury_accounts WHERE school_id=1").current_balance,one(f,"SELECT coalesce(SUM(CASE WHEN transaction_type='income' THEN amount ELSE -amount END),0) n FROM treasury_transactions WHERE school_id=1 AND status='active'").n);}
test('reproduce A finance reads reject teacher',async t=>{const f=financeFixture(t);await createFee(f);assert.equal((await call(f,'GET','student-fees?school_id=1',undefined,'teacher')).status,403);});
test('reproduce B full discount zero net never becomes payable',async t=>{const f=financeFixture(t),id=await createFee(f,{discount_type:'percentage',discount_value:100});const before=snapshot(f.db),r=await call(f,'POST','fee-payments',paymentDraft(id,{amount:1}));assert.equal(r.status,400);assert.deepEqual(snapshot(f.db),before);});
test('reproduce C concurrent different-key 60k payments against 100k commit once',async t=>{const f=financeFixture(t),id=await createFee(f);
 // Hold both reviewed-base SELECT snapshots before allowing either writer.
 // New atomic implementation does not use this unscoped, stale pre-read.
 const prepare=f.d1.prepare.bind(f.d1);let arrivals=0,release;const barrier=new Promise(r=>release=r);
 f.d1.prepare=sql=>{const statement=prepare(sql);if(sql.trim()==='SELECT * FROM student_fees WHERE id = ?'){
  const bind=statement.bind.bind(statement);statement.bind=(...args)=>{const bound=bind(...args),first=bound.first.bind(bound);bound.first=async()=>{const row=await first();if(++arrivals===2)release();await barrier;return row;};return bound;};
 }return statement;};
 const results=await Promise.all([call(f,'POST','fee-payments',paymentDraft(id)),call(f,'POST','fee-payments',paymentDraft(id))]);assert.equal(results.filter(r=>r.status<300).length,1);assert.equal(f.db.prepare('SELECT SUM(amount) n FROM fee_payments').get().n,60000);assert.equal(f.db.prepare('SELECT paid_amount FROM student_fees WHERE id=?').get(id).paid_amount,60000);});
test('reproduce D cache-stage failure rolls back every business row',async t=>{const f=financeFixture(t),id=await createFee(f);f.db.exec("CREATE TRIGGER local_fail_cache BEFORE INSERT ON treasury_accounts BEGIN SELECT RAISE(ABORT,'injected cache failure'); END;");const before=snapshot(f.db),r=await call(f,'POST','fee-payments',paymentDraft(id));assert.equal(r.status,500);assert.deepEqual(snapshot(f.db),before);});
test('reproduce E fee cannot be reduced below ledger-paid amount',async t=>{const f=financeFixture(t),id=await createFee(f);await pay(f,id);const before=snapshot(f.db),r=await call(f,'PUT','student-fees/'+id,{school_id:1,amount:50000});assert.equal(r.status,400);assert.deepEqual(snapshot(f.db),before);});
test('reproduce F non-IQD create rejected, never relabel money',async t=>{const f=financeFixture(t),before=snapshot(f.db);assert.equal((await call(f,'POST','student-fees',feeDraft({currency:'USD'}))).status,400);assert.deepEqual(snapshot(f.db),before);});
test('reproduce G incomplete receipt selection rejects all requested IDs',async t=>{const f=financeFixture(t),id=await createFee(f),p=await pay(f,id),before=snapshot(f.db);const r=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[p,9999]});assert.equal(r.status,400);assert.deepEqual(snapshot(f.db),before);});
test('reproduce G duplicate receipt creation returns same document',async t=>{const f=financeFixture(t),id=await createFee(f),p=await pay(f,id),body={school_id:1,student_id:1,payment_ids:[p]};const a=await call(f,'POST','fee-receipts/generate',body),b=await call(f,'POST','fee-receipts/generate',body);assert.equal(a.body.data.receipt.id,b.body.data.receipt.id);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fee_receipts').get().n,1);});
test('reproduce H receipt individual read and print reject unauthorized roles',async t=>{const f=financeFixture(t),id=await createFee(f),p=await pay(f,id);const r=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[p]}),receipt=r.body.data.receipt.id;for(const role of ['teacher','registrar','parent']){assert.equal((await call(f,'GET',`fee-receipts/${receipt}?school_id=1`,undefined,role)).status,403);assert.equal((await call(f,'PUT',`fee-receipts/${receipt}/mark-printed`,{school_id:1},role)).status,403);}});
test('reproduce H registrar cannot directly mark private receipt printed',async t=>{const f=financeFixture(t),id=await createFee(f),p=await pay(f,id);const r=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[p]});assert.equal((await call(f,'PUT',`fee-receipts/${r.body.data.receipt.id}/mark-printed`,{school_id:1},'registrar')).status,403);});

const routes=[
 ['GET','student-fees'],['POST','student-fees'],['PUT','student-fees/1'],['DELETE','student-fees/2'],
 ['GET','fee-payments'],['POST','fee-payments'],['PUT','fee-payments/2/cancel'],
 ['GET','fee-receipts'],['GET','fee-receipts/1'],['POST','fee-receipts/generate'],['PUT','fee-receipts/1/cancel'],['PUT','fee-receipts/1/mark-printed'],
];
for(const role of ['admin','owner','principal','vice','accountant','teacher','registrar','parent',null])test('all 12 private routes role matrix: '+role,async t=>{
 const f=financeFixture(t),fee=await createFee(f);await createFee(f,{student_id:2});const p=await pay(f,fee,{amount:10000});await pay(f,fee,{amount:10000});await receipt(f,[p]);
 for(const [method,path] of routes){
  let input=method==='GET'?undefined:{school_id:1};
  if(method==='POST'&&path==='student-fees')input=feeDraft({fee_type:'Matrix second'});
  if(method==='PUT'&&path==='student-fees/1')input={school_id:1,notes:'Matrix edit'};
  if(method==='POST'&&path==='fee-payments')input=paymentDraft(fee,{amount:1000});
  if(path.endsWith('cancel'))input={school_id:1,cancel_reason:'Generated correction'};
  if(path==='fee-receipts/generate')input={school_id:1,student_id:1,payment_ids:[p]};
  // Print before cancel would otherwise be a legitimate domain rejection.
  const r=await call(f,method,path+(method==='GET'?'?school_id=1':''),input,role);
  if(role===null)assert.equal(r.status,401,path);
  else if(['teacher','registrar','parent'].includes(role)){assert.equal(r.status,403,path);assert.equal(r.body.code,'finance_forbidden');}
  else if(path.endsWith('mark-printed')){assert.equal(r.status,409,path);assert.equal(r.body.code,'receipt_already_cancelled');}
  else assert.ok(r.status>=200&&r.status<300,role+' '+path+' '+JSON.stringify(r));
 }
});
for(const mode of ['admin missing','foreign tenant','inactive admin school'])test('every route enforces school target: '+mode,async t=>{
 const f=financeFixture(t);if(mode==='inactive admin school')f.db.exec("UPDATE schools SET status='archived' WHERE id=2");
 for(const [method,path]of routes){
  const target=mode==='admin missing'?undefined:2,role=mode==='foreign tenant'?'owner':'admin';
  let input=method==='GET'?undefined:{school_id:target};
  if(method==='POST'&&path==='student-fees')input=feeDraft({school_id:target});
  if(method==='POST'&&path==='fee-payments')input=paymentDraft(1,{school_id:target});
  if(path.endsWith('cancel'))input={school_id:target,cancel_reason:'reason'};
  if(path==='fee-receipts/generate')input={school_id:target,student_id:1,payment_ids:[1]};
  const r=await call(f,method,path+(method==='GET'&&target?'?school_id='+target:''),input,role);
  assert.equal(r.status,mode==='foreign tenant'?403:400,path+' '+JSON.stringify(r));
 }
});
for(const patch of [{amount:0},{amount:-1},{amount:1.5},{amount:'NaN'},{currency:'EGP'},{currency:'USD'},{academic_year_id:3},{student_id:3},{student_id:4},{fee_type:' '},{discount_value:1},{due_date:'bad'},{school_id:1,extra:1}])test('fee create strict rejection '+JSON.stringify(patch),async t=>{
 const f=financeFixture(t),before=snapshot(f.db),r=await call(f,'POST','student-fees',feeDraft(patch));assert.ok(r.status>=400&&r.status<500,JSON.stringify(r));assert.ok(r.body.code);assert.deepEqual(snapshot(f.db),before);assert.ok(!JSON.stringify(r).includes('Foreign Student'));
});
test('concurrent fee duplicate and null-year canonical whitespace duplicate are DB-protected',async t=>{
 const f=financeFixture(t),data=feeDraft({academic_year_id:null,fee_type:'  Term \t Fee  '});
 const rr=await Promise.all([call(f,'POST','student-fees',data),call(f,'POST','student-fees',data)]);
 assert.equal(rr.filter(r=>r.status===201).length,1);assert.equal(rr.find(r=>r.status!==201).body.code,'duplicate_student_fee');
 assert.equal(one(f,'SELECT fee_type FROM student_fees').fee_type,'Term Fee');
 const r=await call(f,'POST','student-fees',feeDraft({academic_year_id:null,fee_type:'Term Fee'}));assert.equal(r.status,409);
});
test('paid ledger, safe edits, metadata no-op, identities and duplicate conflict',async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id),count=one(f,'SELECT COUNT(*) n FROM fee_payments').n;
 let r=await call(f,'PUT','student-fees/'+id,{school_id:1,amount:120000});assert.equal(r.status,200);ledger(f,id,60000);
 r=await call(f,'PUT','student-fees/'+id,{school_id:1,discount_type:'fixed',discount_value:60000});assert.equal(r.status,200);assert.equal(r.body.data.status,'paid');
 for(const patch of [{amount:50000},{discount_type:'percentage',discount_value:100},{currency:'USD'},{student_id:2},{academic_year_id:2}]){
  const before=snapshot(f.db),bad=await call(f,'PUT','student-fees/'+id,{school_id:1,...patch});assert.equal(bad.status,400);assert.deepEqual(snapshot(f.db),before);
 }
 const before=snapshot(f.db);r=await call(f,'PUT','student-fees/'+id,{school_id:1});assert.equal(r.status,200);assert.deepEqual(snapshot(f.db),before);
 await createFee(f,{fee_type:'Other'});r=await call(f,'PUT','student-fees/'+id,{school_id:1,fee_type:'Other'});assert.equal(r.body.code,'duplicate_student_fee');
 assert.equal(one(f,'SELECT COUNT(*) n FROM fee_payments').n,count);assert.equal(one(f,'SELECT id FROM fee_payments').id,p);
});
test('partial then exact final, overpay rejected, treasury matches each payment',async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id);ledger(f,id,60000);
 await pay(f,id,{amount:40000});ledger(f,id,100000);assert.equal(one(f,'SELECT status FROM student_fees').status,'paid');
 const r=await call(f,'POST','fee-payments',paymentDraft(id,{amount:1}));assert.equal(r.body.code,'payment_overpay');
 const transaction=one(f,"SELECT * FROM treasury_transactions WHERE source_type='fee_payment' AND source_id=?",p);assert.equal(transaction.currency,'IQD');assert.equal(transaction.category,'tuition_fee');assert.equal(transaction.amount,60000);assert.equal(transaction.school_id,1);
});
test('same-key retry/concurrent same key has exactly one financial effect; changed payload 409',async t=>{
 const f=financeFixture(t),id=await createFee(f),input=paymentDraft(id);
 const rr=await Promise.all([call(f,'POST','fee-payments',input),call(f,'POST','fee-payments',input)]);assert.deepEqual(rr.map(r=>r.status).sort(),[200,201]);assert.equal(rr[0].body.data.id,rr[1].body.data.id);ledger(f,id,60000);
 const before=snapshot(f.db),retry=await call(f,'POST','fee-payments',input);assert.equal(retry.body.data.already_applied,true);assert.deepEqual(snapshot(f.db),before);
 const altered=await call(f,'POST','fee-payments',{...input,amount:20000});assert.equal(altered.status,409);assert.equal(altered.body.code,'payment_idempotency_conflict');assert.deepEqual(snapshot(f.db),before);
});
for(const stage of ['first','final','fee summary','treasury','balance'])test('payment '+stage+' failure rolls back every application table',async t=>{
 const f=financeFixture(t),id=await createFee(f);
 if(stage==='first')f.d1.failAt=0;if(stage==='final')f.d1.failAt=1;
 const target={'fee summary':['UPDATE','student_fees'],treasury:['INSERT','treasury_transactions'],balance:['INSERT','treasury_accounts']}[stage];
 if(target)f.db.exec("CREATE TRIGGER local_failure BEFORE "+target[0]+" ON "+target[1]+" BEGIN SELECT RAISE(ABORT,'local injected failure'); END;");
 const before=snapshot(f.db),r=await call(f,'POST','fee-payments',paymentDraft(id));assert.equal(r.status,500);assert.equal(r.body.code,'finance_failure');assert.deepEqual(snapshot(f.db),before);
});
test('payment cancel with reason reverses once, blocks active receipt; document cancel preserves money and snapshot',async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id),r=await receipt(f,[p]),financial=one(f,'SELECT * FROM treasury_accounts');
 let response=await call(f,'PUT','fee-payments/'+p+'/cancel',{school_id:1,cancel_reason:'correction'});assert.equal(response.body.code,'payment_receipt_active');
 response=await call(f,'PUT','fee-receipts/'+r.id+'/cancel',{school_id:1});assert.equal(response.status,400);
 response=await call(f,'PUT','fee-receipts/'+r.id+'/cancel',{school_id:1,cancel_reason:'Document correction'});assert.equal(response.status,200);assert.deepEqual(one(f,'SELECT * FROM treasury_accounts'),financial);ledger(f,id,60000);
 const old=one(f,'SELECT * FROM fee_receipts WHERE id=?',r.id);for(const key of ['payments_snapshot_json','total_amount','verification_token','receipt_number'])assert.equal(old[key],r[key]);
 assert.equal((await call(f,'GET','verify/receipt/'+r.verification_token,undefined,null)).body.cancelled,true);
 response=await call(f,'PUT','fee-payments/'+p+'/cancel',{school_id:1,cancel_reason:'Money correction'});assert.equal(response.status,200);ledger(f,id,0);assert.equal(one(f,'SELECT status FROM treasury_transactions').status,'cancelled');assert.equal(one(f,'SELECT status FROM student_fees').status,'pending');
 const before=snapshot(f.db);response=await call(f,'PUT','fee-payments/'+p+'/cancel',{school_id:1,cancel_reason:'Retry'});assert.equal(response.body.code,'payment_already_cancelled');assert.deepEqual(snapshot(f.db),before);
 assert.throws(()=>f.db.exec('DELETE FROM fee_payments'),/finance_operation_stale/);
});
for(const corruption of ['missing','amount','wrong school','cache missing'])test('cancel blocks corrupt treasury '+corruption,async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id);
 if(corruption==='missing')f.db.exec('DELETE FROM treasury_transactions');
 if(corruption==='amount')f.db.exec('UPDATE treasury_transactions SET amount=1');
 if(corruption==='wrong school')f.db.exec('UPDATE treasury_transactions SET school_id=2');
 if(corruption==='cache missing')f.db.exec('DELETE FROM treasury_accounts');
 const before=snapshot(f.db),r=await call(f,'PUT','fee-payments/'+p+'/cancel',{school_id:1,cancel_reason:'x'});assert.equal(r.body.code,'payment_treasury_integrity_error');assert.deepEqual(snapshot(f.db),before);
});
for(const operation of ['cancel payment','cancel receipt','print'])test(operation+' final read failure rolls back all changes',async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id);let path='fee-payments/'+p+'/cancel',input={school_id:1,cancel_reason:'x'};
 if(operation!=='cancel payment'){const r=await receipt(f,[p]);path='fee-receipts/'+r.id+(operation==='print'?'/mark-printed':'/cancel');}
 if(operation==='print')input={school_id:1,copies:2};
 f.d1.failAt=operation==='print'?2:1;const before=snapshot(f.db),r=await call(f,'PUT',path,input);assert.equal(r.status,500);assert.deepEqual(snapshot(f.db),before);
});
test('receipt snapshots and set completeness, cancelled/foreign/other-student payments',async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id,{amount:10000}),p2=await pay(f,id,{amount:20000}),id2=await createFee(f,{student_id:2}),other=await pay(f,id2);
 for(const ids of [[p,p],[p,9999],[p,other]]){const before=snapshot(f.db),r=await call(f,'POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:ids});assert.equal(r.status,400);assert.deepEqual(snapshot(f.db),before);}
 const r=await receipt(f,[p,p2]);assert.equal(r.total_amount,30000);assert.deepEqual(JSON.parse(r.payment_ids_json),[p,p2]);assert.equal(JSON.parse(r.payments_snapshot_json)[0].currency,'IQD');
 assert.equal((await call(f,'GET','verify/receipt/'+r.verification_token,undefined,null)).body.valid,true);
 assert.throws(()=>f.db.prepare('UPDATE fee_receipts SET total_amount=1 WHERE id=?').run(r.id),/finance_operation_stale/);
 const printed=await call(f,'PUT','fee-receipts/'+r.id+'/mark-printed',{school_id:1,copies:2});assert.equal(printed.status,200);assert.ok(printed.body.data.printed_at>0);assert.equal(one(f,'SELECT copies_count FROM print_records').copies_count,2);
 await call(f,'PUT','fee-receipts/'+r.id+'/cancel',{school_id:1,cancel_reason:'replacement'});
 const replacement=await receipt(f,[p,p2]);assert.notEqual(replacement.id,r.id);assert.notEqual(replacement.receipt_number,r.receipt_number);assert.notEqual(replacement.verification_token,r.verification_token);
 assert.equal((await call(f,'PUT','fee-receipts/'+r.id+'/mark-printed',{school_id:1})).body.code,'receipt_already_cancelled');
});
test('receipt concurrency, subset and overlapping document conflicts; same set is idempotent',async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id,{amount:10000}),p2=await pay(f,id,{amount:20000}),input={school_id:1,student_id:1,payment_ids:[p,p2]};
 const rr=await Promise.all([call(f,'POST','fee-receipts/generate',input),call(f,'POST','fee-receipts/generate',input)]);assert.ok(rr.every(r=>r.status===200),JSON.stringify(rr));assert.equal(rr[0].body.data.receipt.id,rr[1].body.data.receipt.id);
 const r=await call(f,'POST','fee-receipts/generate',{...input,payment_ids:[p]});assert.equal(r.body.code,'receipt_payment_already_receipted');assert.equal(one(f,'SELECT COUNT(*) n FROM fee_receipts').n,1);
});
test('opt-in auto receipt and manual call use same reservation/document',async t=>{
 const f=financeFixture(t),id=await createFee(f),input=paymentDraft(id,{auto_generate_receipt:true}),a=await call(f,'POST','fee-payments',input);assert.equal(a.status,201);
 const r=await receipt(f,[a.body.data.id]);assert.equal(r.id,a.body.data.auto_receipt.id);
 const retry=await call(f,'POST','fee-payments',input);assert.equal(retry.body.data.auto_receipt.id,r.id);assert.equal(one(f,'SELECT COUNT(*) n FROM fee_receipts').n,1);
});
test('foreign/missing private objects return equivalent sanitized results; reference IDs never leak names',async t=>{
 const f=financeFixture(t),foreign=await call(f,'POST','student-fees',feeDraft({school_id:2,student_id:3,academic_year_id:3}),'admin');assert.equal(foreign.status,201);
 const p=await call(f,'POST','fee-payments',paymentDraft(foreign.body.data.id,{school_id:2}),'admin');assert.equal(p.status,201);
 const r=await call(f,'POST','fee-receipts/generate',{school_id:2,student_id:3,payment_ids:[p.body.data.id]},'admin');assert.equal(r.status,200);
 for(const [method,pattern,objectId,input]of [['PUT','student-fees/ID',foreign.body.data.id,{school_id:1,notes:'x'}],['POST','fee-payments',foreign.body.data.id,null],['PUT','fee-payments/ID/cancel',p.body.data.id,{school_id:1,cancel_reason:'x'}],['GET','fee-receipts/ID?school_id=1',r.body.data.receipt.id,undefined],['PUT','fee-receipts/ID/cancel',r.body.data.receipt.id,{school_id:1,cancel_reason:'x'}]]){
  const results=[];for(const id of [objectId,9999])results.push(await call(f,method,pattern.replace('ID',id),input===null?paymentDraft(id):input));
  assert.equal(results[0].status,results[1].status);assert.equal(results[0].body.code,results[1].body.code);assert.ok(!JSON.stringify(results).includes('Foreign'));
 }
 for(const resource of ['student-fees','fee-payments','fee-receipts'])assert.equal((await call(f,'GET',resource+'?school_id=1')).body.data.length,0);
});
test('shared print history cannot leak finance record IDs to registrar/teacher',async t=>{
 const f=financeFixture(t),id=await createFee(f),p=await pay(f,id),r=await receipt(f,[p]);await call(f,'PUT','fee-receipts/'+r.id+'/mark-printed',{school_id:1});
 for(const role of ['registrar','teacher'])assert.equal((await call(f,'GET','print-records?school_id=1',undefined,role)).body.data.length,0);
});

test('fee posting and cancellation sum whole-IQD ledger exactly despite large intermediate balances',async t=>{
 const f=financeFixture(t),id=await createFee(f);
 f.db.exec(`INSERT INTO treasury_transactions(school_id,transaction_type,category,amount,currency,status,created_by) VALUES
  (1,'income','other',9007199254740991,'IQD','active',1),(1,'income','other',2,'IQD','active',1),
  (1,'expense','other',9007199254740991,'IQD','active',1);
  INSERT INTO treasury_accounts(school_id,current_balance) VALUES(1,2)`);
 const p=await pay(f,id,{amount:1});
 assert.equal(one(f,'SELECT current_balance FROM treasury_accounts WHERE school_id=1').current_balance,3);
 assert.equal((await call(f,'PUT','fee-payments/'+p+'/cancel',{school_id:1,cancel_reason:'Local correction'})).status,200);
 assert.equal(one(f,'SELECT current_balance FROM treasury_accounts WHERE school_id=1').current_balance,2);
});
