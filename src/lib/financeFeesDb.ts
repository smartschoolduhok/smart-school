import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { FINANCE_ACCESS_ROLES, hasRole } from './rbac';
import { businessDate } from './businessTime';
import { allocateInstallments, FinanceError, financeDatabaseError, financeId, financeObject, financeQueryId, financeText, feeStatus, parseFee, parseInstallmentPlan, parsePayment, parseReceipt, requireFinance } from './financeFees';

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
function safeMoneySum(values: number[]) {
  const total=values.reduce((sum,value)=>sum+value,0);
  requireFinance(Number.isSafeInteger(total),'invalid_finance_amount');
  return total;
}
function ratioBasisPoints(paid: number,net: number) {
  if(net===0) return 10000;
  return Math.min(10000,Number((BigInt(paid)*10000n)/BigInt(net)));
}
function parsedJson<T>(value: unknown,fallback: T): T {
  if(typeof value!=='string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function receiptPayload(row: Row,parentSafe=false) {
  const hydrated:Row={
    ...row,
    payments_snapshot:parsedJson(row.payments_snapshot_json,[]),
    payment_ids:parsedJson(row.payment_ids_json,[]),
    settings_snapshot:parsedJson(row.settings_snapshot_json,{}),
    financial_summary_snapshot:parsedJson(row.financial_summary_snapshot_json,null),
    installment_plan_snapshot:parsedJson(row.installment_plan_snapshot_json,[]),
  };
  if(!parentSafe) return hydrated;
  const safePayments=(hydrated.payments_snapshot as Row[]).map(payment=>({
    payment_id:payment.payment_id,student_fee_id:payment.student_fee_id,academic_year_id:payment.academic_year_id,
    academic_year_name:payment.academic_year_name,amount:payment.amount,payment_method:payment.payment_method,
    payment_date:payment.payment_date,fee_type:payment.fee_type,currency:payment.currency,
  }));
  const safePlans=(hydrated.installment_plan_snapshot as Row[]).map(plan=>({
    id:plan.id,student_fee_id:plan.student_fee_id,items:plan.items,
  }));
  return {
    id:hydrated.id,school_id:hydrated.school_id,student_id:hydrated.student_id,receipt_number:hydrated.receipt_number,
    total_amount:hydrated.total_amount,status:hydrated.status,created_at:hydrated.created_at,cancelled_at:hydrated.cancelled_at,
    verification_token:hydrated.verification_token,receipt_schema_version:hydrated.receipt_schema_version,
    student_name_snapshot:hydrated.student_name_snapshot,student_number_snapshot:hydrated.student_number_snapshot,
    class_name_snapshot:hydrated.class_name_snapshot,section_name_snapshot:hydrated.section_name_snapshot,
    school_name_snapshot:hydrated.school_name_snapshot,academic_year_snapshot:hydrated.academic_year_snapshot,
    currency_snapshot:hydrated.currency_snapshot,received_by_snapshot:hydrated.received_by_snapshot,
    replaces_receipt_id:hydrated.replaces_receipt_id,payments_snapshot:safePayments,
    settings_snapshot:hydrated.settings_snapshot,financial_summary_snapshot:hydrated.financial_summary_snapshot,
    installment_plan_snapshot:safePlans,
  };
}

async function loadActiveInstallmentPlans(db: D1Database,schoolId: number,feeIds: number[],paidByFee: Map<number,number>,asOf=businessDate()) {
  if(feeIds.length===0) return [];
  const rows=(await db.prepare(`SELECT p.id plan_id,p.plan_key,p.student_fee_id,p.fee_revision_snapshot,p.notes,p.created_at,
      i.id item_id,i.sequence_no,i.label,i.amount,i.percentage_basis_points,i.due_date
    FROM fee_installment_plans p JOIN fee_installment_items i ON i.plan_id=p.id AND i.school_id=p.school_id
    WHERE p.school_id=? AND p.status='active' AND p.student_fee_id IN(SELECT value FROM json_each(?))
    ORDER BY p.student_fee_id,i.sequence_no`).bind(schoolId,JSON.stringify(feeIds)).all<Row>()).results??[];
  const byPlan=new Map<number,Row>();
  for(const row of rows) {
    let plan=byPlan.get(row.plan_id);
    if(!plan) {
      plan={id:row.plan_id,plan_key:row.plan_key,student_fee_id:row.student_fee_id,fee_revision_snapshot:row.fee_revision_snapshot,
        notes:row.notes,created_at:row.created_at,items:[]};
      byPlan.set(row.plan_id,plan);
    }
    plan.items.push({id:row.item_id,sequence_no:row.sequence_no,label:row.label,amount:row.amount,
      percentage_basis_points:row.percentage_basis_points,due_date:row.due_date});
  }
  return [...byPlan.values()].map<Row>(plan=>({...plan,items:allocateInstallments(plan.items,paidByFee.get(plan.student_fee_id)??0,asOf)}));
}

async function loadStudentFinance(db: D1Database,schoolId: number,studentId: number,parentUserId: number|null=null) {
  const [feeResult,paymentResult,receiptResult,linkedResult]=await Promise.all([
    db.prepare(feeSelect+' WHERE f.school_id=? AND f.student_id=? ORDER BY coalesce(y.starts_at,\'\') DESC,f.id DESC').bind(schoolId,studentId).all<Row>(),
    db.prepare(`SELECT p.id,p.student_fee_id,p.amount,p.payment_method,p.payment_date,p.status,p.created_at,
        p.cancelled_at,f.fee_type,f.currency
      FROM fee_payments p JOIN student_fees f ON f.id=p.student_fee_id AND f.school_id=p.school_id
      WHERE p.school_id=? AND p.student_id=? ORDER BY p.payment_date DESC,p.id DESC`).bind(schoolId,studentId).all<Row>(),
    db.prepare(`SELECT r.id,r.receipt_number,r.total_amount,r.currency_snapshot,r.status,r.created_at,r.cancelled_at,
        r.verification_token,r.replaces_receipt_id,
        (SELECT newer.id FROM fee_receipts newer WHERE newer.replaces_receipt_id=r.id LIMIT 1) replaced_by_receipt_id
      FROM fee_receipts r WHERE r.school_id=? AND r.student_id=? ORDER BY r.id DESC`).bind(schoolId,studentId).all<Row>(),
    parentUserId!==null
      ? db.prepare(`SELECT s.id,s.full_name,s.student_number,cl.name class_name,sec.name section_name
          FROM parent_student_links l JOIN students s ON s.id=l.student_id AND s.school_id=l.school_id AND s.status='active'
          LEFT JOIN classes cl ON cl.id=s.class_id AND cl.school_id=s.school_id
          LEFT JOIN sections sec ON sec.id=s.section_id AND sec.school_id=s.school_id AND sec.class_id=s.class_id
          WHERE l.school_id=? AND l.parent_user_id=? AND l.status='active' ORDER BY s.full_name,s.id`).bind(schoolId,parentUserId).all<Row>()
      : Promise.resolve({results:[]} as {results:Row[]}),
  ]);
  const rawFees=feeResult.results??[];
  requireFinance(rawFees.every(fee=>fee.currency==='IQD'),'unsupported_finance_currency',409);
  const paidByFee=new Map(rawFees.map(fee=>[Number(fee.id),Number(fee.paid_amount)]));
  const plans=await loadActiveInstallmentPlans(db,schoolId,rawFees.map(fee=>Number(fee.id)),paidByFee);
  const planByFee=new Map(plans.map(plan=>[Number(plan.student_fee_id),plan]));
  const hydratedFees:Row[]=rawFees.map(fee=>({...fee,remaining_amount:Math.max(0,Number(fee.net_fee??fee.amount)-Number(fee.paid_amount)),installment_plan:planByFee.get(Number(fee.id))??null}));
  const original=safeMoneySum(hydratedFees.map(fee=>Number(fee.amount)));
  const discount=safeMoneySum(hydratedFees.map(fee=>Number(fee.discount_amount??0)));
  const net=safeMoneySum(hydratedFees.map(fee=>Number(fee.net_fee??fee.amount)));
  const paid=safeMoneySum(hydratedFees.map(fee=>Number(fee.paid_amount)));
  const fees=parentUserId===null ? hydratedFees : hydratedFees.map(fee=>({
    id:fee.id,student_id:fee.student_id,academic_year_id:fee.academic_year_id,academic_year_name:fee.academic_year_name,
    fee_type:fee.fee_type,amount:fee.amount,currency:fee.currency,due_date:fee.due_date,paid_amount:fee.paid_amount,status:fee.status,
    discount_type:fee.discount_type,discount_value:fee.discount_value,discount_amount:fee.discount_amount,net_fee:fee.net_fee,
    remaining_amount:fee.remaining_amount,installment_plan:fee.installment_plan?{
      id:fee.installment_plan.id,student_fee_id:fee.installment_plan.student_fee_id,items:fee.installment_plan.items,
    }:null,
  }));
  return {
    student_id:studentId,currency:'IQD',business_date:businessDate(),
    totals:{original_fee:original,discount_amount:discount,net_due:net,paid_amount:paid,remaining_amount:Math.max(0,net-paid),payment_ratio_basis_points:hydratedFees.length===0?0:ratioBasisPoints(paid,net)},
    fees,payments:paymentResult.results??[],receipts:receiptResult.results??[],linked_students:linkedResult.results??[],
  };
}
export async function findSameFinanceReceipt(db: D1Database, schoolId: number, studentId: number, ids: number[]) {
  return db.prepare(`SELECT r.* FROM fee_receipts r WHERE r.school_id=? AND r.student_id=? AND r.status='active'
    AND (SELECT COUNT(*) FROM fee_receipt_payments l WHERE l.receipt_id=r.id AND l.school_id=r.school_id AND l.is_active=1)=?
    AND NOT EXISTS(SELECT 1 FROM fee_receipt_payments l WHERE l.receipt_id=r.id AND l.is_active=1 AND l.payment_id NOT IN(SELECT value FROM json_each(?))) LIMIT 1`)
    .bind(schoolId,studentId,ids.length,JSON.stringify(ids)).first<Row>();
}

/** Both opt-in auto receipts and manual receipts use this single engine. */
export async function createFinanceReceipt(db: D1Database, schoolId: number, studentId: number, ids: number[], userId: number,replacesReceiptId: number|null=null) {
  const payments = (await db.prepare(`SELECT p.id,p.amount,p.payment_method,p.payment_date,p.notes,f.fee_type,p.status,f.currency,
      f.id student_fee_id,f.amount fee_amount,f.discount_type,f.discount_value,f.discount_amount,f.net_fee,f.paid_amount,
      f.academic_year_id,y.id validated_year_id,y.name academic_year_name
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
  const student=await db.prepare(`SELECT s.full_name,s.student_number,cl.name class_name,sec.name section_name,sch.name school_name,sch.principal_name,sch.logo_url,sch.official_stamp_url,
      settings.receipt_footer_text,settings.verification_note_text,settings.use_school_logo_on_docs,settings.use_school_stamp_on_docs,
      settings.use_arabic_indic_digits,settings.date_format,receiver.full_name received_by_name
    FROM students s JOIN schools sch ON sch.id=s.school_id
    LEFT JOIN classes cl ON cl.id=s.class_id AND cl.school_id=s.school_id
    LEFT JOIN sections sec ON sec.id=s.section_id AND sec.school_id=s.school_id AND sec.class_id=s.class_id
    LEFT JOIN school_settings settings ON settings.school_id=s.school_id
    LEFT JOIN users receiver ON receiver.id=? AND receiver.status='active' AND (receiver.school_id=s.school_id OR receiver.school_id IS NULL)
    WHERE s.id=? AND s.school_id=? AND s.status='active' AND sch.status='active'`).bind(userId,studentId,schoolId).first<Row>();
  requiredRow(student);
  requireFinance(student.received_by_name,'finance_forbidden',403);
  const token=crypto.randomUUID(),number=`REC-${schoolId}-${crypto.randomUUID()}`;
  const snapshot=payments.map(p=>({payment_id:p.id,student_fee_id:p.student_fee_id,academic_year_id:p.academic_year_id,academic_year_name:p.academic_year_name,
    amount:p.amount,payment_method:p.payment_method,payment_date:p.payment_date,notes:p.notes,fee_type:p.fee_type,currency:'IQD'}));
  const feeRows=[...new Map(payments.map(payment=>[payment.student_fee_id,payment])).values()];
  const originalFee=safeMoneySum(feeRows.map(fee=>Number(fee.fee_amount)));
  const discountAmount=safeMoneySum(feeRows.map(fee=>Number(fee.discount_amount??0)));
  const netDue=safeMoneySum(feeRows.map(fee=>Number(fee.net_fee??fee.fee_amount)));
  const totalPaid=safeMoneySum(feeRows.map(fee=>Number(fee.paid_amount)));
  const financialSummary={snapshot_version:1,currency:'IQD',original_fee:originalFee,discount_amount:discountAmount,net_due:netDue,
    paid_before:Math.max(0,totalPaid-total),this_payment:total,total_paid:totalPaid,remaining_after:Math.max(0,netDue-totalPaid),
    payment_ratio_basis_points:ratioBasisPoints(totalPaid,netDue),fees:feeRows.map(fee=>({student_fee_id:fee.student_fee_id,fee_type:fee.fee_type,
      original_fee:fee.fee_amount,discount_type:fee.discount_type,discount_value:fee.discount_value,discount_amount:fee.discount_amount,
      net_due:fee.net_fee,total_paid:fee.paid_amount,remaining_after:Math.max(0,fee.net_fee-fee.paid_amount)}))};
  const paidByFee=new Map(feeRows.map(fee=>[Number(fee.student_fee_id),Number(fee.paid_amount)]));
  const installmentPlans=await loadActiveInstallmentPlans(db,schoolId,feeRows.map(fee=>Number(fee.student_fee_id)),paidByFee);
  if(replacesReceiptId===null) {
    const replaced=await db.prepare(`SELECT old.id FROM fee_receipts old
      WHERE old.school_id=? AND old.student_id=? AND old.status='cancelled'
        AND json_array_length(old.payment_ids_json)=?
        AND NOT EXISTS(SELECT 1 FROM json_each(old.payment_ids_json) old_payment WHERE old_payment.value NOT IN(SELECT value FROM json_each(?)))
        AND NOT EXISTS(SELECT 1 FROM fee_receipts newer WHERE newer.replaces_receipt_id=old.id)
      ORDER BY old.id DESC LIMIT 1`).bind(schoolId,studentId,ids.length,JSON.stringify(ids)).first<Row>();
    replacesReceiptId=replaced?.id??null;
  }
  const settings={snapshot_version:2,school_name:student.school_name,principal_name:student.principal_name??null,
    receipt_footer_text:student.receipt_footer_text??null,verification_note:student.verification_note_text??null,
    logo_url:student.logo_url??null,stamp_url:student.official_stamp_url??null,use_logo:student.use_school_logo_on_docs!==0,
    use_stamp:student.use_school_stamp_on_docs===1,use_arabic_indic_digits:student.use_arabic_indic_digits!==0,
    date_format:student.date_format??'dd/MM/yyyy',paper_size:'A4',currency:'IQD'};
  try {
    // Trigger reserves every payment. Uniqueness/conflict failure rolls back the
    // entire document; the final response SELECT is inside the same D1 batch.
    const results=await db.batch([
      db.prepare(`INSERT INTO fee_receipts(school_id,student_id,receipt_number,total_amount,payment_ids_json,payments_snapshot_json,settings_snapshot_json,
        student_name_snapshot,class_name_snapshot,section_name_snapshot,school_name_snapshot,academic_year_snapshot,verification_token,verification_hash,status,created_by_user_id,
        receipt_schema_version,student_number_snapshot,currency_snapshot,received_by_snapshot,financial_summary_snapshot_json,installment_plan_snapshot_json,replaces_receipt_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,2,?,'IQD',?,?,?,?)`).bind(schoolId,studentId,number,total,JSON.stringify(ids),JSON.stringify(snapshot),JSON.stringify(settings),
          student.full_name,student.class_name??null,student.section_name??null,student.school_name,payments[0].academic_year_name??null,token,await sha256(token),userId,
          student.student_number,student.received_by_name,JSON.stringify(financialSummary),JSON.stringify(installmentPlans),replacesReceiptId),
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
  route('GET','student-finance/:id',async c=>{
    const schoolId=await school(c,financeQueryId(c.req.query('school_id'))),studentId=financeQueryId(c.req.param('id'))!,db=c.env.DB;
    const student=await db.prepare('SELECT id FROM students WHERE id=? AND school_id=?').bind(studentId,schoolId).first<Row>();requiredRow(student);
    return c.json({data:await loadStudentFinance(db,schoolId,studentId)});
  });
  route('GET','student-fees/:id/installment-plan',async c=>{
    const schoolId=await school(c,financeQueryId(c.req.query('school_id'))),id=financeQueryId(c.req.param('id'))!,db=c.env.DB;
    const fee=await db.prepare('SELECT id,student_id,net_fee,paid_amount,currency,finance_revision FROM student_fees WHERE id=? AND school_id=?').bind(id,schoolId).first<Row>();requiredRow(fee);
    const plans=await loadActiveInstallmentPlans(db,schoolId,[id],new Map([[id,Number(fee.paid_amount)]]));
    return c.json({data:{fee,plan:plans[0]??null,business_date:businessDate()}});
  });
  route('PUT','student-fees/:id/installment-plan',async c=>{
    const raw=await body(c),schoolId=await school(c,raw?.school_id),id=financeQueryId(c.req.param('id'))!,db=c.env.DB,user=c.get('user');
    const fee=await db.prepare(`SELECT f.id,f.student_id,f.net_fee,f.paid_amount,f.currency,f.finance_revision,
      (SELECT healthy FROM finance_fee_readiness WHERE id=f.id) fee_ready,
      (SELECT healthy FROM finance_treasury_readiness WHERE school_id=f.school_id) treasury_ready
      FROM student_fees f WHERE f.id=? AND f.school_id=?`).bind(id,schoolId).first<Row>();requiredRow(fee);
    requireFinance(fee.currency==='IQD' && fee.fee_ready===1 && fee.treasury_ready===1,'finance_reconciliation_required',409);
    const input=parseInstallmentPlan(raw,Number(fee.net_fee));
    requireFinance(input.expected_fee_revision===fee.finance_revision,'finance_operation_stale',409);
    const current=await db.prepare("SELECT id FROM fee_installment_plans WHERE school_id=? AND student_fee_id=? AND status='active'").bind(schoolId,id).first<Row>();
    const key=crypto.randomUUID();
    const statements:D1PreparedStatement[]=[
      db.prepare(`INSERT INTO fee_installment_plans(plan_key,school_id,student_fee_id,fee_revision_snapshot,status,notes,replaces_plan_id,created_by_user_id)
        VALUES(?,?,?,?,'draft',?,?,?)`).bind(key,schoolId,id,fee.finance_revision,input.notes,current?.id??null,user.id),
      ...input.items.map(item=>db.prepare(`INSERT INTO fee_installment_items(plan_id,school_id,sequence_no,label,amount,percentage_basis_points,due_date)
        SELECT id,?,?,?,?,?,? FROM fee_installment_plans WHERE plan_key=? AND school_id=?`).bind(schoolId,item.sequence,item.label,item.amount,item.percentage_basis_points,item.due_date,key,schoolId)),
    ];
    if(current) statements.push(db.prepare("UPDATE fee_installment_plans SET status='superseded',deactivated_at=unixepoch(),deactivated_by_user_id=?,updated_at=unixepoch() WHERE id=? AND school_id=? AND status='active'").bind(user.id,current.id,schoolId));
    statements.push(db.prepare("UPDATE fee_installment_plans SET status='active',updated_at=unixepoch() WHERE plan_key=? AND school_id=? AND status='draft'").bind(key,schoolId));
    await db.batch(statements);
    const plans=await loadActiveInstallmentPlans(db,schoolId,[id],new Map([[id,Number(fee.paid_amount)]]));
    requireFinance(plans[0],'finance_operation_stale',409);
    return c.json({data:{fee,plan:plans[0],business_date:businessDate()}});
  });
  route('DELETE','student-fees/:id/installment-plan',async c=>{
    const raw=financeObject(await body(c),['school_id','expected_plan_id']),schoolId=await school(c,raw.school_id),id=financeQueryId(c.req.param('id'))!,planId=financeId(raw.expected_plan_id),db=c.env.DB;
    const row=await db.prepare("UPDATE fee_installment_plans SET status='cancelled',deactivated_at=unixepoch(),deactivated_by_user_id=?,updated_at=unixepoch() WHERE id=? AND school_id=? AND student_fee_id=? AND status='active' RETURNING id,status")
      .bind(c.get('user').id,planId,schoolId,id).first<Row>();
    requireFinance(row,'finance_operation_stale',409);
    return c.json({data:row});
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
    return c.json({data:receiptPayload(row)});
  });
  route('POST','fee-receipts/generate',async c=>{
    const input=parseReceipt(await body(c)),schoolId=await school(c,input.school_id);
    const receipt=await createFinanceReceipt(c.env.DB,schoolId,input.student_id,input.payment_ids,c.get('user').id,input.replaces_receipt_id);
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

  const parentRoute=(path:string,handler:(c:C)=>Promise<Response>)=>app.get('/api/'+path,async c=>{
    try {
      const user=c.get('user');
      requireFinance(user?.role_key==='parent' && user.school_id!=null,'finance_forbidden',403);
      return await handler(c);
    } catch(error) {
      const safe=financeDatabaseError(error);
      if(safe.status===500) console.error('[parent-finance] operation failed',{code:safe.code});
      return c.json({error:safe.message,code:safe.code},safe.status);
    }
  });
  parentRoute('parent/students/:id/finance',async c=>{
    const user=c.get('user'),studentId=financeQueryId(c.req.param('id'))!,db=c.env.DB;
    const access=await db.prepare(`SELECT s.id,s.school_id FROM students s
      JOIN parent_student_links l ON l.student_id=s.id AND l.school_id=s.school_id
      WHERE s.id=? AND s.school_id=? AND s.status='active'
        AND l.parent_user_id=? AND l.status='active'`).bind(studentId,user.school_id,user.id).first<Row>();
    requiredRow(access);
    return c.json({data:await loadStudentFinance(db,access.school_id,studentId,user.id)});
  });
  parentRoute('parent/fee-receipts/:id',async c=>{
    const user=c.get('user'),id=financeQueryId(c.req.param('id'))!,db=c.env.DB;
    const row=await db.prepare(`SELECT r.* FROM fee_receipts r
      JOIN students s ON s.id=r.student_id AND s.school_id=r.school_id AND s.status='active'
      JOIN parent_student_links l ON l.student_id=r.student_id AND l.school_id=r.school_id
      WHERE r.id=? AND r.school_id=? AND l.parent_user_id=? AND l.status='active'`).bind(id,user.school_id,user.id).first<Row>();
    requiredRow(row);
    return c.json({data:receiptPayload(row,true)});
  });
}
