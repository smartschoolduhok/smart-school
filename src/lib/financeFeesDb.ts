import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { FINANCE_ACCESS_ROLES, hasRole } from './rbac';
import { FinanceError, financeDatabaseError, financeId, financeObject, financeQueryId, financeText, feeStatus, parseFee, parsePayment, parseReceipt, requireFinance } from './financeFees';

type FinanceEnv = { Bindings: Bindings; Variables: Variables };
type C = Context<FinanceEnv>;
type Row = Record<string, any>;
const feeSelect = `SELECT f.*,s.full_name student_name,s.student_number,cl.name class_name,sec.name section_name,y.name academic_year_name
 FROM student_fees f JOIN students s ON s.id=f.student_id AND s.school_id=f.school_id
 LEFT JOIN classes cl ON cl.id=s.class_id AND cl.school_id=s.school_id
 LEFT JOIN sections sec ON sec.id=s.section_id AND sec.school_id=s.school_id AND sec.class_id=s.class_id
 LEFT JOIN academic_years y ON y.id=f.academic_year_id AND y.school_id=f.school_id`;
const paymentSelect = `SELECT p.id,p.school_id,p.student_fee_id,p.student_id,p.amount,p.payment_method,p.payment_date,p.receipt_number,p.notes,p.created_by_user_id,p.created_at,
 p.status,p.cancelled_at,p.cancelled_by_user_id,p.cancel_reason,p.client_request_id,f.currency,f.fee_type,s.full_name student_name,s.student_number,u.full_name created_by_name,
 (SELECT receipt_id FROM fee_receipt_payments WHERE payment_id=p.id AND school_id=p.school_id AND is_active=1) active_receipt_id
 FROM fee_payments p JOIN student_fees f ON f.id=p.student_fee_id AND f.school_id=p.school_id AND f.student_id=p.student_id
 JOIN students s ON s.id=p.student_id AND s.school_id=p.school_id
 LEFT JOIN users u ON u.id=p.created_by_user_id AND u.school_id=p.school_id`;

async function body(c: C) {
  const text = await c.req.text(); requireFinance(text.length <= 65536);
  try { return JSON.parse(text); } catch { throw new FinanceError('invalid_finance_request'); }
}
async function school(c: C, supplied?: unknown) {
  const user = c.get('user');
  requireFinance(user && hasRole(user.role_key, FINANCE_ACCESS_ROLES),'finance_forbidden',403);
  const requested = supplied == null ? undefined : financeId(supplied);
  let id: number;
  if (user.role_key === 'system_admin') {
    requireFinance(requested !== undefined,'finance_target_required'); id = requested;
  } else {
    requireFinance(user.school_id != null && (requested === undefined || requested === user.school_id),'finance_forbidden',403);
    id = user.school_id;
  }
  const active = await c.env.DB.prepare("SELECT id FROM schools WHERE id=? AND status='active'").bind(id).first();
  requireFinance(active,'finance_target_required');
  return id;
}
function requiredRow(row: Row | null): asserts row is Row { requireFinance(row,'finance_not_found',404); }
function resultRow(results: Array<{results?: Row[]}>, index: number): Row | undefined { return results[index].results?.[0]; }
async function sha256(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join(''); }
export async function findSameFinanceReceipt(db: D1Database, schoolId: number, studentId: number, ids: number[]) {
  return db.prepare(`SELECT r.* FROM fee_receipts r WHERE r.school_id=? AND r.student_id=? AND r.status='active'
    AND (SELECT COUNT(*) FROM fee_receipt_payments l WHERE l.receipt_id=r.id AND l.school_id=r.school_id AND l.is_active=1)=?
    AND NOT EXISTS(SELECT 1 FROM fee_receipt_payments l WHERE l.receipt_id=r.id AND l.is_active=1 AND l.payment_id NOT IN(SELECT value FROM json_each(?))) LIMIT 1`)
    .bind(schoolId,studentId,ids.length,JSON.stringify(ids)).first<Row>();
}

