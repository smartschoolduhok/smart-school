import assert from 'node:assert/strict';
import test from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {preflightFinance} from '../scripts/preflight-finance.mjs';
import {calculateFee,feeRemaining,feeStatus,parseFee,parsePayment,parseReceipt,financeTimestamp,canonicalFeeType} from '../src/lib/financeFees.ts';
import {feeDraft,paymentDraft,financeFixture,migrationSQL,snapshot} from './helpers/finance-fixture.mjs';
import {legacyFinanceSQL} from './helpers/finance-fixture.mjs';
const invalid=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('IQD deterministic half-up rounding, boundaries and maximum safe amount',()=>{
 assert.equal(calculateFee(1,'percentage',50).discount_amount,1);
 assert.equal(calculateFee(3,'percentage',50).discount_amount,2);
 assert.equal(calculateFee(10001,'percentage',0.01).discount_amount,1);
 assert.equal(calculateFee(Number.MAX_SAFE_INTEGER,'percentage',100).net_fee,0);
 assert.equal(calculateFee(100,'fixed',100).net_fee,0);
 assert.equal(calculateFee(100,'none',0).net_fee,100);
});
for(const value of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'100',null])test('money rejects '+String(value),()=>invalid(()=>parseFee(feeDraft({amount:value})),'invalid_finance_amount'));
for(const [type,value] of [['fixed',101],['fixed',0.5],['percentage',100.01],['percentage',0.001],['none',1],['other',0],['percentage',-1]])test('discount rejects '+type+'/'+value,()=>invalid(()=>calculateFee(100,type,value),'invalid_discount'));
test('zero net stays zero and status paid; nullish legacy net uses amount',()=>{assert.equal(feeRemaining({net_fee:0,amount:100,paid_amount:0}),0);assert.equal(feeRemaining({net_fee:null,amount:100,paid_amount:20}),80);assert.equal(feeStatus(0,0),'paid');assert.equal(feeStatus(100,20),'partial');});
test('strict fields, dates, immutable identities and conservative canonicalization',()=>{
 assert.equal(canonicalFeeType('  رسوم\t\n دراسية  '),'رسوم دراسية');
 for(const body of [null,[],{...feeDraft(),secret:1}])invalid(()=>parseFee(body),'invalid_finance_request');
 for(const timestamp of ['2026-02-30',-1,0.5,253402300800])invalid(()=>financeTimestamp(timestamp),'invalid_finance_request');
 assert.equal(financeTimestamp(0),0);assert.equal(financeTimestamp(null),null);
 for(const field of ['student_id','academic_year_id'])invalid(()=>parseFee({[field]:2},feeDraft()),'invalid_finance_request');
});
test('payment parser keeps supported existing methods, normalizes notes, requires bounded key',()=>{
 for(const method of ['cash','bank_transfer','cheque','credit_card','debit_card','mobile_payment','other'])assert.equal(parsePayment(paymentDraft(1,{payment_method:method})).payment_method,method);
 invalid(()=>parsePayment(paymentDraft(1,{client_request_id:'tiny'})),'invalid_finance_request');
 invalid(()=>parsePayment(paymentDraft(1,{payment_method:'invented'})),'invalid_finance_request');
 assert.equal(parsePayment(paymentDraft(1,{notes:' note '})).notes,'note');
});
test('receipt set rejects duplicates, empty, over-limit and unsafe IDs, canonical order',()=>{
 for(const ids of [[],[1,1],Array.from({length:101},(_,i)=>i+1)])invalid(()=>parseReceipt({student_id:1,payment_ids:ids}),'receipt_payment_invalid');
 assert.deepEqual(parseReceipt({student_id:1,payment_ids:[3,1]}).payment_ids,[1,3]);
 invalid(()=>parseReceipt({student_id:1,payment_ids:['1']}),'invalid_finance_request');
});
test('populated 0027 -> 0028 preserves every old column/row, legacy payments active, currencies unchanged',t=>{
 const f=financeFixture(t,{through:'0027',legacy:legacyFinanceSQL}),before=snapshot(f.db);
 assert.equal(preflightFinance(f.db).safe,true);assert.deepEqual(preflightFinance(f.db).legacy_non_iqd_fee_ids,[2]);
 f.db.exec('BEGIN');f.db.exec(migrationSQL('0028_finance_fee_payment_integrity.sql'));f.db.exec('COMMIT');
 const after=snapshot(f.db);
 for(const [name,rows]of Object.entries(before)){
  assert.equal(after[name].length,rows.length,name);
  const keys=rows.length?Object.keys(rows[0]):[];
  const project=row=>Object.fromEntries(keys.map(k=>[k,row[k]]));
  assert.deepEqual(after[name].map(project).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),rows.map(project).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),name);
 }
 assert.equal(f.db.prepare('SELECT status FROM fee_payments').get().status,'active');
 assert.equal(f.db.prepare('SELECT currency FROM student_fees WHERE id=2').get().currency,'USD');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fee_receipt_payments').get().n,2);
 assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('Wrangler real SQL splitter accepts LF trigger bodies and nested CASE expressions',t=>{
 const f=financeFixture(t,{through:'0027'}),sql=migrationSQL('0028_finance_fee_payment_integrity.sql');
 assert.equal(sql.includes('\r\n'),false);
 for(const query of unstable_splitSqlQuery(sql))f.db.exec(query);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('database discount guard agrees with half-up domain arithmetic including maximum-safe IQD',t=>{
 const f=financeFixture(t);
 for(const [i,[amount,value]]of [[1,50],[3,50],[10001,0.29],[Number.MAX_SAFE_INTEGER,33.33],[Number.MAX_SAFE_INTEGER,100]].entries()){
  const d=calculateFee(amount,'percentage',value),type='Integer guard '+i;
  const result=f.db.prepare(`INSERT INTO student_fees(school_id,student_id,academic_year_id,fee_type,fee_type_key,amount,currency,discount_type,discount_value,discount_amount,net_fee,status)
   VALUES(1,1,1,?,?,?,'IQD','percentage',?,?,?,?)`).run(type,type,amount,value,d.discount_amount,d.net_fee,feeStatus(d.net_fee,0));
  assert.equal(f.db.prepare('SELECT net_fee FROM student_fees WHERE id=?').get(result.lastInsertRowid).net_fee,d.net_fee);
  assert.throws(()=>f.db.prepare('UPDATE student_fees SET discount_amount=discount_amount+1,net_fee=net_fee-1 WHERE id=?').run(result.lastInsertRowid),/invalid_discount/);
 }
});
test('legacy fee canonical key matches JS Unicode whitespace normalization without changing display text',t=>{
 const f=financeFixture(t,{through:'0027'}),type='  A\t\ufeff B\u00a0';
 f.db.prepare("INSERT INTO student_fees(school_id,student_id,fee_type,amount,currency) VALUES(1,1,?,100,'IQD')").run(type);
 f.db.exec(migrationSQL('0028_finance_fee_payment_integrity.sql'));
 const row=f.db.prepare('SELECT fee_type,fee_type_key FROM student_fees').get();assert.equal(row.fee_type,type);assert.equal(row.fee_type_key,canonicalFeeType(type));
});
for(const kind of ['duplicate fee','duplicate receipt number','duplicate token','duplicate active reservation','missing payment'])test('migration stops safely for '+kind,t=>{
 const f=financeFixture(t,{through:'0027',legacy:legacyFinanceSQL});
 if(kind==='duplicate fee')f.db.exec("INSERT INTO student_fees(school_id,student_id,academic_year_id,fee_type,amount,currency) VALUES(1,1,1,'رسوم قديمة',100,'IQD')");
 if(kind==='duplicate receipt number')f.db.exec("UPDATE fee_receipts SET receipt_number='same'");
 if(kind==='duplicate token')f.db.exec("UPDATE fee_receipts SET verification_token='same'");
 if(kind==='duplicate active reservation')f.db.exec("UPDATE fee_receipts SET status='active'");
 if(kind==='missing payment')f.db.exec("UPDATE fee_receipts SET payment_ids_json='[1,999]' WHERE id=1");
 const before=snapshot(f.db);f.db.exec('BEGIN');assert.throws(()=>f.db.exec(migrationSQL('0028_finance_fee_payment_integrity.sql')));f.db.exec('ROLLBACK');assert.deepEqual(snapshot(f.db),before);
});
