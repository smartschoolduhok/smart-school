import { businessDate } from '../../lib/businessTime';
import { toArabicDigits } from '../../lib/arabicDigits';
import type { EmployeeSalary, StaffDocumentMetadata } from '../../types/employees';

export const EMPLOYEE_ROLE_LABELS: Record<string, string> = { teacher: 'مدرس', staff: 'موظف', manager: 'مدير قسم', supervisor: 'مشرف', principal: 'مدير', vice_principal: 'معاون المدير', accountant: 'محاسب', registrar: 'مسجل', administrator: 'إداري', worker: 'عامل', driver: 'سائق', other: 'أخرى' };
export const EMPLOYEE_STATUS_LABELS: Record<string, string> = { active: 'نشط', archived: 'مؤرشف', inactive: 'غير نشط', all: 'جميع الحالات، بما فيها المؤرشفة' };
export const SALARY_STATUS_LABELS: Record<string, string> = { unpaid: 'المستحق غير المدفوع', paid: 'الرواتب المدفوعة', cancelled: 'الرواتب الملغاة', all: 'جميع حالات الرواتب' };
export const SALARY_ROW_LABELS: Record<string, string> = { unpaid: 'غير مدفوع', paid: 'مدفوع', cancelled: 'ملغى' };
export type DocumentSettings = StaffDocumentMetadata['document_settings'];
export const staffDigits = (value: string | number, settings: DocumentSettings) => settings.use_arabic_indic_digits ? toArabicDigits(value) : String(value);
export function staffDate(value: string | number | null | undefined, settings: DocumentSettings, fallback = 'غير مسجل') {
  if (value == null || value === '') return fallback;
  const date = typeof value === 'number' ? businessDate(new Date(value * 1000)) : value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fallback;
  const [yyyy, MM, dd] = date.split('-');
  return staffDigits((settings.date_format || 'dd/MM/yyyy').replace('yyyy', yyyy).replace('MM', MM).replace('dd', dd), settings);
}
export const staffMoney = (value: number, settings: DocumentSettings) => staffDigits(value.toLocaleString('en-US'), settings);
export function receiptTotals(rows: readonly EmployeeSalary[]) {
  return rows.filter(row => row.status !== 'cancelled').reduce((sum, row) => ({
    base_salary: sum.base_salary + row.base_salary, bonus_amount: sum.bonus_amount + row.bonus_amount,
    deduction_amount: sum.deduction_amount + row.deduction_amount, net_salary: sum.net_salary + row.net_salary,
    payable_count: sum.payable_count + 1,
  }), {base_salary: 0, bonus_amount: 0, deduction_amount: 0, net_salary: 0, payable_count: 0});
}
export function documentPages<T>(rows: readonly T[], pageSize: number): T[][] {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('Invalid page size');
  return Array.from({length: Math.max(1, Math.ceil(rows.length / pageSize))}, (_, i) => rows.slice(i * pageSize, (i + 1) * pageSize));
}
export const positiveDocumentId = (value: string | null) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
