// READ-ONLY, explicit local SQLite/export path only. Never contacts Wrangler/D1.
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function preflightFinance(db) {
 const issues=[];
 const fees=db.prepare('SELECT id,school_id,student_id,academic_year_id,fee_type,currency FROM student_fees').all();
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
  for(const id of ids){const p=db.prepare('SELECT amount FROM fee_payments WHERE id=? AND school_id=? AND student_id=?').get(id,r.school_id,r.student_id);
   if(!p)issues.push({code:'receipt_payment_missing',receipt_id:r.id,payment_id:id});else total+=p.amount;
   if(r.status==='active'){if(reserved.has(id))issues.push({code:'duplicate_active_receipt',payment_id:id,receipt_ids:[reserved.get(id),r.id]});reserved.set(id,r.id);}
  }
  if(total!==r.total_amount)issues.push({code:'receipt_total_mismatch',id:r.id});
 }
 const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();if(foreignKeys.length)issues.push({code:'foreign_key_violations',rows:foreignKeys});
 return {safe:issues.length===0,issues,legacy_non_iqd_fee_ids:fees.filter(f=>f.currency!=='IQD').map(f=>f.id)};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const path=process.argv[2];if(!path||/^https?:/i.test(path))throw new Error('Supply an explicit authorized LOCAL SQLite file path. No remote access supported.');
 const db=new DatabaseSync(resolve(path),{readOnly:true});try{const result=preflightFinance(db);console.log(JSON.stringify(result,null,2));if(!result.safe)process.exitCode=1;}finally{db.close();}
}
