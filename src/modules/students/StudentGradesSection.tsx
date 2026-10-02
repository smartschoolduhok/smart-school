import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen } from 'lucide-react';
import { getStudentGrades } from '../../lib/api';
import { gradeInputColumns } from '../../lib/gradeScheme';
import { displayGradeStatus } from '../../lib/gradePresentation';
import { toArabicDigits } from '../../lib/arabicDigits';

function gradeValue(value: unknown): string {
  return value == null || value === '' ? '—' : toArabicDigits(String(value));
}

export default function StudentGradesSection({ studentId, refreshKey = 0 }: { studentId: number; refreshKey?: number }) {
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    setLoading(true);
    void getStudentGrades(studentId).then((response) => {
      if (!active) return;
      if (response.error) setError(response.error);
      else setData(response.data || null);
      setLoading(false);
    });
    return () => { active = false; };
  }, [studentId, refreshKey]);

  const columns = useMemo(() => gradeInputColumns(data?.settings), [data?.settings]);
  const grades = Array.isArray(data?.grades) ? data.grades : [];

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-white" aria-label="درجات الطالب">
      <div className="flex items-center gap-3 border-b border-blue-100 bg-blue-50 px-6 py-4">
        <BookOpen size={22} className="text-blue-700" />
        <div>
          <h2 className="text-lg font-bold text-gray-900">درجات الطالب</h2>
          <p className="text-xs text-gray-600">الدرجات النشطة المسجلة في المدرسة، للعرض فقط</p>
        </div>
      </div>
      {loading ? <p className="p-6 text-center text-sm text-gray-500">جاري تحميل الدرجات...</p>
        : error ? <p role="alert" className="flex items-center gap-2 p-5 text-sm text-red-700"><AlertTriangle size={18} />{error}</p>
          : data?.grades_visible === false ? <p role="status" className="p-6 text-sm text-amber-800">درجات الطالب مخفية لهذه السنة الدراسية. يبقى الطالب في قوائم الطلاب والطباعة، وتُحفظ درجاته السابقة دون حذف.</p>
          : grades.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">لا توجد درجات نشطة مسجلة لهذا الطالب.</p>
            : <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-gray-50 text-gray-600"><tr>
                  <th className="sticky right-0 bg-gray-50 p-3 text-right">المادة</th>
                  {columns.map(column => <th key={column.key} className="whitespace-nowrap p-3 text-center">{column.label}</th>)}
                  <th className="p-3 text-center">السعي السنوي</th>
                  <th className="p-3 text-center">الدرجة النهائية</th>
                  <th className="p-3 text-center">الدرجة المعتمدة</th>
                  <th className="p-3 text-center">الحالة</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {grades.map((grade: Record<string, any>) => <tr key={grade.id}>
                    <th scope="row" className="sticky right-0 bg-white p-3 text-right font-semibold text-gray-900">{grade.subject_name || '—'}</th>
                    {columns.map(column => <td key={column.key} className="p-3 text-center">{gradeValue(grade[column.key])}</td>)}
                    <td className="p-3 text-center">{gradeValue(grade.annual_effort)}</td>
                    <td className="p-3 text-center">{gradeValue(grade.final_grade)}</td>
                    <td className="p-3 text-center font-semibold">{gradeValue(grade.effective_grade)}</td>
                    <td className="p-3 text-center">{displayGradeStatus(grade.result_status, grade.exemption_status) || '—'}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
    </section>
  );
}
