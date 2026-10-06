/** Supplementary fields for the school's teacher dossier. Core employee data stays in employees. */
export const DOSSIER_PERSONAL_FIELDS = [
  ['mother_name', 'اسم الأم', 200], ['birth_place', 'محل الولادة', 200],
  ['birth_date', 'تاريخ الولادة', 10], ['identity_number', 'رقم البطاقة الوطنية أو الهوية', 80],
  ['identity_issuer', 'جهة الإصدار', 200], ['blood_group', 'فصيلة الدم', 3],
  ['marital_status', 'الحالة الاجتماعية', 40], ['spouse_name', 'اسم الزوج / الزوجة', 200],
  ['spouse_occupation', 'مهنة الزوج / الزوجة', 200], ['academic_title', 'اللقب العلمي', 200],
] as const;
export const DOSSIER_SERVICE_FIELDS = [
  ['appointment_order_number', 'رقم أمر التعيين', 100], ['appointment_order_date', 'تاريخ أمر التعيين', 10],
  ['commencement_order_number', 'رقم أمر أول مباشرة', 100], ['commencement_order_date', 'تاريخ أمر أول مباشرة', 10],
  ['school_join_date', 'تاريخ الالتحاق بالمدرسة', 10],
  ['transfer_order_number', 'رقم أمر النقل', 100], ['transfer_order_date', 'تاريخ أمر النقل', 10],
  ['release_order_number', 'رقم أمر الانفكاك', 100], ['release_order_date', 'تاريخ أمر الانفكاك', 10],
  ['deputy_order_number', 'رقم أمر التكليف بالمعاونية', 100], ['deputy_order_date', 'تاريخ أمر التكليف بالمعاونية', 10],
  ['principal_order_number', 'رقم أمر التكليف بالإدارة', 100], ['principal_order_date', 'تاريخ أمر التكليف بالإدارة', 10],
] as const;
export const DOSSIER_HISTORY_KINDS = [
  ['courses', 'الدورات'], ['committees', 'اللجان'], ['research', 'البحوث'],
  ['commendations', 'التشكرات'], ['penalties', 'العقوبات'],
] as const;
export const DOSSIER_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const DOSSIER_MARITAL_STATUSES = ['أعزب / عزباء', 'متزوج / متزوجة', 'مطلق / مطلقة', 'أرمل / أرملة'] as const;
export type DossierField = typeof DOSSIER_PERSONAL_FIELDS[number][0] | typeof DOSSIER_SERVICE_FIELDS[number][0];
export type DossierHistoryKind = typeof DOSSIER_HISTORY_KINDS[number][0];
export interface DossierHistoryRow { date: string | null; title: string; reference: string | null; notes: string | null; }
export interface DossierQualification { qualification_key: string; department: string | null; graduation_year: number | null; }
export interface DossierQualificationLink { qualification_id: number; qualification_key: string; has_graduation_date: boolean; }
export type StaffDossierData = Record<DossierField, string | null> & {
  qualifications: DossierQualification[];
  history: Record<DossierHistoryKind, DossierHistoryRow[]>;
  notes: string | null;
};
export interface StaffDossierResponse {
  school_id: number; employee_id: number; version: number; updated_at: number | null;
  school_name: string; logo_url: string | null; qualification_links: DossierQualificationLink[]; data: StaffDossierData;
}
export class StaffDossierError extends Error {
  status: 400 | 403 | 404 | 409 | 413;
  constructor(message: string, status: 400 | 403 | 404 | 409 | 413 = 400) { super(message); this.status = status; }
}
export function emptyStaffDossier(): StaffDossierData {
  const fields: Record<DossierField, string | null> = {
    mother_name: null, birth_place: null, birth_date: null, identity_number: null, identity_issuer: null,
    blood_group: null, marital_status: null, spouse_name: null, spouse_occupation: null, academic_title: null,
    appointment_order_number: null, appointment_order_date: null, commencement_order_number: null, commencement_order_date: null,
    school_join_date: null, transfer_order_number: null, transfer_order_date: null, release_order_number: null,
    release_order_date: null, deputy_order_number: null, deputy_order_date: null, principal_order_number: null, principal_order_date: null,
  };
  return { ...fields,
    qualifications: [], history: { courses: [], committees: [], research: [], commendations: [], penalties: [] }, notes: null,
  };
}
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new StaffDossierError('بيانات السجل تحتوي حقولاً غير صالحة');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false): string | null {
  if (value == null || value === '') { if (required) throw new StaffDossierError('عنوان كل قيد مطلوب'); return null; }
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new StaffDossierError('أحد الحقول النصية غير صالح أو يتجاوز الطول المسموح');
  return value.trim() || null;
}
export function dossierDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 2200) throw new StaffDossierError('أدخل تاريخاً صحيحاً بين 1900 و2200');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new StaffDossierError('أدخل تاريخاً صحيحاً');
  return value;
}
export function dossierId(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new StaffDossierError('معرف المدرسة أو الموظف غير صالح');
  return Number(value);
}
export function validateStaffDossier(value: unknown): StaffDossierData {
  const fields = [...DOSSIER_PERSONAL_FIELDS, ...DOSSIER_SERVICE_FIELDS];
  const raw = object(value, [...fields.map(([key]) => key), 'qualifications', 'history', 'notes']);
  const result = emptyStaffDossier();
  for (const [key, label, max] of fields) {
    try { result[key] = key.endsWith('_date') ? dossierDate(raw[key]) : text(raw[key], max); }
    catch (error) { if (error instanceof StaffDossierError) throw new StaffDossierError(`${label}: ${error.message}`, error.status); throw error; }
  }
  if (result.blood_group && !DOSSIER_BLOOD_GROUPS.some(group => group === result.blood_group)) throw new StaffDossierError('فصيلة الدم غير صالحة');
  if (result.marital_status && !DOSSIER_MARITAL_STATUSES.some(status => status === result.marital_status)) throw new StaffDossierError('الحالة الاجتماعية غير صالحة');
  if (!Array.isArray(raw.qualifications) || raw.qualifications.length > 12) throw new StaffDossierError('عدد المؤهلات الإضافية لا يتجاوز 12');
  const ids = new Set<string>();
  result.qualifications = raw.qualifications.map(value => {
    const q = object(value, ['qualification_key', 'department', 'graduation_year']);
    const id = q.qualification_key;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new StaffDossierError('مرجع المؤهل غير صالح');
    if (ids.has(id)) throw new StaffDossierError('المؤهل مكرر'); ids.add(id);
    const year = q.graduation_year == null || q.graduation_year === '' ? null : q.graduation_year;
    if (year !== null && (typeof year !== 'number' || !Number.isInteger(year) || year < 1900 || year > 2200)) throw new StaffDossierError('سنة التخرج يجب أن تكون سنة صحيحة بين 1900 و2200');
    return { qualification_key: id, department: text(q.department, 250), graduation_year: year };
  });
  const history = object(raw.history, DOSSIER_HISTORY_KINDS.map(([key]) => key));
  for (const [kind, label] of DOSSIER_HISTORY_KINDS) {
    const rows = history[kind];
    if (!Array.isArray(rows) || rows.length > 50) throw new StaffDossierError('كل جدول يقبل 50 قيداً كحد أقصى');
    result.history[kind] = rows.map((value, index) => {
      try {
        const row = object(value, ['date', 'title', 'reference', 'notes']);
        return { date: dossierDate(row.date), title: text(row.title, 300, true)!, reference: text(row.reference, 150), notes: text(row.notes, 1500) };
      } catch (error) { if (error instanceof StaffDossierError) throw new StaffDossierError(`${label}، القيد ${index + 1}: ${error.message}`, error.status); throw error; }
    });
  }
  result.notes = text(raw.notes, 4000);
  return result;
}
export function validateStaffDossierRequest(value: unknown) {
  const raw = object(value, ['school_id', 'version', 'data']);
  if (typeof raw.version !== 'number' || !Number.isSafeInteger(raw.version) || raw.version < 0) throw new StaffDossierError('إصدار السجل غير صالح');
  return { school_id: dossierId(raw.school_id), version: raw.version, data: validateStaffDossier(raw.data) };
}
