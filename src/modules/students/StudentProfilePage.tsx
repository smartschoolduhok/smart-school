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
import { useAuth } from '../../hooks/useAuth';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { getStudent, getStudentEnrollments, getStudentReligiousSubject, setStudentReligiousSubject } from '../../lib/api';
import { ACADEMIC_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import {
  RELIGIOUS_SUBJECT_HAS_GRADES_CODE,
  religiousTrackLabel,
  type StudentReligiousSubjectState,
} from '../../lib/religiousSubjects';
import type { EffectiveStudentRecord, StudentEnrollmentHistoryRecord } from '../../lib/studentEnrollments';
import { studentReligionLabel } from '../../lib/studentReligion';
import {
  EMPTY_STUDENT_PROFILE_VALUE,
  NO_CURRENT_ENROLLMENT_MESSAGE,
  enrollmentYearBadge,
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const parsedStudentId = id && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null;
  const requestedStudentIdRef = useRef<number | null>(parsedStudentId);
  requestedStudentIdRef.current = parsedStudentId;

  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const canManageReligiousSubject = hasRole(user?.role_key, ACADEMIC_MANAGEMENT_ROLES) && schoolId != null;

  const [student, setStudent] = useState<EffectiveStudentRecord | null>(null);
  const [history, setHistory] = useState<StudentEnrollmentHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [religiousSubject, setReligiousSubject] = useState<StudentReligiousSubjectState | null>(null);
  const [religiousSubjectError, setReligiousSubjectError] = useState('');
  const [religiousModalOpen, setReligiousModalOpen] = useState(false);
  const [selectedReligiousSubjectId, setSelectedReligiousSubjectId] = useState('');
  const [religiousSaving, setReligiousSaving] = useState(false);
  const [religiousSaveError, setReligiousSaveError] = useState('');
  const [gradeConfirmationPending, setGradeConfirmationPending] = useState(false);

  useEffect(() => {
    setStudent(null);
    setHistory([]);
    setError('');
    setNotFound(false);
    setPhotoFailed(false);
    setReligiousSubject(null);
    setReligiousSubjectError('');
    setReligiousModalOpen(false);
    setSelectedReligiousSubjectId('');
    setReligiousSaving(false);
    setReligiousSaveError('');
    setGradeConfirmationPending(false);

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

    const [studentResponse, historyResponse, religiousSubjectResponse] = await Promise.all([
      getStudent(requestedStudentId),
      getStudentEnrollments(requestedStudentId, requestedSchoolId),
      getStudentReligiousSubject(requestedStudentId, requestedSchoolId),
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
    if (religiousSubjectResponse.data) setReligiousSubject(religiousSubjectResponse.data);
    else setReligiousSubjectError(religiousSubjectResponse.error || 'تعذر تحميل مادة الديانة الدراسية');
    setLoading(false);
  }

  function openReligiousSubjectModal() {
    setSelectedReligiousSubjectId(religiousSubject?.current_assignment?.subject_id
      ? String(religiousSubject.current_assignment.subject_id)
      : '');
    setReligiousSaveError('');
    setGradeConfirmationPending(false);
    setReligiousModalOpen(true);
  }

  async function saveReligiousSubject(confirmExistingGrades = false) {
    if (schoolId == null || parsedStudentId == null) return;
    const isCurrentRequest = captureSchoolRequest();
    setReligiousSaving(true);
    setReligiousSaveError('');
    const response = await setStudentReligiousSubject(
      parsedStudentId,
      schoolId,
      selectedReligiousSubjectId ? Number(selectedReligiousSubjectId) : null,
      confirmExistingGrades,
    );
    if (!isCurrentRequest() || requestedStudentIdRef.current !== parsedStudentId) return;
    if (response.error) {
      if (response.code === RELIGIOUS_SUBJECT_HAS_GRADES_CODE) {
        setGradeConfirmationPending(true);
      } else {
        setReligiousSaveError(response.error);
      }
      setReligiousSaving(false);
      return;
    }
    setReligiousModalOpen(false);
    setGradeConfirmationPending(false);
    setReligiousSaving(false);
    await loadProfile(parsedStudentId, schoolId);
  }

  const noCurrentEnrollment = student ? hasActiveYearWithoutEnrollment(student) : false;
  const currentAcademicYearStartsAt = student?.current_academic_year_id == null
    ? null
    : history.find((enrollment) => enrollment.academic_year_id === student.current_academic_year_id)?.starts_at ?? null;

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
                    حالة الطالب: {studentStatusLabel(student.status)}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-2 text-sm text-gray-500">
                  <Hash size={15} />
                  <bdi dir="ltr">{student.student_number}</bdi>
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

          <section className="rounded-xl border border-amber-200 bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-amber-50 p-2 text-amber-700"><BookOpen size={21} /></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">مادة الديانة الدراسية</h2>
                  <p className="mt-1 text-xs text-gray-500">تعيين أكاديمي مستقل عن الديانة الشخصية للطالب.</p>
                </div>
              </div>
              {canManageReligiousSubject && (
                <button type="button" onClick={openReligiousSubjectModal} className="rounded-lg border border-amber-200 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50">
                  تغيير مادة الديانة
                </button>
              )}
            </div>
            {religiousSubjectError ? (
              <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{religiousSubjectError}</p>
            ) : religiousSubject?.current_assignment ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InformationItem label="المادة الحالية" value={religiousSubject.current_assignment.subject_name} />
                <InformationItem label="نوع مادة الديانة" value={religiousTrackLabel(religiousSubject.current_assignment.religious_track)} />
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm font-medium text-gray-700">لا يدرس مادة ديانة</p>
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
                <InformationItem label="رقم الطالب" value={<bdi dir="ltr">{student.student_number}</bdi>} />
                <InformationItem label="اسم الأب" value={safeStudentProfileValue(student.father_name)} />
                <InformationItem label="اسم الأم" value={safeStudentProfileValue(student.mother_name)} />
                <InformationItem label="الجنس" value={genderLabel(student.gender)} />
                <InformationItem label="الديانة الشخصية" value={safeStudentProfileValue(studentReligionLabel(student.religion))} />
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
                {history.map((enrollment) => {
                  const yearBadge = enrollmentYearBadge(
                    enrollment,
                    student.current_academic_year_id,
                    currentAcademicYearStartsAt,
                  );
                  return (
                    <article key={enrollment.id} className="p-5">
                    <div className="grid gap-4 md:grid-cols-[1.1fr_1fr_1fr]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-bold text-gray-900">{safeStudentProfileValue(enrollment.academic_year_name)}</p>
                          {yearBadge && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              yearBadge === 'السنة الحالية'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-purple-100 text-purple-700'
                            }`}>
                              {yearBadge}
                            </span>
                          )}
                        </div>
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
                  );
                })}
              </div>
            )}
          </section>

          {religiousModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="religious-subject-dialog-title">
              <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-100 p-5">
                  <div>
                    <h2 id="religious-subject-dialog-title" className="text-lg font-bold text-gray-900">تغيير مادة الديانة الدراسية</h2>
                    <p className="mt-1 text-xs text-gray-500">هذا الاختيار لا يغيّر الديانة الشخصية للطالب.</p>
                  </div>
                  <button type="button" onClick={() => setReligiousModalOpen(false)} disabled={religiousSaving} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="إغلاق"><span aria-hidden="true">×</span></button>
                </div>
                <div className="space-y-4 p-5">
                  {religiousSubject?.meta.message && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{religiousSubject.meta.message}</div>}
                  {religiousSaveError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{religiousSaveError}</div>}
                  {gradeConfirmationPending && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                      توجد درجات محفوظة للمادة الحالية. ستبقى محفوظة في السجل ولن تُحذف، لكن المادة الحالية ستصبح غير فعالة. هل تريد المتابعة؟
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">المادة</label>
                    <select value={selectedReligiousSubjectId} onChange={(event) => { setSelectedReligiousSubjectId(event.target.value); setGradeConfirmationPending(false); }} disabled={religiousSaving || gradeConfirmationPending} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-gray-100">
                      <option value="">لا يدرس مادة ديانة</option>
                      {religiousSubject?.current_assignment
                        && !religiousSubject.candidates.some(candidate => candidate.subject_id === religiousSubject.current_assignment?.subject_id)
                        && <option value={religiousSubject.current_assignment.subject_id}>{religiousSubject.current_assignment.subject_name} — المادة الحالية</option>}
                      {religiousSubject?.candidates.map(candidate => (
                        <option key={candidate.subject_id} value={candidate.subject_id}>{candidate.subject_name} — {religiousTrackLabel(candidate.religious_track)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 border-t border-gray-100 p-5">
                  <button type="button" onClick={() => setReligiousModalOpen(false)} disabled={religiousSaving} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">إلغاء</button>
                  {gradeConfirmationPending ? (
                    <button type="button" onClick={() => void saveReligiousSubject(true)} disabled={religiousSaving} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">تأكيد التغيير مع حفظ الدرجات</button>
                  ) : (
                    <button type="button" onClick={() => void saveReligiousSubject(false)} disabled={religiousSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">حفظ</button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          {EMPTY_STUDENT_PROFILE_VALUE}
        </div>
      )}
    </div>
  );
}
