// READ-ONLY, explicit local SQLite/export path only. Never contacts Wrangler/D1.
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {calculateFee,feeStatus} from '../src/lib/financeFees.ts';
const whole=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
const active=p=>(p.status??'active')==='active'; // 0027 has no payment status.
const group=(rows,key)=>{const map=new Map();for(const row of rows){const id=key(row);if(!map.has(id))map.set(id,[]);map.get(id).push(row);}return map;};
export function preflightFinance(db) {
 const issues=[],operational=[],warnings=[];
 // Fixed table reads, not one query per payment/receipt; before or after 0028.
 const fees=db.prepare('SELECT * FROM student_fees').all();
 const payments=db.prepare('SELECT * FROM fee_payments').all();
 const treasury=db.prepare('SELECT * FROM treasury_transactions').all();
 const accounts=db.prepare('SELECT * FROM treasury_accounts').all();
 const byFee=group(payments,p=>p.student_fee_id),bySchool=group(treasury,t=>t.school_id);
 const paymentById=new Map(payments.map(p=>[p.id,p])),feeById=new Map(fees.map(f=>[f.id,f]));
 const links=group(treasury.filter(t=>t.source_type==='fee_payment'),t=>t.source_id);
 const identities=new Map();
 for(const f of fees){const key=JSON.stringify([f.school_id,f.student_id,f.academic_year_id,f.fee_type.trim().replace(/\s+/gu,' ')]);const list=identities.get(key)??[];list.push(f.id);identities.set(key,list);}
 for(const ids of identities.values())if(ids.length>1)issues.push({code:'duplicate_student_fee',ids});
 for(const [code,sql]of [
  ['duplicate_receipt_number','SELECT group_concat(id) ids FROM fee_receipts GROUP BY school_id,receipt_number HAVING COUNT(*)>1'],
  ['duplicate_receipt_token','SELECT group_concat(id) ids FROM fee_receipts GROUP BY verification_token HAVING COUNT(*)>1'],
 ])for(const row of db.prepare(sql).all())issues.push({code,ids:row.ids.split(',').map(Number)});
 const reserved=new Map();
 for(const r of db.prepare('SELECT id,school_id,student_id,status,total_amount,payment_ids_json FROM fee_receipts').all()){
  if(!['active','cancelled'].includes(r.status))issues.push({code:'invalid_receipt_status',id:r.id});
  let ids;try{ids=JSON.parse(r.payment_ids_json);}catch{issues.push({code:'invalid_receipt_json',id:r.id});continue;}
  if(!Array.isArray(ids)||ids.length===0||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<=0)){issues.push({code:'invalid_receipt_ids',id:r.id});continue;}
  let total=0;
  for(const id of ids){const p=paymentById.get(id);
   if(!p||p.school_id!==r.school_id||p.student_id!==r.student_id)issues.push({code:'receipt_payment_missing',receipt_id:r.id,payment_id:id});else total+=p.amount;
   if(r.status==='active'){if(reserved.has(id))issues.push({code:'duplicate_active_receipt',payment_id:id,receipt_ids:[reserved.get(id),r.id]});reserved.set(id,r.id);}
  }
  if(total!==r.total_amount)issues.push({code:'receipt_total_mismatch',id:r.id});
 }
 for(const f of fees){
  if(f.currency!=='IQD'){operational.push({code:'unsupported_fee_currency',id:f.id,currency:f.currency});continue;}
  const ps=(byFee.get(f.id)??[]).filter(active),valid=ps.every(p=>whole(p.amount,1));
  if(!whole(f.amount,1)||!whole(f.paid_amount)||!whole(f.net_fee)||!whole(f.discount_amount))operational.push({code:'invalid_whole_iqd_fee',id:f.id});
  try{const net=calculateFee(f.amount,f.discount_type,f.discount_value);if(net.net_fee!==f.net_fee||net.discount_amount!==f.discount_amount)throw new Error('mismatch');}
  catch{operational.push({code:'fee_discount_net_mismatch',id:f.id});}
  if(valid){const ledger=ps.reduce((n,p)=>n+BigInt(p.amount),0n);
   if(!whole(f.paid_amount)||BigInt(f.paid_amount)!==ledger)operational.push({code:'fee_paid_ledger_mismatch',id:f.id,stored:f.paid_amount,ledger:ledger.toString()});
   if(!whole(f.net_fee)||ledger>BigInt(f.net_fee)||f.status!==feeStatus(f.net_fee,Number(ledger)))operational.push({code:'fee_status_net_mismatch',id:f.id,status:f.status,net_fee:f.net_fee,ledger:ledger.toString()});
  }
  if(!['pending','partial','paid'].includes(f.status))warnings.push({code:'legacy_fee_status_review',id:f.id,status:f.status});
 }
 for(const p of payments){
  const f=feeById.get(p.student_fee_id);
  if(!f||p.school_id!==f.school_id||p.student_id!==f.student_id)operational.push({code:'payment_scope_mismatch',id:p.id});
  if(f?.currency==='IQD'&&!whole(p.amount,1))operational.push({code:'invalid_whole_iqd_payment',id:p.id});
  const ts=links.get(p.id)??[],t=ts[0];
  if(ts.length!==1||t.school_id!==p.school_id||t.transaction_type!=='income'||t.category!=='tuition_fee'||t.amount!==p.amount||t.currency!==f?.currency||t.status!==(active(p)?'active':'cancelled'))
   operational.push({code:'payment_treasury_link_mismatch',id:p.id,treasury_ids:ts.map(t=>t.id)});
 }
 const accountBySchool=new Map(accounts.map(a=>[a.school_id,a]));
 for(const schoolId of new Set([...bySchool.keys(),...accountBySchool.keys()])){
  const ts=bySchool.get(schoolId)??[],current=ts.filter(t=>t.status==='active'),a=accountBySchool.get(schoolId);
  const unsupported=current.filter(t=>t.currency!=='IQD'),invalid=current.filter(t=>t.currency==='IQD'&&!whole(t.amount,1));
  if(unsupported.length)operational.push({code:'unsupported_active_treasury_currency',school_id:schoolId,ids:unsupported.map(t=>t.id)});
  if(invalid.length)operational.push({code:'invalid_whole_iqd_treasury',school_id:schoolId,ids:invalid.map(t=>t.id)});
  if(!a){operational.push({code:'treasury_account_missing',school_id:schoolId});continue;}
  if(!invalid.length){const ledger=current.filter(t=>t.currency==='IQD').reduce((n,t)=>n+(t.transaction_type==='income'?1n:-1n)*BigInt(t.amount),0n);
   if(!Number.isSafeInteger(a.current_balance)||BigInt(a.current_balance)!==ledger)operational.push({code:'treasury_balance_ledger_mismatch',school_id:schoolId,stored:a.current_balance,ledger:ledger.toString()});
  }
 }
 const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();if(foreignKeys.length)issues.push({code:'foreign_key_violations',rows:foreignKeys});
 // 'safe' retains its migration-only meaning for existing callers.
 return {safe:issues.length===0,migration_safe:issues.length===0,issues,migration_blockers:issues,
  operational_ready:issues.length===0&&operational.length===0,operational_blockers:operational,warnings,
  legacy_non_iqd_fee_ids:fees.filter(f=>f.currency!=='IQD').map(f=>f.id)};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const path=process.argv[2];if(!path||/^https?:/i.test(path))throw new Error('Supply an explicit authorized LOCAL SQLite file path. No remote access supported.');
 const db=new DatabaseSync(resolve(path),{readOnly:true});try{const result=preflightFinance(db);console.log(JSON.stringify(result,null,2));if(!result.operational_ready)process.exitCode=1;}finally{db.close();}
}
