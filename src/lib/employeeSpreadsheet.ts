import { EmployeeRecordError, employeeDate, validateEmployeeQualifications } from './employeeRecords.ts';
import type { EmployeeQualificationInput } from '../types/employees';

const qualificationColumns = [
  ['degree', 'الشهادة'], ['general_specialization', 'الاختصاص العام'],
  ['specific_specialization', 'الاختصاص الدقيق'], ['institution', 'الجامعة أو المعهد'],
  ['college', 'الكلية أو القسم'], ['graduation_date', 'تاريخ التخرج'], ['is_primary', 'المؤهل الأساسي'],
] as const;

export function employeeSpreadsheetDate(value: unknown, date1904 = false): string | null {
  if (value == null || value === '' || (typeof value === 'string' && !value.trim())) return null;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (typeof normalized === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) return employeeDate(normalized);
  const serial = typeof normalized === 'number' ? normalized
    : typeof normalized === 'string' && /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
  const day = Math.floor(serial);
  if (!Number.isFinite(serial) || serial < (date1904 ? 0 : 1) || day > 110000 || (!date1904 && day === 60)) {
    throw new EmployeeRecordError('تاريخ Excel غير صالح؛ استخدم تاريخاً صحيحاً أو YYYY-MM-DD');
  }
  // Excel's 1900 calendar includes a fictitious 29 February; day 60 is rejected above.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  return employeeDate(new Date(epoch + (day - (!date1904 && day > 60 ? 1 : 0)) * 86400000).toISOString().slice(0, 10));
}

export function employeeSpreadsheetMappedDates(row: Record<string, unknown>, mapping: Record<string, string>, date1904 = false): Record<string, unknown> {
  const result = { ...row };
  for (const [field, column] of Object.entries(mapping)) {
    if (column && /^(hire_date|commencement_date|qualification_\d+_graduation_date)$/.test(field)) {
      result[column] = employeeSpreadsheetDate(row[column], date1904);
    }
  }
  return result;
}

export interface EmployeeSpreadsheetIdentity {
  id: number;
  full_name: string;
  employee_number?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string;
}

export function employeeSpreadsheetMatch(employees: readonly EmployeeSpreadsheetIdentity[], input: Omit<EmployeeSpreadsheetIdentity, 'id' | 'status'>): EmployeeSpreadsheetIdentity | null {
  const strongMatches: EmployeeSpreadsheetIdentity[] = [];
  for (const field of ['employee_number', 'email', 'phone'] as const) {
    if (!input[field]) continue;
    const matches = employees.filter(employee => employee[field] === input[field]);
    if (matches.length > 1) throw new EmployeeRecordError('تعذر مطابقة الموظف: الرقم الوظيفي أو البريد أو الهاتف مكرر؛ صحح البيانات أولاً');
    if (matches[0]) strongMatches.push(matches[0]);
  }
  if (new Set(strongMatches.map(employee => employee.id)).size > 1) {
    throw new EmployeeRecordError('معرّفات الموظف متعارضة: الرقم الوظيفي أو البريد أو الهاتف يخص موظفاً آخر');
  }
  let match = strongMatches[0] || null;
  if (!match) {
    const names = employees.filter(employee => employee.full_name === input.full_name);
    if (names.length > 1) throw new EmployeeRecordError('الاسم يطابق أكثر من موظف؛ حدد الرقم الوظيفي الصحيح');
    match = names[0] || null;
  }
  if (match && input.employee_number && match.employee_number && match.employee_number !== input.employee_number) {
    throw new EmployeeRecordError('الرقم الوظيفي لا يطابق الموظف الموجود؛ صحح الرقم قبل الاستيراد');
  }
  if (match?.status === 'archived') throw new EmployeeRecordError('الموظف المطابق مؤرشف؛ لا يمكن تكراره أو إعادة تفعيله من الاستيراد');
  return match;
}

export function employeeSpreadsheetRole(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  const labels: Record<string,string> = {'مدرس':'teacher','موظف':'staff','مدير':'principal','معاون':'vice_principal','محاسب':'accountant','مسجل':'registrar','إداري':'administrator','عامل':'worker','سائق':'driver','أخرى':'other'};
  const normalized=String(value).trim();
  return labels[normalized] || normalized;
}

export const EMPLOYEE_QUALIFICATION_COLUMNS = Array.from({length: 12}, (_, i) =>
  qualificationColumns.map(([field, label]) => ({ key: `qualification_${i + 1}_${field}`, label: `${label} ${i + 1}` })),
).flat();

export function employeeSpreadsheetQualifications(row: Record<string, unknown>, normalizeDate: (value: unknown) => string | null): EmployeeQualificationInput[] | undefined {
  if ('qualifications' in row) {
    const qualifications = Array.isArray(row.qualifications) ? row.qualifications.map(qualification =>
      qualification && typeof qualification === 'object' && !Array.isArray(qualification)
        ? { ...qualification, graduation_date: normalizeDate(qualification.graduation_date) } : qualification,
    ) : row.qualifications;
    return validateEmployeeQualifications(qualifications);
  }
  const result: EmployeeQualificationInput[] = [];
  for (let i = 1; i <= 12; i++) {
    const values = Object.fromEntries(qualificationColumns.map(([field, label]) => [field, row[`qualification_${i}_${field}`] ?? row[`${label} ${i}`]]));
    if (!Object.values(values).some(value => value !== undefined && value !== null && String(value).trim() !== '')) continue;
    const primaryValue = String(values.is_primary ?? '').trim().toLowerCase();
    if (!['', '1', '0', 'true', 'false', 'yes', 'no', 'نعم', 'لا'].includes(primaryValue)) throw new EmployeeRecordError('حدد المؤهل الأساسي بنعم أو لا');
    const graduationDate = values.graduation_date == null || values.graduation_date === '' ? null : normalizeDate(values.graduation_date);
    if (values.graduation_date && !graduationDate) throw new EmployeeRecordError(`تاريخ تخرج المؤهل ${i} غير صالح`);
    result.push({
      degree: String(values.degree ?? '').trim(),
      general_specialization: values.general_specialization == null ? null : String(values.general_specialization),
      specific_specialization: values.specific_specialization == null ? null : String(values.specific_specialization),
      institution: values.institution == null ? null : String(values.institution),
      college: values.college == null ? null : String(values.college),
      graduation_date: graduationDate,
      is_primary: ['1', 'true', 'yes', 'نعم'].includes(primaryValue),
    });
  }
  if (!result.length) return undefined;
  if (result.length === 1 && !result[0].is_primary) result[0].is_primary = true;
  return validateEmployeeQualifications(result);
}

export function employeeQualificationCells(qualifications: readonly EmployeeQualificationInput[]): Record<string, string> {
  const cells: Record<string, string> = {};
  qualifications.forEach((qualification, i) => {
    for (const [field] of qualificationColumns) {
      cells[`qualification_${i + 1}_${field}`] = field === 'is_primary'
        ? (qualification.is_primary ? 'نعم' : 'لا') : String(qualification[field] ?? '');
    }
  });
  return cells;
}
