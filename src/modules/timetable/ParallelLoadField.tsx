import type { TimetableTeachingLoad } from '../../lib/timetable';

interface ParallelLoadFieldProps {
  loads: TimetableTeachingLoad[];
  schoolId: number;
  academicYearId: number;
  classId: number | null;
  sectionId: number | null;
  currentLoadId: number | null;
  subjectId: number | null;
  employeeId: number | null;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function ParallelLoadField(props: ParallelLoadFieldProps) {
  const scopedLoads = props.loads.filter(load => load.school_id === props.schoolId
    && load.academic_year_id === props.academicYearId && load.class_id === props.classId
    && load.section_id === props.sectionId && load.status === 'active');
  const companion = props.currentLoadId == null ? undefined : scopedLoads.find(load => load.parallel_with_load_id === props.currentLoadId);
  const candidates = scopedLoads.filter(load => load.id !== props.currentLoadId
    && load.subject_id !== props.subjectId && load.parallel_with_load_id == null
    && !scopedLoads.some(other => other.id !== props.currentLoadId && other.parallel_with_load_id === load.id)
    && (props.employeeId == null || load.employee_id == null || load.employee_id !== props.employeeId));
  const selectionMissing = props.value && !candidates.some(load => String(load.id) === props.value);

  return <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 md:col-span-3 xl:col-span-6">
    <label className="block text-sm font-semibold">متزامن مع
      <select aria-label="متزامن مع" value={props.value} disabled={props.disabled || props.classId == null || companion != null}
        onChange={event => props.onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 disabled:bg-gray-100">
        <option value="">درس مستقل</option>
        {selectionMissing && <option value={props.value}>الربط الحالي غير متاح — اختر درسًا آخر أو فك الربط</option>}
        {candidates.map(load => <option key={load.id} value={load.id}>{load.subject_name || `مادة رقم ${load.subject_id}`} — {load.employee_name || 'بدون مدرس'} — {load.weekly_periods} درس أسبوعيًا</option>)}
      </select>
    </label>
    {companion && <p className="text-sm font-semibold text-blue-900">متزامن مع {companion.subject_name || `مادة رقم ${companion.subject_id}`}. لتغيير الربط افتح نصاب هذه المادة.</p>}
    <p className="text-xs text-blue-900">التزامن خاص بالجدول: مادتان للشعبة نفسها في الوقت نفسه، ولكل مادة مدرسها ونصابها المتساوي. يحتسب الوقت مرة واحدة للشعبة، ويظهر الدرسـان ومدرساهما في الجدول والطباعة. تبقى مواد الطلاب والدرجات والبطاقات كما هي.</p>
    <p className="text-xs text-blue-900">يمكن إضافة نصاب مادة جديدة واختيار المادة المحفوظة هنا. استبعاد أي نصاب يخصه وحده، ويُفك الربط عن المادة الأخرى لتبقى فعالة.</p>
  </div>;
}
