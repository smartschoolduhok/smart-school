import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  GraduationCap,
  School,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import {
  getAcademicYears,
  getClasses,
  getSections,
  getStudents,
  previewStudentPromotion,
  promoteStudent,
} from '../../lib/api';
import type { AcademicYearRecord } from '../../lib/academicYears';
import type { StudentPromotionAction, StudentPromotionData, StudentPromotionPreviewData } from '../../lib/studentPromotion';
import {
  buildStudentPromotionRequest,
  isPromotionPreviewCurrent,
  promotionSelectionFingerprint,
  type StudentPromotionSelection,
} from '../../lib/studentPromotionUi';
import { enrollmentStatusLabel, promotionStatusLabel } from '../../lib/studentProfilePresentation';
import type { EffectiveStudentRecord } from '../../lib/studentEnrollments';
import type { Class, Section } from '../../types';

function actionLabel(action: StudentPromotionAction): string {
  if (action === 'promoted') return 'ترفيع';
  if (action === 'repeated') return 'إعادة السنة';
  return 'تخرج';
}

function executeLabel(action: StudentPromotionAction | null): string {
  if (action === 'repeated') return 'تأكيد إعادة السنة';
  if (action === 'graduated') return 'تأكيد التخرج';
  return 'تنفيذ الترفيع';
}

function ValueCard({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value == null || value === '' ? '—' : value}</p>
    </div>
  );
}