/** Both opt-in auto receipts and manual receipts use this single engine. */
export async function createFinanceReceipt(db: D1Database, schoolId: number, studentId: number, ids: number[], userId: number) {
  const payments = (await db.prepare(`SELECT p.id,p.amount,p.payment_method,p.payment_date,f.fee_type,p.status,f.currency,
      f.id student_fee_id,f.academic_year_id,y.id validated_year_id,y.name academic_year_name
    FROM fee_payments p JOIN student_fees f ON f.id=p.student_fee_id AND f.school_id=p.school_id AND f.student_id=p.student_id
    LEFT JOIN academic_years y ON y.id=f.academic_year_id AND y.school_id=f.school_id
    WHERE p.school_id=? AND p.student_id=? AND p.id IN(SELECT value FROM json_each(?)) ORDER BY p.id`).bind(schoolId,studentId,JSON.stringify(ids)).all<Row>()).results ?? [];
  requireFinance(payments.length===ids.length,'receipt_payment_missing');
  requireFinance(payments.every(p=>p.status==='active' && p.currency==='IQD' && Number.isSafeInteger(p.amount) && p.amount>0),'receipt_payment_invalid');
  const total=payments.reduce((sum,p)=>sum+p.amount,0); requireFinance(Number.isSafeInteger(total),'invalid_finance_amount');
  const same=await findSameFinanceReceipt(db,schoolId,studentId,ids); if(same) return same;
  // Existing issued documents are immutable. New documents describe the fee
  // year, never the school's currently active year (including legacy null years).
  const yearId=payments[0].academic_year_id;
  requireFinance(payments.every(p=>p.academic_year_id===yearId && (yearId===null || p.validated_year_id===yearId)), 'receipt_academic_year_conflict');
  const student=await db.prepare(`SELECT s.full_name,cl.name class_name,sec.name section_name,sch.name school_name,sch.logo_url,
      settings.receipt_footer_text,settings.verification_note_text,settings.use_school_logo_on_docs
    FROM students s JOIN schools sch ON sch.id=s.school_id
    LEFT JOIN classes cl ON cl.id=s.class_id AND cl.school_id=s.school_id
    LEFT JOIN sections sec ON sec.id=s.section_id AND sec.school_id=s.school_id AND sec.class_id=s.class_id
    LEFT JOIN school_settings settings ON settings.school_id=s.school_id
    WHERE s.id=? AND s.school_id=? AND s.status='active' AND sch.status='active'`).bind(studentId,schoolId).first<Row>();
  requiredRow(student);
  const token=crypto.randomUUID(),number=`REC-${schoolId}-${crypto.randomUUID()}`;
  const snapshot=payments.map(p=>({payment_id:p.id,student_fee_id:p.student_fee_id,academic_year_id:p.academic_year_id,academic_year_name:p.academic_year_name,
    amount:p.amount,payment_method:p.payment_method,payment_date:p.payment_date,fee_type:p.fee_type,currency:'IQD'}));
  const settings={receipt_footer_text:student.receipt_footer_text??null,verification_note_text:student.verification_note_text??null,logo_url:student.use_school_logo_on_docs===1?student.logo_url??null:null,currency:'IQD'};
  try {
    // Trigger reserves every payment. Uniqueness/conflict failure rolls back the
    // entire document; the final response SELECT is inside the same D1 batch.
    const results=await db.batch([
      db.prepare(`INSERT INTO fee_receipts(school_id,student_id,receipt_number,total_amount,payment_ids_json,payments_snapshot_json,settings_snapshot_json,
        student_name_snapshot,class_name_snapshot,section_name_snapshot,school_name_snapshot,academic_year_snapshot,verification_token,verification_hash,status,created_by_user_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`).bind(schoolId,studentId,number,total,JSON.stringify(ids),JSON.stringify(snapshot),JSON.stringify(settings),
          student.full_name,student.class_name??null,student.section_name??null,student.school_name,payments[0].academic_year_name??null,token,await sha256(token),userId),
      db.prepare('SELECT * FROM fee_receipts WHERE verification_token=? AND school_id=?').bind(token,schoolId),
    ]);
    return resultRow(results,1)!;
  } catch(error) {
    if(financeDatabaseError(error).code==='receipt_payment_already_receipted') {
      const winner=await findSameFinanceReceipt(db,schoolId,studentId,ids); if(winner) return winner;
    }
    throw error;
  }
}

