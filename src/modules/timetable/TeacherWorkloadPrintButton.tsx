import { Printer } from 'lucide-react';

export function TeacherWorkloadPrintButton({ schoolId, academicYearId, enabled }: {
  schoolId: number;
  academicYearId: number | null;
  enabled: boolean;
}) {
  const className = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50';
  const label = <><Printer size={18} />كتاب أنصبة المدرّسين</>;
  if (!enabled || academicYearId == null) return <button type="button" className={className} disabled>{label}</button>;
  const query = new URLSearchParams({ school_id: String(schoolId), academic_year_id: String(academicYearId) });
  return <a className={className} href={`/print/teacher-workloads?${query}`} target="_blank" rel="noopener noreferrer">{label}</a>;
}
