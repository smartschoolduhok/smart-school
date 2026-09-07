/** Whole-IQD policy shared by the finance API and forms. No currency conversion. */
export const FINANCE_MESSAGES = {
  finance_forbidden: 'لا تملك صلاحية الوصول إلى البيانات المالية لهذه المدرسة.',
  invalid_finance_request: 'بيانات الطلب المالي غير صالحة.',
  finance_target_required: 'اختر مدرسة نشطة صراحةً قبل العملية المالية.',
  finance_not_found: 'السجل غير متاح في المدرسة المحددة.',
  unsupported_finance_currency: 'العمليات المالية تدعم الدينار العراقي فقط. يحتاج السجل القديم إلى مراجعة إدارية دون تحويل تلقائي.',
  invalid_finance_amount: 'أدخل مبلغًا صحيحًا بالدينار العراقي دون كسور.',
  invalid_discount: 'الخصم غير صالح أو يتجاوز مبلغ القسط.',
  fee_net_below_paid: 'لا يمكن أن يصبح صافي القسط أقل من مجموع الدفعات الفعالة.',
  duplicate_student_fee: 'يوجد قسط من النوع نفسه لهذا الطالب والسنة الدراسية.',
  fee_not_payable: 'القسط غير قابل للدفع أو لا يوجد مبلغ مستحق.',
  payment_overpay: 'مبلغ الدفعة يتجاوز المتبقي الحالي من القسط.',
  payment_idempotency_conflict: 'استُخدم معرّف هذه الدفعة لطلب مختلف. راجع الدفعة قبل إنشاء طلب جديد.',
  payment_already_cancelled: 'هذه الدفعة ملغاة بالفعل؛ لم يتم عكس المال مرة أخرى.',
  payment_receipt_active: 'للـدفعة إيصال فعال. ألغِ الإيصال أولًا؛ إلغاء الإيصال وحده لا يعكس المال.',
  payment_treasury_integrity_error: 'ربط الدفعة بالخزنة غير متسق. يلزم التدقيق الإداري قبل أي تعديل.',
  receipt_payment_missing: 'لم تتوفر جميع الدفعات المطلوبة لهذا الطالب والمدرسة.',
  receipt_payment_invalid: 'اختر دفعات فعالة بالدينار العراقي دون تكرار.',
  receipt_payment_already_receipted: 'تتداخل الدفعات المختارة مع إيصال فعال. ألغِ المستند القديم قبل إعادة إصداره.',
  receipt_already_cancelled: 'الإيصال ملغى؛ لا يمكن طباعته أو إلغاؤه مجددًا.',
  finance_operation_stale: 'تغيّرت البيانات المالية. أعد تحميلها قبل المتابعة.',
  finance_reconciliation_required: 'توجد فروقات سابقة بين السجلات المالية والأرصدة المحفوظة. يلزم تدقيق إداري مستقل قبل المتابعة؛ لم يتم تصحيحها أو تعديل المال تلقائيًا.',
  receipt_academic_year_conflict: 'يجب أن تنتمي جميع دفعات الإيصال إلى سنة دراسية واحدة للقسط، دون خلط السنوات أو السنة غير المحددة.',
  finance_failure: 'تعذر إتمام العملية المالية؛ لم يتم اعتماد عملية جزئية.',
} as const;
export type FinanceCode = keyof typeof FINANCE_MESSAGES;
export class FinanceError extends Error {
  code: FinanceCode;
  status: 400 | 403 | 404 | 409 | 500;
  constructor(code: FinanceCode, status: 400 | 403 | 404 | 409 | 500 = 400) { super(FINANCE_MESSAGES[code]); this.code=code; this.status=status; }
}
export function requireFinance(check: unknown, code: FinanceCode = 'invalid_finance_request', status: 400 | 403 | 404 | 409 | 500 = 400): asserts check {
  if (!check) throw new FinanceError(code, status);
}
export function financeObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  requireFinance(value !== null && typeof value === 'object' && !Array.isArray(value));
  const result = value as Record<string, unknown>;
  requireFinance(Object.keys(result).every(key => allowed.includes(key)));
  return result;
}
export function financeId(value: unknown): number {
  requireFinance(typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
  return value;
}
export function financeQueryId(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  requireFinance(/^[1-9]\d*$/.test(value));
  return financeId(Number(value));
}
export function financeText(value: unknown, max = 1000, required = false): string | null {
  if (value == null && !required) return null;
  requireFinance(typeof value === 'string' && value.length <= max);
  const text = value.trim();
  requireFinance(!required || text.length > 0);
  return text || null;
}
export function canonicalFeeType(value: unknown): string {
  return financeText(value, 120, true)!.replace(/\s+/gu, ' ');
}
export function financeMoney(value: unknown, allowZero = false): number {
  requireFinance(typeof value === 'number' && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1), 'invalid_finance_amount');
  return value;
}
export function financeTimestamp(value: unknown): number | null {
  if (value == null) return null;
  requireFinance(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 253402300799);
  return value;
}
export type DiscountType = 'none' | 'fixed' | 'percentage';
export function calculateFee(amount: number, type: unknown = 'none', value: unknown = 0) {
  financeMoney(amount);
  requireFinance(type === 'none' || type === 'fixed' || type === 'percentage', 'invalid_discount');
  requireFinance(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'invalid_discount');
  let discount = 0;
  if (type === 'none') requireFinance(value === 0, 'invalid_discount');
  if (type === 'fixed') { requireFinance(Number.isSafeInteger(value) && value <= amount, 'invalid_discount'); discount = value; }
  if (type === 'percentage') {
    // Percentage precision: at most two decimal places. Integer half-up rounding
    // (including x.5 IQD) uses BigInt, so large safe amounts never lose dinars.
    requireFinance(value <= 100 && /^\d+(?:\.\d{1,2})?$/.test(String(value)), 'invalid_discount');
    const basisPoints = Math.round(value * 100);
    discount = Number((BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n);
  }
  return { discount_type: type, discount_value: value, discount_amount: discount, net_fee: amount - discount };
}
export function feeStatus(net: number, paid: number) { return paid >= net ? 'paid' : paid > 0 ? 'partial' : 'pending'; }
export function feeRemaining(fee: { net_fee?: number | null; amount: number; paid_amount: number }) { return Math.max(0, (fee.net_fee ?? fee.amount) - fee.paid_amount); }
const feeFields = ['school_id','student_id','academic_year_id','fee_type','amount','currency','due_date','notes','discount_type','discount_value'];
export function parseFee(value: unknown, current?: Record<string, unknown>) {
  const body = financeObject(value, current ? feeFields.filter(k => !['student_id','academic_year_id'].includes(k)) : feeFields);
  const full: Record<string, unknown> = { currency:'IQD',discount_type:'none',discount_value:0,academic_year_id:null,due_date:null,notes:null,...current,...body };
  requireFinance(full.currency === 'IQD' && (!current || current.currency === 'IQD'), 'unsupported_finance_currency');
  return { school_id: body.school_id, student_id: financeId(full.student_id), academic_year_id: full.academic_year_id == null ? null : financeId(full.academic_year_id),
    fee_type: canonicalFeeType(full.fee_type), amount: financeMoney(full.amount), currency:'IQD',
    due_date:financeTimestamp(full.due_date),notes:financeText(full.notes),...calculateFee(full.amount as number, full.discount_type,full.discount_value) };
}
export function parsePayment(value: unknown) {
  const body = financeObject(value, ['school_id','student_fee_id','amount','payment_method','payment_date','notes','client_request_id','auto_generate_receipt']);
  requireFinance(typeof body.client_request_id === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(body.client_request_id));
  requireFinance(['cash','bank_transfer','cheque','credit_card','debit_card','mobile_payment','other'].includes(String(body.payment_method)));
  requireFinance(body.auto_generate_receipt === undefined || typeof body.auto_generate_receipt === 'boolean');
  const payment_date = financeTimestamp(body.payment_date); requireFinance(payment_date !== null);
  return {school_id:body.school_id,student_fee_id:financeId(body.student_fee_id),amount:financeMoney(body.amount),payment_method:body.payment_method as string,
    payment_date,notes:financeText(body.notes),client_request_id:body.client_request_id,auto_generate_receipt:body.auto_generate_receipt === true};
}
export function parseReceipt(value: unknown) {
  const body = financeObject(value,['school_id','student_id','payment_ids']);
  requireFinance(Array.isArray(body.payment_ids) && body.payment_ids.length > 0 && body.payment_ids.length <= 100, 'receipt_payment_invalid');
  const ids = body.payment_ids.map(financeId).sort((a,b)=>a-b);
  requireFinance(new Set(ids).size === ids.length,'receipt_payment_invalid');
  return {school_id:body.school_id,student_id:financeId(body.student_id),payment_ids:ids};
}
export function financeDatabaseError(error: unknown): FinanceError {
  if (error instanceof FinanceError) return error;
  const message = error instanceof Error ? error.message : '';
  for (const code of Object.keys(FINANCE_MESSAGES) as FinanceCode[]) {
    if (message.includes(code)) return new FinanceError(code, ['duplicate_student_fee','finance_operation_stale','finance_reconciliation_required','payment_idempotency_conflict','receipt_payment_already_receipted'].includes(code) ? 409 : 400);
  }
  if (message.includes('student_fees.school_id') || message.includes('idx_student_fees_identity')) return new FinanceError('duplicate_student_fee',409);
  if (message.includes('fee_receipt_payments.payment_id')) return new FinanceError('receipt_payment_already_receipted',409);
  return new FinanceError('finance_failure',500);
}
