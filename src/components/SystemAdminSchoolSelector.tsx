import { Building2 } from 'lucide-react';
import type { TenantSchoolScope } from '../hooks/useTenantSchool';

type SystemAdminSchoolSelectorProps = Pick<
  TenantSchoolScope,
  'isSystemAdmin' | 'schoolId' | 'schools' | 'schoolsLoading' | 'schoolsError' | 'selectSchool'
>;

export function SystemAdminSchoolSelector({
  isSystemAdmin,
  schoolId,
  schools,
  schoolsLoading,
  schoolsError,
  selectSchool,
}: SystemAdminSchoolSelectorProps) {
  if (!isSystemAdmin) return null;

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <label htmlFor="system-admin-target-school" className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-900">
        <Building2 size={18} />
        المدرسة المستهدفة
      </label>
      <select
        id="system-admin-target-school"
        value={schoolId ?? ''}
        onChange={(event) => selectSchool(event.target.value ? Number(event.target.value) : null)}
        disabled={schoolsLoading}
        className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:bg-gray-100"
      >
        <option value="">{schoolsLoading ? 'جاري تحميل المدارس...' : 'اختر مدرسة نشطة'}</option>
        {schools.map((school) => (
          <option key={school.id} value={school.id}>{school.name}</option>
        ))}
      </select>
      {schoolsError ? (
        <p className="mt-2 text-sm text-red-700">{schoolsError}</p>
      ) : !schoolId && !schoolsLoading ? (
        <p className="mt-2 text-sm text-blue-800">يجب اختيار مدرسة قبل عرض البيانات أو تنفيذ أي إجراء.</p>
      ) : null}
    </div>
  );
}