export default function StudentPromotionPage() {
  const [searchParams] = useSearchParams();
  const requestedStudentId = /^\d+$/.test(searchParams.get('student_id') || '')
    ? Number(searchParams.get('student_id'))
    : null;
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const sectionRequestIdRef = useRef(0);

  const [academicYears, setAcademicYears] = useState<AcademicYearRecord[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<EffectiveStudentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [sourceAcademicYearId, setSourceAcademicYearId] = useState<number | null>(null);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [action, setAction] = useState<StudentPromotionAction | null>(null);
  const [targetAcademicYearId, setTargetAcademicYearId] = useState<number | null>(null);
  const [targetClassId, setTargetClassId] = useState<number | null>(null);
  const [targetSectionId, setTargetSectionId] = useState<number | null>(null);

  const [preview, setPreview] = useState<StudentPromotionPreviewData | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionError, setExecutionError] = useState('');
  const [executionResult, setExecutionResult] = useState<StudentPromotionData | null>(null);

  useEffect(() => {
    sectionRequestIdRef.current += 1;
    setAcademicYears([]);
    setClasses([]);
    setSections([]);
    setStudents([]);
    setSourceAcademicYearId(null);
    setStudentId(null);
    setAction(null);
    setTargetAcademicYearId(null);
    setTargetClassId(null);
    setTargetSectionId(null);
    setPreview(null);
    setPreviewFingerprint(null);
    setPreviewing(false);
    setPreviewError('');
    setExecutionError('');
    setExecutionResult(null);
    setConfirmOpen(false);
    setExecuting(false);
    setLoadError('');

    if (schoolId == null) {
      setLoading(false);
      return;
    }

    const isCurrentRequest = captureSchoolRequest();
    setLoading(true);
    void Promise.all([
      getAcademicYears(schoolId),
      getClasses(schoolId),
      getStudents(schoolId),
    ]).then(([yearResponse, classResponse, studentResponse]) => {
      if (!isCurrentRequest()) return;
      const error = yearResponse.error || classResponse.error || studentResponse.error;
      if (error) {
        setLoadError(error);
        setLoading(false);
        return;
      }

      const scopedYears = (yearResponse.data || []).filter((year) => Number(year.school_id) === schoolId);
      const activeYear = scopedYears.find((year) => Number(year.is_active) === 1) ?? null;
      const scopedClasses = ((classResponse.data || []) as Class[])
        .filter((item) => Number(item.school_id) === schoolId && item.status === 'active');
      const scopedStudents = ((studentResponse.data || []) as EffectiveStudentRecord[])
        .filter((student) => Number(student.school_id) === schoolId && student.status === 'active');

      setAcademicYears(scopedYears);
      setClasses(scopedClasses);
      setStudents(scopedStudents);
      setSourceAcademicYearId(activeYear?.id ?? null);
      if (
        requestedStudentId != null
        && scopedStudents.some((student) => student.id === requestedStudentId)
      ) {
        setStudentId(requestedStudentId);
      }
      setLoading(false);
    });
  }, [captureSchoolRequest, requestedStudentId, schoolId]);

  useEffect(() => {
    sectionRequestIdRef.current += 1;
    const requestId = sectionRequestIdRef.current;
    setSections([]);
    setTargetSectionId(null);
    if (schoolId == null || targetClassId == null) {
      setSectionsLoading(false);
      return;
    }

    setSectionsLoading(true);
    void getSections(schoolId, targetClassId).then((response) => {
      if (requestId !== sectionRequestIdRef.current) return;
      if (response.error) {
        setPreviewError(response.error);
        setSectionsLoading(false);
        return;
      }
      setSections(((response.data || []) as Section[]).filter((section) => (
        Number(section.school_id) === schoolId
        && Number(section.class_id) === targetClassId
        && section.status === 'active'
      )));
      setSectionsLoading(false);
    });
  }, [schoolId, targetClassId]);

  const activeYear = useMemo(
    () => academicYears.find((year) => year.id === sourceAcademicYearId) ?? null,
    [academicYears, sourceAcademicYearId],
  );
  const selectedStudent = useMemo(
    () => students.find((student) => student.id === studentId) ?? null,
    [studentId, students],
  );
  const targetYears = useMemo(() => academicYears.filter((year) => (
    year.is_active === 0
    && activeYear != null
    && year.starts_at > activeYear.starts_at
  )), [academicYears, activeYear]);

  const selection = useMemo<StudentPromotionSelection>(() => ({
    schoolId,
    sourceEnrollmentId: selectedStudent?.current_enrollment_id ?? null,
    action,
    targetAcademicYearId: action === 'graduated' ? null : targetAcademicYearId,
    targetClassId: action === 'graduated' ? null : targetClassId,
    targetSectionId: action === 'graduated' ? null : targetSectionId,
  }), [action, schoolId, selectedStudent, targetAcademicYearId, targetClassId, targetSectionId]);
  const selectionFingerprint = promotionSelectionFingerprint(selection);
  const currentFingerprintRef = useRef(selectionFingerprint);
  currentFingerprintRef.current = selectionFingerprint;

  useEffect(() => {
    setPreview(null);
    setPreviewFingerprint(null);
    setPreviewing(false);
    setPreviewError('');
    setExecutionError('');
    setExecutionResult(null);
    setConfirmOpen(false);
  }, [selectionFingerprint]);

  const requiresSection = action !== 'graduated'
    && targetClassId != null
    && !sectionsLoading
    && sections.length > 0;
  const request = buildStudentPromotionRequest(selection);
  const previewCurrent = preview != null && isPromotionPreviewCurrent(previewFingerprint, selection);
  const canPreview = request != null
    && selectedStudent?.current_academic_year_id === sourceAcademicYearId
    && !sectionsLoading
    && (!requiresSection || targetSectionId != null);

  function changeAction(nextAction: StudentPromotionAction | null) {
    setAction(nextAction);
    setTargetAcademicYearId(null);
    setTargetSectionId(null);
    if (nextAction === 'repeated' && selectedStudent?.class_id != null) {
      setTargetClassId(selectedStudent.class_id);
    } else {
      setTargetClassId(null);
    }
  }

  async function requestPreview() {
    const payload = buildStudentPromotionRequest(selection);
    if (!payload || !canPreview) return;
    const requestedFingerprint = promotionSelectionFingerprint(selection);
    const isCurrentSchoolRequest = captureSchoolRequest();
    setPreviewing(true);
    setPreviewError('');
    setExecutionResult(null);
    const response = await previewStudentPromotion(payload);
    if (!isCurrentSchoolRequest() || currentFingerprintRef.current !== requestedFingerprint) return;
    setPreviewing(false);
    if (response.error || !response.data?.valid) {
      setPreview(null);
      setPreviewFingerprint(null);
      setPreviewError(response.data?.blocking_errors?.join('، ') || response.error || 'تعذر إنشاء المعاينة');
      return;
    }
    setPreview(response.data);
    setPreviewFingerprint(requestedFingerprint);
  }

  async function executeTransition() {
    const payload = buildStudentPromotionRequest(selection);
    if (!payload || !previewCurrent) return;
    const requestedFingerprint = promotionSelectionFingerprint(selection);
    const isCurrentSchoolRequest = captureSchoolRequest();
    setExecuting(true);
    setExecutionError('');
    const response = await promoteStudent(payload);
    if (!isCurrentSchoolRequest() || currentFingerprintRef.current !== requestedFingerprint) return;
    setExecuting(false);
    setConfirmOpen(false);
    if (response.error || !response.data) {
      setExecutionError(response.error || 'تعذر تنفيذ قرار الترفيع');
      setPreview(null);
      setPreviewFingerprint(null);
      return;
    }
    setExecutionResult(response.data);
    setPreview(null);
    setPreviewFingerprint(null);
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ترفيع الطلاب</h1>
        <p className="mt-1 text-sm text-gray-500">قرار فردي مع معاينة إلزامية قبل التنفيذ</p>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {schoolId == null ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-8 text-center text-blue-900">
          <School className="mx-auto mb-3" size={32} />
          <h2 className="font-bold">اختر المدرسة المستهدفة</h2>
          <p className="mt-1 text-sm">لا يمكن معاينة أو تنفيذ الترفيع دون مدرسة نشطة محددة صراحةً.</p>
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-gray-500">جاري تحميل بيانات الترفيع...</div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{loadError}</div>
      ) : (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <UserRound className="text-blue-600" size={21} />
              <h2 className="text-lg font-bold text-gray-900">أ) الوضع الحالي</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">السنة الدراسية المصدر</label>
                <select value={sourceAcademicYearId ?? ''} disabled className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2.5 text-sm">
                  <option value="">لا توجد سنة دراسية فعالة</option>
                  {activeYear && <option value={activeYear.id}>{activeYear.name}</option>}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">الطالب</label>
                <select value={studentId ?? ''} onChange={(event) => { setStudentId(event.target.value ? Number(event.target.value) : null); changeAction(null); }} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">اختر طالبًا</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>{student.full_name} — {student.student_number}</option>
                  ))}
                </select>
              </div>
            </div>
            {selectedStudent && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <ValueCard label="اسم الطالب" value={selectedStudent.full_name} />
                <ValueCard label="رقم الطالب" value={selectedStudent.student_number} />
                <ValueCard label="السنة الحالية" value={selectedStudent.current_academic_year_name} />
                <ValueCard label="الصف الحالي" value={selectedStudent.class_name} />
                <ValueCard label="الشعبة الحالية" value={selectedStudent.section_name} />
                <ValueCard label="حالة التسجيل / القرار" value={`${enrollmentStatusLabel(selectedStudent.current_enrollment_status)} / ${promotionStatusLabel(selectedStudent.current_promotion_status)}`} />
              </div>
            )}
            {selectedStudent && selectedStudent.current_enrollment_id == null && (
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">لا يملك الطالب تسجيلًا في السنة الفعالة، لذلك لا يمكن ترفيعه.</p>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <ArrowLeftRight className="text-blue-600" size={21} />
              <h2 className="text-lg font-bold text-gray-900">ب) القرار</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['promoted', 'repeated', 'graduated'] as StudentPromotionAction[]).map((item) => (
                <button key={item} type="button" disabled={!selectedStudent?.current_enrollment_id} onClick={() => changeAction(item)} className={`rounded-xl border p-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${action === item ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-200 text-gray-700 hover:border-blue-300'}`}>
                  {actionLabel(item)}
                </button>
              ))}
            </div>
          </section>

          {action && (
            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-4 flex items-center gap-2">
                <GraduationCap className="text-blue-600" size={21} />
                <h2 className="text-lg font-bold text-gray-900">ج) الوضع المستهدف</h2>
              </div>
              {action === 'graduated' ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  التخرج سيُنهي تسجيل السنة الحالية دون إنشاء تسجيل أو صف أو شعبة مستهدفة.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">السنة الدراسية المستهدفة</label>
                    <select value={targetAcademicYearId ?? ''} onChange={(event) => setTargetAcademicYearId(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                      <option value="">اختر سنة لاحقة غير فعالة</option>
                      {targetYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">الصف المستهدف</label>
                    <select value={targetClassId ?? ''} onChange={(event) => setTargetClassId(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                      <option value="">اختر الصف صراحةً</option>
                      {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">الشعبة المستهدفة</label>
                    <select value={targetSectionId ?? ''} onChange={(event) => setTargetSectionId(event.target.value ? Number(event.target.value) : null)} disabled={targetClassId == null || sectionsLoading || sections.length === 0} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm disabled:bg-gray-100">
                      <option value="">{sectionsLoading ? 'جاري تحميل الشعب...' : sections.length > 0 ? 'اختر الشعبة صراحةً' : 'لا توجد شعب لهذا الصف'}</option>
                      {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">د) المعاينة</h2>
                <p className="mt-1 text-xs text-gray-500">المعاينة تقرأ أحدث حالة فقط ولا تكتب أي بيانات.</p>
              </div>
              <button type="button" onClick={() => void requestPreview()} disabled={!canPreview || previewing} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {previewing ? 'جاري المعاينة...' : action === 'promoted' ? 'معاينة الترفيع' : 'معاينة القرار'}
              </button>
            </div>
            {previewError && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{previewError}</div>}
            {previewCurrent && preview && (
              <div className="space-y-4 rounded-xl border border-green-200 bg-green-50/50 p-5">
                <div className="flex items-center gap-2 text-green-800"><CheckCircle2 size={20} /><span className="font-bold">المعاينة صالحة للتنفيذ</span></div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <ValueCard label="الطالب" value={`${preview.student.full_name} — ${preview.student.student_number}`} />
                  <ValueCard label="المدرسة" value={preview.school.name} />
                  <ValueCard label="القرار" value={actionLabel(preview.action)} />
                  <ValueCard label="تسجيل مستهدف موجود" value={preview.target_enrollment_exists ? 'نعم' : 'لا'} />
                  <ValueCard label="سنة المصدر" value={preview.source.academic_year_name} />
                  <ValueCard label="موقع المصدر" value={`${preview.source.class_name}${preview.source.section_name ? ` / ${preview.source.section_name}` : ''}`} />
                  <ValueCard label="السنة المستهدفة" value={preview.target?.academic_year_name} />
                  <ValueCard label="الموقع المستهدف" value={preview.target ? `${preview.target.class_name}${preview.target.section_name ? ` / ${preview.target.section_name}` : ''}` : 'لا يوجد — تخرج'} />
                </div>
                {preview.warnings.map((warning) => <p key={warning} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{warning}</p>)}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">هـ) التنفيذ</h2>
                <p className="mt-1 text-xs text-gray-500">أي تغيير في الاختيارات يلغي المعاينة ويعطّل التنفيذ.</p>
              </div>
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={!previewCurrent || executing} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                {executeLabel(action)}
              </button>
            </div>
            {executionError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{executionError}</div>}
            {executionResult && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                نُفّذ القرار بنجاح{executionResult.already_applied ? '، وكان القرار نفسه مطبقًا مسبقًا.' : '.'}
              </div>
            )}
          </section>
        </>
      )}

      {confirmOpen && previewCurrent && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="promotion-confirm-title">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-start gap-3 border-b border-gray-100 p-5">
              <div className="rounded-lg bg-red-50 p-2 text-red-600"><AlertTriangle size={22} /></div>
              <div>
                <h2 id="promotion-confirm-title" className="text-lg font-bold text-gray-900">تأكيد قرار {actionLabel(preview.action)}</h2>
                <p className="mt-1 text-sm text-gray-600">سيعيد الخادم التحقق من أحدث حالة قبل أي كتابة. لن يُعدّل التسجيل التاريخي أو موقع الطالب المؤقت.</p>
              </div>
            </div>
            <div className="space-y-2 p-5 text-sm text-gray-700">
              <p><span className="font-semibold">الطالب:</span> {preview.student.full_name}</p>
              <p><span className="font-semibold">المصدر:</span> {preview.source.academic_year_name} — {preview.source.class_name}</p>
              <p><span className="font-semibold">الهدف:</span> {preview.target ? `${preview.target.academic_year_name} — ${preview.target.class_name}` : 'تخرج بلا تسجيل مستهدف'}</p>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 p-5">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={executing} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">إلغاء</button>
              <button type="button" onClick={() => void executeTransition()} disabled={executing} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                <ShieldCheck size={17} />
                {executing ? 'جاري التنفيذ...' : executeLabel(action)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
