import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { getStudents } from '../../lib/api';
import ParentFinanceSection from './ParentFinanceSection';

type DirectoryStudent = { id: number; school_id: number; full_name: string; student_number: string; class_name?: string | null; section_name?: string | null };

export default function StudentFinancePage() {
  const scope = useTenantSchool();
  const { schoolId } = scope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const { id } = useParams<{ id: string }>();
  const studentId = id && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null;
  const [student, setStudent] = useState<DirectoryStudent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setStudent(null);
    setError('');
    if (schoolId == null || studentId == null) return;
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    void getStudents(schoolId).then(response => {
      if (!active || !isCurrent()) return;
      if (response.error) setError(response.error);
      else {
        const match = (response.data || []).find((entry: Record<string, any>) => Number(entry.id) === studentId);
        if (match) setStudent(match as DirectoryStudent);
        else setError('الطالب غير موجود في المدرسة المحددة');
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [schoolId, studentId]);

  return <div className="space-y-5" dir="rtl">
    <Link to="/students" className="text-sm font-semibold text-blue-700 hover:underline">العودة إلى الطلاب</Link>
    <SystemAdminSchoolSelector {...scope} />
    {schoolId == null ? <p className="rounded-xl bg-blue-50 p-5 text-blue-900">اختر المدرسة المستهدفة.</p>
      : studentId == null ? <p role="alert" className="rounded-xl bg-red-50 p-5 text-red-700">معرّف الطالب غير صالح.</p>
        : loading ? <p className="rounded-xl bg-white p-5 text-gray-600">جاري تحميل حساب الطالب...</p>
          : error ? <p role="alert" className="rounded-xl bg-red-50 p-5 text-red-700">{error}</p>
            : student && Number(student.school_id) === schoolId && <>
              <header className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="flex items-center gap-3"><Wallet className="text-emerald-700" size={25} /><div><h1 className="text-2xl font-bold text-gray-900">{student.full_name}</h1><p className="text-sm text-gray-600"><bdi dir="ltr">{student.student_number}</bdi> · {student.class_name || '—'} / {student.section_name || '—'}</p></div></div>
              </header>
              <ParentFinanceSection studentId={student.id} schoolId={schoolId} />
            </>}
  </div>;
}
