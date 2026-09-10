import { useEffect, useState } from 'react';
import { Link2, Loader2, Trash2, UserRound, UsersRound } from 'lucide-react';
import {
  getAccessLinks,
  linkParentStudent,
  linkTeacherEmployee,
  unlinkParentStudent,
  unlinkTeacherEmployee,
} from '../../lib/api';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';

interface Props {
  schoolId: number;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

interface NamedOption {
  id: number;
  full_name: string;
  email?: string;
  student_number?: string;
  employee_number?: string;
}

interface ParentLink {
  id: number;
  parent_name: string;
  student_name: string;
  student_number: string;
  relationship?: string | null;
}

interface TeacherLink {
  id: number;
  user_name: string;
  employee_name: string;
  employee_number: string;
}

interface AccessLinkData {
  parent_links: ParentLink[];
  teacher_links: TeacherLink[];
  parents: NamedOption[];
  students: NamedOption[];
  teacher_users: NamedOption[];
  teacher_employees: NamedOption[];
}

const EMPTY_DATA: AccessLinkData = {
  parent_links: [],
  teacher_links: [],
  parents: [],
  students: [],
  teacher_users: [],
  teacher_employees: [],
};

export default function AccessLinksTab({ schoolId, onSuccess, onError }: Props) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [data, setData] = useState<AccessLinkData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parentUserId, setParentUserId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [relationship, setRelationship] = useState('');
  const [teacherUserId, setTeacherUserId] = useState('');
  const [employeeId, setEmployeeId] = useState('');

  useEffect(() => {
    setData(EMPTY_DATA);
    setParentUserId('');
    setStudentId('');
    setRelationship('');
    setTeacherUserId('');
    setEmployeeId('');
    void load();
  }, [schoolId]);

  async function load() {
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const response = await getAccessLinks(schoolId);
    if (!isCurrent()) return;
    setLoading(false);
    if (response.error) {
      onError(response.error);
      return;
    }
    setData({ ...EMPTY_DATA, ...(response.data || {}) } as AccessLinkData);
  }

  async function addParentLink(event: React.FormEvent) {
    event.preventDefault();
    if (!parentUserId || !studentId) {
      onError('اختر حساب ولي الأمر والطالب أولاً');
      return;
    }
    const isCurrent = captureSchoolRequest();
    setSaving(true);
    const response = await linkParentStudent({
      school_id: schoolId,
      parent_user_id: Number(parentUserId),
      student_id: Number(studentId),
      relationship: relationship.trim() || undefined,
    });
    if (!isCurrent()) return;
    setSaving(false);
    if (response.error) return onError(response.error);
    setStudentId('');
    setRelationship('');
    onSuccess('تم ربط ولي الأمر بالطالب');
    await load();
  }

  async function addTeacherLink(event: React.FormEvent) {
    event.preventDefault();
    if (!teacherUserId || !employeeId) {
      onError('اختر حساب المدرس وسجل الموظف أولاً');
      return;
    }
    const isCurrent = captureSchoolRequest();
    setSaving(true);
    const response = await linkTeacherEmployee({
      school_id: schoolId,
      teacher_user_id: Number(teacherUserId),
      employee_id: Number(employeeId),
    });
    if (!isCurrent()) return;
    setSaving(false);
    if (response.error) return onError(response.error);
    setEmployeeId('');
    onSuccess('تم ربط حساب المدرس بسجل الموظف');
    await load();
  }

  async function removeParentLink(link: ParentLink) {
    if (!window.confirm(`إلغاء وصول ${link.parent_name} إلى ملف ${link.student_name}؟`)) return;
    const isCurrent = captureSchoolRequest();
    setSaving(true);
    const response = await unlinkParentStudent(link.id, schoolId);
    if (!isCurrent()) return;
    setSaving(false);
    if (response.error) return onError(response.error);
    onSuccess('تم إلغاء ربط ولي الأمر');
    await load();
  }

  async function removeTeacherLink(link: TeacherLink) {
    if (!window.confirm(`إلغاء ربط حساب ${link.user_name} بسجل ${link.employee_name}؟`)) return;
    const isCurrent = captureSchoolRequest();
    setSaving(true);
    const response = await unlinkTeacherEmployee(link.id, schoolId);
    if (!isCurrent()) return;
    setSaving(false);
    if (response.error) return onError(response.error);
    onSuccess('تم إلغاء ربط حساب المدرس');
    await load();
  }

