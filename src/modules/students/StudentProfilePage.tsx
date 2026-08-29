import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  GraduationCap,
  Hash,
  History,
  MapPin,
  Phone,
  School,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { getStudent, getStudentEnrollments } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import type { EffectiveStudentRecord, StudentEnrollmentHistoryRecord } from '../../lib/studentEnrollments';
import {
  EMPTY_STUDENT_PROFILE_VALUE,
  NO_CURRENT_ENROLLMENT_MESSAGE,
  enrollmentStatusLabel,
  formatStudentProfileDate,
  formatStudentProfileUnixSeconds,
  genderLabel,
  hasActiveYearWithoutEnrollment,
  promotionStatusLabel,
  safeStudentProfileValue,
  studentStatusLabel,
} from '../../lib/studentProfilePresentation';

function InformationItem({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function studentStatusClasses(status: string): string {
  if (status === 'active') return 'bg-green-100 text-green-700';
  if (status === 'archived') return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-700';
}

export default function StudentProfilePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const parsedStudentId = id && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null;
  const requestedStudentIdRef = useRef<number | null>(parsedStudentId);
  requestedStudentIdRef.current = parsedStudentId;

  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);

  const [student, setStudent] = useState<EffectiveStudentRecord | null>(null);
  const [history, setHistory] = useState<StudentEnrollmentHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    setStudent(null);
    setHistory([]);
    setError('');
    setNotFound(false);
    setPhotoFailed(false);

    if (schoolId == null) {
      setLoading(false);
      return;
    }
    if (parsedStudentId == null) {
      setError('معرّف الطالب غير صالح');
      setLoading(false);
      return;
    }

    void loadProfile(parsedStudentId, schoolId);
  }, [parsedStudentId, schoolId]);

  async function loadProfile(requestedStudentId: number, requestedSchoolId: number) {
    const isCurrentRequest = captureSchoolRequest();
    setLoading(true);
    setError('');
    setNotFound(false);

    const [studentResponse, historyResponse] = await Promise.all([
      getStudent(requestedStudentId),
      getStudentEnrollments(requestedStudentId, requestedSchoolId),
    ]);

    if (!isCurrentRequest() || requestedStudentIdRef.current !== requestedStudentId) return;

    if (studentResponse.error || !studentResponse.data) {
      const message = studentResponse.error || 'تعذر تحميل ملف الطالب';
      setNotFound(message.includes('غير موجود'));
      setError(message);
      setLoading(false);
      return;
    }

    if (Number(studentResponse.data.school_id) !== requestedSchoolId) {
      setStudent(null);
      setHistory([]);
      setError('غير مسموح: الطالب لا ينتمي إلى المدرسة المحددة');
      setLoading(false);
      return;
    }

    if (historyResponse.error) {
      setStudent(null);
      setHistory([]);
      setError(historyResponse.error);
      setLoading(false);
      return;
    }

    setStudent(studentResponse.data);
    setHistory(historyResponse.data || []);
    setLoading(false);
  }

  const noCurrentEnrollment = student ? hasActiveYearWithoutEnrollment(student) : false;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/students')}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50"
        >
          <ArrowRight size={18} />
          العودة إلى الطلاب
        </button>
        <div className="text-left">
          <h1 className="text-2xl font-bold text-gray-900">ملف الطالب</h1>
          <p className="mt-1 text-sm text-gray-500">الهوية الدائمة والسجل الأكاديمي السنوي</p>
        </div>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {schoolId == null ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-8 text-center text-blue-900">
          <School className="mx-auto mb-3" size={32} />
          <h2 className="font-bold">اختر المدرسة المستهدفة</h2>
          <p className="mt-1 text-sm">يجب اختيار مدرسة نشطة قبل عرض ملف الطالب.</p>
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-500">جاري تحميل ملف الطالب...</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <ShieldCheck className="mx-auto mb-3 text-red-600" size={34} />
          <h2 className="font-bold text-gray-900">{notFound ? 'الطالب غير موجود' : 'تعذر عرض ملف الطالب'}</h2>
          <p className="mt-2 text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => parsedStudentId != null && void loadProfile(parsedStudentId, schoolId)}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : student ? (
        <>
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="grid gap-5 p-6 md:grid-cols-[auto_1fr] md:items-center">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl bg-blue-50 text-blue-600">
                {student.photo_url && !photoFailed ? (
                  <img
                    src={student.photo_url}
                    alt={`صورة ${student.full_name}`}
                    className="h-full w-full object-cover"
                    onError={() => setPhotoFailed(true)}
                  />
                ) : (
                  <UserRound size={44} />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-bold text-gray-900">{student.full_name}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${studentStatusClasses(student.status)}`}>
                    {studentStatusLabel(student.status)}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-2 text-sm text-gray-500">
                  <Hash size={15} />
                  {toArabicDigits(student.student_number)}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <InformationItem label="السنة الدراسية الحالية" value={safeStudentProfileValue(student.current_academic_year_name)} />
                  <InformationItem
                    label="الصف الحالي"
                    value={student.current_enrollment_id != null ? safeStudentProfileValue(student.class_name) : EMPTY_STUDENT_PROFILE_VALUE}
                  />
                  <InformationItem
                    label="الشعبة الحالية"
                    value={student.current_enrollment_id != null ? safeStudentProfileValue(student.section_name) : EMPTY_STUDENT_PROFILE_VALUE}
                  />
                </div>
              </div>
            </div>
            {noCurrentEnrollment && (
              <div className="border-t border-amber-200 bg-amber-50 px-6 py-3 text-sm font-semibold text-amber-800">
                {NO_CURRENT_ENROLLMENT_MESSAGE}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <GraduationCap className="text-blue-600" size={21} />
              <h2 className="text-lg font-bold text-gray-900">الوضع الأكاديمي الحالي</h2>
            </div>
            {noCurrentEnrollment ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                {NO_CURRENT_ENROLLMENT_MESSAGE}
              </div>
            ) : student.current_academic_year_id == null ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                لا توجد سنة دراسية فعالة لهذه المدرسة.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <InformationItem label="السنة الدراسية الحالية" value={safeStudentProfileValue(student.current_academic_year_name)} icon={<CalendarDays size={15} />} />
                <InformationItem label="الصف" value={safeStudentProfileValue(student.class_name)} icon={<BookOpen size={15} />} />
                <InformationItem label="الشعبة" value={safeStudentProfileValue(student.section_name)} icon={<Users size={15} />} />
                <InformationItem label="حالة التسجيل" value={enrollmentStatusLabel(student.current_enrollment_status)} />
                <InformationItem label="قرار الترفيع" value={promotionStatusLabel(student.current_promotion_status)} />
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="rounded-xl border border-gray-200 bg-white p-6 lg:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <UserRound className="text-blue-600" size={21} />
                <h2 className="text-lg font-bold text-gray-900">المعلومات الشخصية</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <InformationItem label="الاسم الكامل" value={safeStudentProfileValue(student.full_name)} />
                <InformationItem label="رقم الطالب" value={toArabicDigits(student.student_number)} />
                <InformationItem label="اسم الأب" value={safeStudentProfileValue(student.father_name)} />
                <InformationItem label="اسم الأم" value={safeStudentProfileValue(student.mother_name)} />
                <InformationItem label="الجنس" value={genderLabel(student.gender)} />
                <InformationItem label="تاريخ الميلاد" value={formatStudentProfileDate(student.birth_date)} />
                <InformationItem label="رقم الهاتف" value={safeStudentProfileValue(student.phone)} icon={<Phone size={15} />} />
                <InformationItem label="حالة الطالب" value={studentStatusLabel(student.status)} />
                <div className="sm:col-span-2">
                  <InformationItem label="العنوان" value={safeStudentProfileValue(student.address)} icon={<MapPin size={15} />} />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-4 flex items-center gap-2">
                <Users className="text-blue-600" size={21} />
                <h2 className="text-lg font-bold text-gray-900">معلومات ولي الأمر</h2>
              </div>
              <div className="space-y-3">
                <InformationItem label="اسم ولي الأمر" value={safeStudentProfileValue(student.guardian_name)} />
                <InformationItem label="هاتف ولي الأمر" value={safeStudentProfileValue(student.guardian_phone)} icon={<Phone size={15} />} />
              </div>
            </section>
          </div>

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
              <History className="text-blue-600" size={21} />
              <div>
                <h2 className="text-lg font-bold text-gray-900">سجل التسجيلات الدراسية</h2>
                <p className="text-xs text-gray-500">الأحدث أولًا — من سجل التسجيل السنوي فقط</p>
              </div>
            </div>
            {history.length === 0 ? (
              <div className="p-10 text-center">
                <History className="mx-auto mb-3 text-gray-300" size={36} />
                <p className="font-medium text-gray-700">لا يوجد سجل تسجيلات دراسية لهذا الطالب</p>
                <p className="mt-1 text-sm text-gray-500">ستظهر السنوات الدراسية هنا عند توفر تسجيل سنوي.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {history.map((enrollment) => (
                  <article key={enrollment.id} className="p-5">
                    <div className="grid gap-4 md:grid-cols-[1.1fr_1fr_1fr]">
                      <div>
                        <p className="text-base font-bold text-gray-900">{safeStudentProfileValue(enrollment.academic_year_name)}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {safeStudentProfileValue(enrollment.class_name)}
                          <span className="mx-1">/</span>
                          {safeStudentProfileValue(enrollment.section_name)}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-gray-500">حالة التسجيل</p>
                          <p className="mt-1 font-semibold text-gray-800">{enrollmentStatusLabel(enrollment.status)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">قرار الترفيع</p>
                          <p className="mt-1 font-semibold text-gray-800">{promotionStatusLabel(enrollment.promotion_status)}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-gray-500">تاريخ التسجيل</p>
                          <p className="mt-1 font-semibold text-gray-800">{formatStudentProfileUnixSeconds(enrollment.enrolled_at)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">تاريخ الإكمال</p>
                          <p className="mt-1 font-semibold text-gray-800">{formatStudentProfileUnixSeconds(enrollment.completed_at)}</p>
                        </div>
                      </div>
                    </div>
                    {enrollment.notes && enrollment.notes.trim() && (
                      <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                        <span className="font-semibold">ملاحظات: </span>
                        {enrollment.notes}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          {EMPTY_STUDENT_PROFILE_VALUE}
        </div>
      )}
    </div>
  );
}
