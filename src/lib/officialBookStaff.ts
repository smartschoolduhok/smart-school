export const OFFICIAL_BOOK_STAFF_ROW_LIMIT = 100;
export const OFFICIAL_BOOK_STAFF_NAME_MAX_LENGTH = 300;
export const OFFICIAL_BOOK_STAFF_JOB_TITLE_MAX_LENGTH = 150;

export type OfficialBookStaffRosterMode = 'letter_with_attachment' | 'attachment_only';

export interface OfficialBookStaffRow {
  employee_id: number | null;
  name: string;
  job_title: string;
}

export interface OfficialBookStaffRoster {
  mode: OfficialBookStaffRosterMode;
  rows: OfficialBookStaffRow[];
}

export interface OfficialBookStaffEmployee {
  id: number;
  full_name: string;
  role?: string | null;
  job_title?: string | null;
  status?: string | null;
}

const SINGLE_LINE_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export function parseOfficialBookStaffRoster(
  raw: unknown,
): { value: OfficialBookStaffRoster | null; error: string | null } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: null, error: 'أضف قائمة الكادر لهذا الكتاب' };
  }
  const source = raw as Record<string, unknown>;
  if (source.mode !== 'letter_with_attachment' && source.mode !== 'attachment_only') {
    return { value: null, error: 'اختر كتابًا مع المرفق أو قائمة الكادر وحدها' };
  }
  if (!Array.isArray(source.rows) || source.rows.length < 1 || source.rows.length > OFFICIAL_BOOK_STAFF_ROW_LIMIT) {
    return { value: null, error: `قائمة الكادر يجب أن تضم من اسم واحد إلى ${OFFICIAL_BOOK_STAFF_ROW_LIMIT} اسمًا` };
  }

  const rows: OfficialBookStaffRow[] = [];
  for (const [index, rawRow] of source.rows.entries()) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      return { value: null, error: `بيانات الكادر في السطر ${index + 1} غير صالحة` };
    }
    const row = rawRow as Record<string, unknown>;
    const employeeId = row.employee_id ?? null;
    if (employeeId !== null && (typeof employeeId !== 'number' || !Number.isSafeInteger(employeeId) || employeeId <= 0)) {
      return { value: null, error: `معرف الموظف في السطر ${index + 1} غير صالح` };
    }
    if (typeof row.name !== 'string' || !row.name.trim()) {
      return { value: null, error: `أدخل اسم الكادر في السطر ${index + 1}` };
    }
    if (row.name.trim().length > OFFICIAL_BOOK_STAFF_NAME_MAX_LENGTH || SINGLE_LINE_CONTROLS.test(row.name)) {
      return { value: null, error: `اسم الكادر في السطر ${index + 1} يجب أن يكون بسطر واحد وألا يتجاوز ${OFFICIAL_BOOK_STAFF_NAME_MAX_LENGTH} حرفًا` };
    }
    if (typeof row.job_title !== 'string' || !row.job_title.trim()) {
      return { value: null, error: `أدخل العنوان الوظيفي في السطر ${index + 1}` };
    }
    if (row.job_title.trim().length > OFFICIAL_BOOK_STAFF_JOB_TITLE_MAX_LENGTH || SINGLE_LINE_CONTROLS.test(row.job_title)) {
      return { value: null, error: `العنوان الوظيفي في السطر ${index + 1} يجب أن يكون بسطر واحد وألا يتجاوز ${OFFICIAL_BOOK_STAFF_JOB_TITLE_MAX_LENGTH} حرفًا` };
    }
    rows.push({ employee_id: employeeId, name: row.name.trim(), job_title: row.job_title.trim() });
  }
  return { value: { mode: source.mode, rows }, error: null };
}

export function normalizeOfficialBookStaffRoster(raw: unknown): OfficialBookStaffRoster | null {
  return parseOfficialBookStaffRoster(raw).value;
}

export function defaultOfficialBookStaffRoster(
  employees: readonly OfficialBookStaffEmployee[],
): OfficialBookStaffRow[] {
  const collator = new Intl.Collator('ar');
  const isDeputy = (employee: OfficialBookStaffEmployee) =>
    employee.role === 'vice_principal' || /معاون/.test(employee.job_title || '');
  return employees
    .filter((employee) => (!employee.status || employee.status === 'active') && employee.full_name.trim())
    .slice()
    .sort((left, right) => Number(isDeputy(right)) - Number(isDeputy(left)) || collator.compare(left.full_name, right.full_name))
    .map((employee) => ({
      employee_id: employee.id,
      name: employee.full_name.trim(),
      job_title: isDeputy(employee)
        ? employee.job_title?.trim() || 'معاون'
        : employee.role === 'teacher' ? 'مدرس' : employee.job_title?.trim() || 'مدرس',
    }));
}
