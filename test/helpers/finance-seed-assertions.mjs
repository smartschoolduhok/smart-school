import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parsePayment} from '../../src/lib/financeFees.ts';
// Shared by direct-SQL and real workerd validation; reads only after local seed.
export async function assertFinanceSeed(db){
 assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys,1);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 const fees=(await db.prepare(`SELECT f.*,coalesce((SELECT SUM(CAST(p.amount AS INTEGER)) FROM fee_payments p WHERE p.student_fee_id=f.id AND p.status='active'),0) ledger FROM student_fees f WHERE f.currency='IQD'`).all()).results;
 assert.equal(fees.length,8);
 for(const f of fees){assert.equal(f.paid_amount,f.ledger);assert.equal(f.status,f.ledger>=f.net_fee?'paid':f.ledger>0?'partial':'pending');assert.equal(f.net_fee,f.amount-f.discount_amount);assert.equal(f.fee_type_key,f.fee_type);}
 const accounts=(await db.prepare(`SELECT a.*,coalesce((SELECT SUM( CASE WHEN t.transaction_type='income' THEN CAST(t.amount AS INTEGER) ELSE -CAST(t.amount AS INTEGER) END) FROM treasury_transactions t WHERE t.school_id=a.school_id AND t.status='active' AND t.currency='IQD'),0) ledger FROM treasury_accounts a`).all()).results;
 assert.ok(accounts.length>0);for(const a of accounts)assert.equal(a.current_balance,a.ledger);
 const payments=(await db.prepare(`SELECT p.*,(SELECT COUNT(*) FROM treasury_transactions t WHERE t.source_type='fee_payment' AND t.source_id=p.id AND t.school_id=p.school_id AND t.currency='IQD' AND t.amount=p.amount AND t.category='tuition_fee' AND t.transaction_type='income' AND t.status='active') links FROM fee_payments p`).all()).results;
 assert.equal(payments.length,8);for(const p of payments){assert.equal(p.links,1);assert.match(p.client_request_id,/^LOCAL-DEMO-/);assert.match(p.request_fingerprint,/^[a-f0-9]{64}$/);
  const input=parsePayment({school_id:p.school_id,student_fee_id:p.student_fee_id,amount:p.amount,payment_method:p.payment_method,payment_date:p.payment_date,notes:p.notes,client_request_id:p.client_request_id});
  assert.equal(p.request_fingerprint,createHash('sha256').update(JSON.stringify({...input,client_request_id:undefined})).digest('hex'));
 }
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM finance_fee_readiness WHERE healthy!=1').first()).n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM finance_treasury_readiness WHERE healthy!=1').first()).n,0);
 return {fees:fees.length,payments:payments.length,accounts:accounts.map(a=>({school_id:a.school_id,balance:a.current_balance,ledger:a.ledger})),fk_clean:true,all_finance_invariants:true};
}