export function registerFinanceRoutes(app: Hono<FinanceEnv>) {
  // Global auth runs first in worker.ts. This gate applies before body parsing
  // to EVERY private finance route, including direct reads and printing.
  const route=(method: string,path: string,handler:(c:C)=>Promise<Response>)=>app.on(method,'/api/'+path,async c=>{
    try {
      requireFinance(c.get('user') && hasRole(c.get('user').role_key,FINANCE_ACCESS_ROLES),'finance_forbidden',403);
      return await handler(c);
    } catch(error) {
      const safe=financeDatabaseError(error);
      if(safe.status===500) console.error('[finance] operation failed',{code:safe.code});
      return c.json({error:safe.message,code:safe.code},safe.status);
    }
  });
  route('GET','student-fees',async c=>{
    const query=c.req.query(),schoolId=await school(c,financeQueryId(query.school_id));
    const student=financeQueryId(query.student_id),status=query.status;
    requireFinance(status===undefined || ['pending','partial','paid'].includes(status));
    const rows=await c.env.DB.prepare(feeSelect+' WHERE f.school_id=? AND (? IS NULL OR f.student_id=?) AND (? IS NULL OR f.status=?) ORDER BY f.id DESC')
      .bind(schoolId,student??null,student??null,status??null,status??null).all();
    return c.json({data:rows.results});
  });
  route('POST','student-fees',async c=>{
    const input=parseFee(await body(c)),schoolId=await school(c,input.school_id),db=c.env.DB;
    const row=await db.prepare(`INSERT INTO student_fees(school_id,student_id,academic_year_id,fee_type,fee_type_key,amount,currency,due_date,notes,discount_type,discount_value,discount_amount,net_fee,status)
      VALUES(?,?,?,?,?,?,'IQD',?,?,?,?,?,?,?) RETURNING *`).bind(schoolId,input.student_id,input.academic_year_id,input.fee_type,input.fee_type,input.amount,input.due_date,input.notes,
        input.discount_type,input.discount_value,input.discount_amount,input.net_fee,feeStatus(input.net_fee,0)).first();
    return c.json({data:row},201);
  });
  route('PUT','student-fees/:id',async c=>{
    const raw=await body(c),schoolId=await school(c,raw?.school_id),id=financeQueryId(c.req.param('id'))!,db=c.env.DB;
    const current=await db.prepare(`SELECT f.*,(SELECT coalesce(SUM(p.amount),0) FROM fee_payments p WHERE p.school_id=f.school_id AND p.student_fee_id=f.id AND p.status='active') ledger_paid,
      (SELECT healthy FROM finance_fee_readiness WHERE id=f.id) fee_ready,(SELECT healthy FROM finance_treasury_readiness WHERE school_id=f.school_id) treasury_ready
      FROM student_fees f WHERE f.id=? AND f.school_id=?`).bind(id,schoolId).first<Row>(); requiredRow(current);
    requireFinance(current.currency!=='IQD' || (current.fee_ready===1 && current.treasury_ready===1),'finance_reconciliation_required',409);
    const input=parseFee(raw,current); requireFinance(input.net_fee>=current.ledger_paid,'fee_net_below_paid');
    const status=feeStatus(input.net_fee,current.ledger_paid);
    const values={fee_type:input.fee_type,amount:input.amount,currency:input.currency,due_date:input.due_date,notes:input.notes,discount_type:input.discount_type,
      discount_value:input.discount_value,discount_amount:input.discount_amount,net_fee:input.net_fee,paid_amount:current.ledger_paid,status};
    if(Object.entries(values).every(([key,value])=>current[key]===value)) return c.json({data:current});
    const row=await db.prepare(`UPDATE student_fees SET fee_type=?,fee_type_key=?,amount=?,due_date=?,notes=?,discount_type=?,discount_value=?,discount_amount=?,net_fee=?,
      paid_amount=?,status=?,finance_revision=finance_revision+1,updated_at=unixepoch() WHERE id=? AND school_id=? AND finance_revision=? RETURNING *`)
      .bind(input.fee_type,input.fee_type,input.amount,input.due_date,input.notes,input.discount_type,input.discount_value,input.discount_amount,input.net_fee,current.ledger_paid,status,id,schoolId,current.finance_revision).first();
    requireFinance(row,'finance_operation_stale',409);return c.json({data:row});
  });
  route('DELETE','student-fees/:id',async c=>{
    const raw=financeObject(await body(c),['school_id']),schoolId=await school(c,raw.school_id),id=financeQueryId(c.req.param('id'))!;
    const row=await c.env.DB.prepare('DELETE FROM student_fees WHERE id=? AND school_id=? RETURNING id').bind(id,schoolId).first<Row>(); requiredRow(row);
    return c.json({data:row});
  });
  route('GET','fee-payments',async c=>{
    const q=c.req.query(),schoolId=await school(c,financeQueryId(q.school_id)),student=financeQueryId(q.student_id),fee=financeQueryId(q.student_fee_id);
    const rows=await c.env.DB.prepare(paymentSelect+' WHERE p.school_id=? AND (? IS NULL OR p.student_id=?) AND (? IS NULL OR p.student_fee_id=?) ORDER BY p.id DESC')
      .bind(schoolId,student??null,student??null,fee??null,fee??null).all();return c.json({data:rows.results});
  });
  route('POST','fee-payments',async c=>{
    const input=parsePayment(await body(c)),schoolId=await school(c,input.school_id),db=c.env.DB,user=c.get('user');
    const fingerprint=await sha256(JSON.stringify({...input,school_id:schoolId,client_request_id:undefined}));
    const paymentByKey = `SELECT p.*,max(0,coalesce(f.net_fee,f.amount)-f.paid_amount) remaining
      FROM fee_payments p JOIN student_fees f ON f.id=p.student_fee_id AND f.school_id=p.school_id AND f.student_id=p.student_id
      WHERE p.school_id=? AND p.client_request_id=?`;
    const find=()=>db.prepare(paymentByKey).bind(schoolId,input.client_request_id).first<Row>();
    let payment=await find(),reused=!!payment;
    if(payment) requireFinance(payment.request_fingerprint===fingerprint,'payment_idempotency_conflict',409);
    if(!payment) {
      const fee=await db.prepare('SELECT id,student_id FROM student_fees WHERE id=? AND school_id=?').bind(input.student_fee_id,schoolId).first<Row>();requiredRow(fee);
      try {
        // Payment triggers post fee summary, linked treasury and balance cache.
        // This INSERT plus the response read is ONE atomic D1 batch; no compensation.
        const results=await db.batch([
          db.prepare(`INSERT INTO fee_payments(school_id,student_fee_id,student_id,amount,payment_method,payment_date,notes,created_by_user_id,client_request_id,request_fingerprint)
            VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(schoolId,fee.id,fee.student_id,input.amount,input.payment_method,input.payment_date,input.notes,user.id,input.client_request_id,fingerprint),
          db.prepare(paymentByKey).bind(schoolId,input.client_request_id),
        ]); payment=resultRow(results,1)!;
      } catch(error) {
        // A concurrent winner may hit either uniqueness OR current balance guard.
        // Only a fully committed row with the same fingerprint counts as success.
        const winner=await find();
        if(!winner) throw error;
        requireFinance(winner.request_fingerprint===fingerprint,'payment_idempotency_conflict',409);payment=winner;reused=true;
      }
    }
    // Optional auto-document generation is not part of money posting. Both paths
    // share the reservation engine; safe retry cannot repeat financial effects.
    let auto_receipt=null,warning: string | undefined;
    if(input.auto_generate_receipt && payment.status==='active') {
      try {const receipt=await createFinanceReceipt(db,schoolId,payment.student_id,[payment.id],user.id);auto_receipt={id:receipt.id,receipt_number:receipt.receipt_number,verification_url:'/verify/receipt/'+receipt.verification_token};}
      catch(error) {warning=financeDatabaseError(error).message;}
    }
    const {request_fingerprint: _fingerprint,...safePayment}=payment;
    return c.json({data:{...safePayment,already_applied:reused,auto_receipt},...(warning?{warning}:{})},reused?200:201);
  });
  route('PUT','fee-payments/:id/cancel',async c=>{
    const raw=financeObject(await body(c),['school_id','cancel_reason']),reason=financeText(raw.cancel_reason,1000,true),schoolId=await school(c,raw.school_id),id=financeQueryId(c.req.param('id'))!,db=c.env.DB;
    const payment=await db.prepare('SELECT id,status FROM fee_payments WHERE id=? AND school_id=?').bind(id,schoolId).first<Row>();requiredRow(payment);
    requireFinance(payment.status==='active','payment_already_cancelled',409);
    const results=await db.batch([
      db.prepare("UPDATE fee_payments SET status='cancelled',cancelled_at=unixepoch(),cancelled_by_user_id=?,cancel_reason=? WHERE id=? AND school_id=? AND status='active' RETURNING id")
        .bind(c.get('user').id,reason,id,schoolId),
      db.prepare(paymentSelect+' WHERE p.id=? AND p.school_id=?').bind(id,schoolId),
    ]);
    requireFinance(resultRow(results,0),'payment_already_cancelled',409);return c.json({data:resultRow(results,1)});
  });
  route('GET','fee-receipts',async c=>{
    const q=c.req.query(),schoolId=await school(c,financeQueryId(q.school_id)),student=financeQueryId(q.student_id);
    const rows=await c.env.DB.prepare(`SELECT r.*,u.full_name created_by_name FROM fee_receipts r LEFT JOIN users u ON u.id=r.created_by_user_id AND u.school_id=r.school_id
      WHERE r.school_id=? AND (? IS NULL OR r.student_id=?) ORDER BY r.id DESC`).bind(schoolId,student??null,student??null).all();return c.json({data:rows.results});
  });
  route('GET','fee-receipts/:id',async c=>{
    const schoolId=await school(c,financeQueryId(c.req.query('school_id'))),id=financeQueryId(c.req.param('id'))!;
    const row=await c.env.DB.prepare('SELECT * FROM fee_receipts WHERE id=? AND school_id=?').bind(id,schoolId).first<Row>();requiredRow(row);
    return c.json({data:{...row,payments_snapshot:JSON.parse(row.payments_snapshot_json??'[]'),payment_ids:JSON.parse(row.payment_ids_json),settings_snapshot:JSON.parse(row.settings_snapshot_json??'{}')}});
  });
  route('POST','fee-receipts/generate',async c=>{
    const input=parseReceipt(await body(c)),schoolId=await school(c,input.school_id);
    const receipt=await createFinanceReceipt(c.env.DB,schoolId,input.student_id,input.payment_ids,c.get('user').id);
    return c.json({data:{receipt,verification_url:'/verify/receipt/'+receipt.verification_token},message:'تم إنشاء الإيصال بنجاح'});
  });
  route('PUT','fee-receipts/:id/cancel',async c=>{
    const raw=financeObject(await body(c),['school_id','cancel_reason']),reason=financeText(raw.cancel_reason,1000,true),schoolId=await school(c,raw.school_id),id=financeQueryId(c.req.param('id'))!,db=c.env.DB;
    const receipt=await db.prepare('SELECT id,status FROM fee_receipts WHERE id=? AND school_id=?').bind(id,schoolId).first<Row>();requiredRow(receipt);
    requireFinance(receipt.status==='active','receipt_already_cancelled',409);
    const results=await db.batch([
      db.prepare("UPDATE fee_receipts SET status='cancelled',cancelled_at=unixepoch(),cancelled_by_user_id=?,cancel_reason=?,updated_at=unixepoch() WHERE id=? AND school_id=? AND status='active' RETURNING id,status").bind(c.get('user').id,reason,id,schoolId),
      db.prepare('SELECT id,status,cancelled_at,cancelled_by_user_id,cancel_reason FROM fee_receipts WHERE id=? AND school_id=?').bind(id,schoolId),
    ]);
    requireFinance(resultRow(results,0),'receipt_already_cancelled',409);return c.json({data:resultRow(results,1),message:'تم إلغاء المستند فقط؛ الدفعات والمال لم يتغيرا.'});
  });
  route('PUT','fee-receipts/:id/mark-printed',async c=>{
    const raw=financeObject(await body(c),['school_id','copies']),schoolId=await school(c,raw.school_id),id=financeQueryId(c.req.param('id'))!,copies=raw.copies===undefined?1:financeId(raw.copies),db=c.env.DB;
    requireFinance(copies<=100);
    const receipt=await db.prepare('SELECT id,status FROM fee_receipts WHERE id=? AND school_id=?').bind(id,schoolId).first<Row>();requiredRow(receipt);requireFinance(receipt.status==='active','receipt_already_cancelled',409);
    const results=await db.batch([
      db.prepare("INSERT INTO print_records(school_id,document_id,print_type,source_type,source_id,document_number,title,printed_at,printed_by_user_id,copies_count) SELECT school_id,id,'receipt','fee_receipts',id,receipt_number,'وصل قسط',unixepoch(),?,? FROM fee_receipts WHERE id=? AND school_id=?").bind(c.get('user').id,copies,id,schoolId),
      db.prepare("UPDATE fee_receipts SET printed_at=unixepoch(),updated_at=unixepoch() WHERE id=? AND school_id=? AND status='active'").bind(id,schoolId),
      db.prepare('SELECT id,printed_at FROM fee_receipts WHERE id=? AND school_id=?').bind(id,schoolId),
    ]);return c.json({data:resultRow(results,2)});
  });
}