  if (loading) {
    return <div className="flex items-center justify-center gap-3 py-14 text-sm text-gray-500"><Loader2 className="animate-spin text-primary-600" size={22} />جاري تحميل روابط الوصول...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900"><Link2 size={20} className="text-primary-600" />ربط الحسابات بالبيانات</h2>
        <p className="mt-1 text-sm text-gray-500">هذه الروابط تحدد الأبناء الذين يراهم ولي الأمر، وتربط حساب المدرس بسجل الموظف ونصابه الدراسي.</p>
      </div>

      <section className="rounded-xl border border-gray-200 p-5">
        <h3 className="mb-4 flex items-center gap-2 font-bold text-gray-900"><UsersRound size={19} className="text-blue-600" />ولي الأمر والطالب</h3>
        <form onSubmit={addParentLink} className="grid gap-3 md:grid-cols-[1fr_1fr_0.8fr_auto] md:items-end">
          <label className="text-sm font-medium text-gray-700">حساب ولي الأمر
            <select value={parentUserId} onChange={event => setParentUserId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" disabled={saving}>
              <option value="">اختر الحساب</option>
              {data.parents.map(parent => <option key={parent.id} value={parent.id}>{parent.full_name} — {parent.email}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">الطالب
            <select value={studentId} onChange={event => setStudentId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" disabled={saving}>
              <option value="">اختر الطالب</option>
              {data.students.map(student => <option key={student.id} value={student.id}>{student.full_name} — {student.student_number}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">صلة القرابة
            <input value={relationship} onChange={event => setRelationship(event.target.value)} maxLength={100} placeholder="أب، أم، وصي..." className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" disabled={saving} />
          </label>
          <button type="submit" disabled={saving || !parentUserId || !studentId} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">إضافة الربط</button>
        </form>

        <div className="mt-5 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {data.parent_links.length === 0 ? <p className="p-5 text-center text-sm text-gray-500">لا توجد روابط أولياء أمور بعد</p> : data.parent_links.map(link => (
            <div key={link.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1"><span className="font-semibold text-gray-900">{link.parent_name}</span><span className="mx-2 text-gray-400">←</span><span>{link.student_name}</span><span className="mr-2 text-xs text-gray-400">{link.student_number}</span>{link.relationship && <span className="mr-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{link.relationship}</span>}</div>
              <button type="button" onClick={() => void removeParentLink(link)} disabled={saving} className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50" aria-label={`إلغاء ربط ${link.parent_name} و${link.student_name}`}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 p-5">
        <h3 className="mb-4 flex items-center gap-2 font-bold text-gray-900"><UserRound size={19} className="text-emerald-600" />حساب المدرس وسجل الموظف</h3>
        <form onSubmit={addTeacherLink} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-sm font-medium text-gray-700">حساب المدرس
            <select value={teacherUserId} onChange={event => setTeacherUserId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" disabled={saving}>
              <option value="">اختر الحساب</option>
              {data.teacher_users.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.full_name} — {teacher.email}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">سجل الموظف
            <select value={employeeId} onChange={event => setEmployeeId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" disabled={saving}>
              <option value="">اختر السجل</option>
              {data.teacher_employees.map(employee => <option key={employee.id} value={employee.id}>{employee.full_name} — {employee.employee_number}</option>)}
            </select>
          </label>
          <button type="submit" disabled={saving || !teacherUserId || !employeeId} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">إضافة الربط</button>
        </form>

        <div className="mt-5 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {data.teacher_links.length === 0 ? <p className="p-5 text-center text-sm text-gray-500">لا توجد روابط مدرسين بعد</p> : data.teacher_links.map(link => (
            <div key={link.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1"><span className="font-semibold text-gray-900">{link.user_name}</span><span className="mx-2 text-gray-400">←</span><span>{link.employee_name}</span><span className="mr-2 text-xs text-gray-400">{link.employee_number}</span></div>
              <button type="button" onClick={() => void removeTeacherLink(link)} disabled={saving} className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50" aria-label={`إلغاء ربط ${link.user_name} و${link.employee_name}`}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
