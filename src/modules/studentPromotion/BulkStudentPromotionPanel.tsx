import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Search, ShieldCheck, UsersRound } from 'lucide-react';
import {
  getSections,
  previewBulkStudentPromotion,
  promoteStudentsBulk,
} from '../../lib/api';
import type { AcademicYearRecord } from '../../lib/academicYears';
import {
  MAX_BULK_PROMOTION_ROWS,
  type BulkStudentPromotionAction,
  type BulkStudentPromotionExecutionData,
  type BulkStudentPromotionPreviewData,
} from '../../lib/studentBulkPromotion';
import {
  buildBulkPromotionRequest,
  bulkPromotionSelectionFingerprint,
  filterBulkPromotionRows,
  isBulkPromotionCohortWithinLimit,
  isBulkPromotionPreviewCurrent,
  selectBulkPromotionCohort,
  type BulkPromotionUiRow,
  type BulkPromotionUiSelection,
} from '../../lib/studentBulkPromotionUi';
import type { EffectiveStudentRecord } from '../../lib/studentEnrollments';
import { enrollmentStatusLabel, promotionStatusLabel } from '../../lib/studentProfilePresentation';
import type { Class, Section } from '../../types';

interface Props {
  schoolId: number;
  academicYears: AcademicYearRecord[];
  classes: Class[];
  students: EffectiveStudentRecord[];
}

interface StudentDecision extends BulkPromotionUiRow {
  studentId: number;
  studentNumber: string;
  fullName: string;
  sourceClassId: number;
  sourceSectionId: number | null;
  sourceClassName: string;
  sourceSectionName: string | null;
  enrollmentStatus: string | null;
  promotionStatus: string | null;
}

function actionLabel(action: BulkStudentPromotionAction): string {
  if (action === 'promoted') return 'مترفع';
  if (action === 'repeated') return 'معيد';
  if (action === 'graduated') return 'متخرج';
  return 'متخطى';
}

function AcademicYearValue({ value }: { value: string | null | undefined }) {
  return value ? <bdi dir="ltr" className="inline-block isolate">{value}</bdi> : <span>—</span>;
}

export default function BulkStudentPromotionPanel({ schoolId, academicYears, classes, students }: Props) {
  const sectionRequestIdRef = useRef(0);
  const [allSections, setAllSections] = useState<Section[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [sectionsError, setSectionsError] = useState('');
  const [sourceClassId, setSourceClassId] = useState<number | null>(null);
  const [sourceSectionId, setSourceSectionId] = useState<number | null>(null);
  const [targetAcademicYearId, setTargetAcademicYearId] = useState<number | null>(null);
  const [defaultTargetClassId, setDefaultTargetClassId] = useState<number | null>(null);
  const [defaultTargetSectionId, setDefaultTargetSectionId] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<StudentDecision[]>([]);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<BulkStudentPromotionPreviewData | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionError, setExecutionError] = useState('');
  const [executionResult, setExecutionResult] = useState<BulkStudentPromotionExecutionData | null>(null);

  const activeYear = useMemo(
    () => academicYears.find((year) => Number(year.is_active) === 1) ?? null,
    [academicYears],
  );
  const targetYears = useMemo(() => academicYears.filter((year) => (
    Number(year.is_active) === 0
    && activeYear != null
    && year.starts_at > activeYear.starts_at
  )), [academicYears, activeYear]);

  useEffect(() => {
    sectionRequestIdRef.current += 1;
    const requestId = sectionRequestIdRef.current;
    setAllSections([]);
    setSectionsError('');
    setSectionsLoading(true);
    void getSections(schoolId).then((response) => {
      if (requestId !== sectionRequestIdRef.current) return;
      setSectionsLoading(false);
      if (response.error) {
        setSectionsError(`تعذر تحميل الشعب: ${response.error}`);
        return;
      }
      setAllSections(((response.data || []) as Section[]).filter((section) => (
        Number(section.school_id) === schoolId && section.status === 'active'
      )));
    });
    return () => {
      sectionRequestIdRef.current += 1;
    };
  }, [schoolId]);

  const sourceSections = useMemo(
    () => allSections.filter((section) => Number(section.class_id) === sourceClassId),
    [allSections, sourceClassId],
  );
  const defaultTargetSections = useMemo(
    () => allSections.filter((section) => Number(section.class_id) === defaultTargetClassId),
    [allSections, defaultTargetClassId],
  );
  const cohort = useMemo(() => selectBulkPromotionCohort(
    students,
    activeYear?.id ?? null,
    sourceClassId,
    sourceSectionId,
  ), [activeYear?.id, sourceClassId, sourceSectionId, students]);

  useEffect(() => {
    setDecisions(cohort.map((student) => ({
      studentId: student.id,
      studentNumber: student.student_number,
      fullName: student.full_name,
      sourceEnrollmentId: student.current_enrollment_id!,
      sourceClassId: student.class_id!,
      sourceSectionId: student.section_id,
      sourceClassName: student.class_name || '—',
      sourceSectionName: student.section_name,
      enrollmentStatus: student.current_enrollment_status,
      promotionStatus: student.current_promotion_status,
      action: 'skipped',
      targetClassId: null,
      targetSectionId: null,
    })));
    setTargetAcademicYearId(null);
    setDefaultTargetClassId(null);
    setDefaultTargetSectionId(null);
    setSearch('');
  }, [cohort]);

  const selection = useMemo<BulkPromotionUiSelection>(() => ({
    schoolId,
    sourceAcademicYearId: activeYear?.id ?? null,
    sourceClassId,
    sourceSectionId,
    targetAcademicYearId,
    rows: decisions.map((row) => ({
      sourceEnrollmentId: row.sourceEnrollmentId,
      action: row.action,
      targetClassId: row.targetClassId,
      targetSectionId: row.targetSectionId,
    })),
  }), [activeYear?.id, decisions, schoolId, sourceClassId, sourceSectionId, targetAcademicYearId]);
  const fingerprint = bulkPromotionSelectionFingerprint(selection);
  const currentFingerprintRef = useRef(fingerprint);
  currentFingerprintRef.current = fingerprint;

  useEffect(() => {
    setPreview(null);
    setPreviewFingerprint(null);
    setPreviewing(false);
    setPreviewError('');
    setConfirmOpen(false);
    setExecutionError('');
    setExecutionResult(null);
  }, [fingerprint]);

  const selectedCount = decisions.filter((row) => row.action !== 'skipped').length;
  const hasTargetDecision = decisions.some((row) => row.action === 'promoted' || row.action === 'repeated');
  const rowTargetsReady = decisions.every((row) => {
    if (row.action !== 'promoted' && row.action !== 'repeated') return true;
    if (row.targetClassId == null) return false;
    const activeSections = allSections.filter((section) => Number(section.class_id) === row.targetClassId);
    return activeSections.length === 0 || row.targetSectionId != null;
  });
  const request = buildBulkPromotionRequest(selection);
  const cohortWithinLimit = isBulkPromotionCohortWithinLimit(decisions.length, MAX_BULK_PROMOTION_ROWS);
  const canPreview = request != null
    && selectedCount > 0
    && cohortWithinLimit
    && !sectionsLoading
    && !sectionsError
    && rowTargetsReady;
  const previewCurrent = preview != null
    && isBulkPromotionPreviewCurrent(previewFingerprint, selection);
  const canExecute = previewCurrent && preview.valid && preview.summary.invalid === 0 && selectedCount > 0;
  const visibleRows = filterBulkPromotionRows(decisions, search);

  function updateDecision(sourceEnrollmentId: number, updater: (row: StudentDecision) => StudentDecision) {
    setDecisions((current) => current.map((row) => (
      row.sourceEnrollmentId === sourceEnrollmentId ? updater(row) : row
    )));
  }

  function setRowAction(sourceEnrollmentId: number, action: BulkStudentPromotionAction) {
    updateDecision(sourceEnrollmentId, (row) => {
      if (action === 'promoted') {
        return { ...row, action, targetClassId: defaultTargetClassId, targetSectionId: defaultTargetSectionId };
      }
      if (action === 'repeated') {
        return { ...row, action, targetClassId: row.sourceClassId, targetSectionId: row.sourceSectionId };
      }
      return { ...row, action, targetClassId: null, targetSectionId: null };
    });
  }

  function applyToAll(action: BulkStudentPromotionAction) {
    setDecisions((current) => current.map((row) => {
      if (action === 'promoted') {
        return { ...row, action, targetClassId: defaultTargetClassId, targetSectionId: defaultTargetSectionId };
      }
      if (action === 'repeated') {
        return { ...row, action, targetClassId: row.sourceClassId, targetSectionId: row.sourceSectionId };
      }
      return { ...row, action, targetClassId: null, targetSectionId: null };
    }));
  }

  async function requestPreview() {
    const payload = buildBulkPromotionRequest(selection);
    if (!payload || !canPreview) return;
    const requestedFingerprint = bulkPromotionSelectionFingerprint(selection);
    setPreviewing(true);
    setPreviewError('');
    const response = await previewBulkStudentPromotion(payload);
    if (currentFingerprintRef.current !== requestedFingerprint) return;
    setPreviewing(false);
    if (response.error || !response.data) {
      setPreviewError(response.error || 'تعذر إنشاء المعاينة الجماعية');
      return;
    }
    setPreview(response.data);
    setPreviewFingerprint(requestedFingerprint);
  }

  async function executeBulk() {
    const payload = buildBulkPromotionRequest(selection);
    if (!payload || !canExecute) return;
    const requestedFingerprint = bulkPromotionSelectionFingerprint(selection);
    setExecuting(true);
    setExecutionError('');
    const response = await promoteStudentsBulk(payload);
    if (currentFingerprintRef.current !== requestedFingerprint) return;
    setExecuting(false);
    setConfirmOpen(false);
    if (response.error || !response.data) {
      setExecutionError(response.error || 'تعذر تنفيذ الترفيع الجماعي');
      setPreview(null);
      setPreviewFingerprint(null);
      return;
    }
    setExecutionResult(response.data);
    setPreview(null);
    setPreviewFingerprint(null);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <UsersRound className="text-blue-600" size={21} />
          <h2 className="text-lg font-bold text-gray-900">أ) تحديد مجموعة المصدر</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">السنة الفعالة</label>
            <div className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-2.5 text-sm"><AcademicYearValue value={activeYear?.name} /></div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">الصف المصدر</label>
            <select value={sourceClassId ?? ''} onChange={(event) => { setSourceClassId(event.target.value ? Number(event.target.value) : null); setSourceSectionId(null); }} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
              <option value="">اختر الصف</option>
              {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">الشعبة المصدر (اختياري)</label>
            <select value={sourceSectionId ?? ''} onChange={(event) => setSourceSectionId(event.target.value ? Number(event.target.value) : null)} disabled={sourceClassId == null || sectionsLoading || Boolean(sectionsError)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm disabled:bg-gray-100">
              <option value="">كل شعب الصف</option>
              {sourceSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </select>
          </div>
        </div>
        {sectionsError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{sectionsError}</p>}
        {sourceClassId != null && decisions.length === 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">لا توجد تسجيلات طلاب مطابقة لهذه المجموعة في السنة الفعالة.</p>}
        {!cohortWithinLimit && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">تحتوي المجموعة على {decisions.length} طالبًا، بينما الحد الآمن للعملية الواحدة هو {MAX_BULK_PROMOTION_ROWS}. اختر شعبة أصغر.</p>}
      </section>

      {decisions.length > 0 && cohortWithinLimit && (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-bold text-gray-900">ب) السنة والوجهة الافتراضية</h2>
            <p className="mt-1 text-xs text-gray-500">السنة المستهدفة مشتركة وصريحة، ويمكن تعديل صف وشعبة كل طالب قبل المعاينة.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">السنة المستهدفة</label>
                <select dir="ltr" value={targetAcademicYearId ?? ''} onChange={(event) => setTargetAcademicYearId(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                  <option dir="rtl" value="">اختر سنة لاحقة غير فعالة</option>
                  {targetYears.map((year) => <option dir="ltr" key={year.id} value={year.id}>{year.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">الصف الافتراضي للمترفعين</label>
                <select value={defaultTargetClassId ?? ''} onChange={(event) => { setDefaultTargetClassId(event.target.value ? Number(event.target.value) : null); setDefaultTargetSectionId(null); }} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                  <option value="">اختر الصف صراحةً</option>
                  {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">الشعبة الافتراضية</label>
                <select value={defaultTargetSectionId ?? ''} onChange={(event) => setDefaultTargetSectionId(event.target.value ? Number(event.target.value) : null)} disabled={defaultTargetClassId == null || defaultTargetSections.length === 0} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm disabled:bg-gray-100">
                  <option value="">{defaultTargetSections.length ? 'اختر الشعبة صراحةً' : 'لا توجد شعب فعالة'}</option>
                  {defaultTargetSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => applyToAll('promoted')} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white">تعيين الكل مترفعين</button>
              <button type="button" onClick={() => applyToAll('repeated')} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white">تعيين الكل معيدين</button>
              <button type="button" onClick={() => applyToAll('skipped')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700">مسح القرارات</button>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">ج) قرارات الطلاب</h2>
                <p className="mt-1 text-xs text-gray-500">{decisions.length} طالبًا في المجموعة — {selectedCount} قرارًا محددًا</p>
              </div>
              <label className="relative block w-full sm:w-72">
                <Search className="absolute right-3 top-2.5 text-gray-400" size={17} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو الرقم" className="w-full rounded-lg border border-gray-200 py-2 pr-9 pl-3 text-sm" />
              </label>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1050px] w-full text-sm">
                <thead className="bg-gray-50 text-gray-600"><tr><th className="p-3 text-right">الطالب</th><th className="p-3 text-right">الموقع الحالي</th><th className="p-3 text-right">حالة التسجيل / القرار الحالي</th><th className="p-3 text-right">القرار الجديد</th><th className="p-3 text-right">الصف المستهدف</th><th className="p-3 text-right">الشعبة المستهدفة</th><th className="p-3 text-right">حالة المعاينة</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleRows.map((row) => {
                    const rowPreview = previewCurrent ? preview?.rows.find((item) => item.source_enrollment_id === row.sourceEnrollmentId) : null;
                    const targetSections = allSections.filter((section) => Number(section.class_id) === row.targetClassId);
                    const needsTarget = row.action === 'promoted' || row.action === 'repeated';
                    return (
                      <tr key={row.sourceEnrollmentId} className={rowPreview?.state === 'invalid' ? 'bg-red-50/60' : ''}>
                        <td className="p-3"><p className="font-medium text-gray-900">{row.fullName}</p><bdi dir="ltr" className="text-xs text-gray-500">{row.studentNumber}</bdi></td>
                        <td className="p-3">{row.sourceClassName}{row.sourceSectionName ? ` / ${row.sourceSectionName}` : ''}</td>
                        <td className="p-3">{enrollmentStatusLabel(row.enrollmentStatus)} / {promotionStatusLabel(row.promotionStatus)}</td>
                        <td className="p-3"><select value={row.action} onChange={(event) => setRowAction(row.sourceEnrollmentId, event.target.value as BulkStudentPromotionAction)} className="rounded-lg border border-gray-200 px-2 py-2"><option value="skipped">تخطي</option><option value="promoted">مترفع</option><option value="repeated">معيد</option><option value="graduated">متخرج</option></select></td>
                        <td className="p-3"><select value={row.targetClassId ?? ''} onChange={(event) => updateDecision(row.sourceEnrollmentId, (current) => ({ ...current, targetClassId: event.target.value ? Number(event.target.value) : null, targetSectionId: null }))} disabled={!needsTarget} className="w-full rounded-lg border border-gray-200 px-2 py-2 disabled:bg-gray-100"><option value="">—</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
                        <td className="p-3"><select value={row.targetSectionId ?? ''} onChange={(event) => updateDecision(row.sourceEnrollmentId, (current) => ({ ...current, targetSectionId: event.target.value ? Number(event.target.value) : null }))} disabled={!needsTarget || row.targetClassId == null || targetSections.length === 0} className="w-full rounded-lg border border-gray-200 px-2 py-2 disabled:bg-gray-100"><option value="">—</option>{targetSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></td>
                        <td className="p-3">{rowPreview ? <div className={rowPreview.skipped ? 'text-gray-500' : rowPreview.valid ? 'text-green-700' : 'text-red-700'}><p className="font-medium">{rowPreview.skipped ? 'متخطى' : rowPreview.already_applied ? 'مطبق مسبقًا' : rowPreview.valid ? 'صالح' : 'يحتاج مراجعة'}</p>{rowPreview.blocking_errors.map((error) => <p key={error} className="mt-1 text-xs">{error}</p>)}{rowPreview.warnings.map((warning) => <p key={warning} className="mt-1 text-xs">{warning}</p>)}</div> : <span className="text-gray-400">بانتظار المعاينة</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="sticky bottom-3 z-10 rounded-xl border border-blue-200 bg-white/95 p-4 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-700">
                <span className="font-bold">المحدد: {selectedCount}</span>
                {previewCurrent && preview && <span className="mr-4">صالح: {preview.summary.valid} — غير صالح: {preview.summary.invalid} — متخطى: {preview.summary.skipped}</span>}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => void requestPreview()} disabled={!canPreview || previewing} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{previewing ? 'جاري المعاينة...' : 'معاينة إلزامية'}</button>
                <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canExecute || executing} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">تنفيذ الدفعة</button>
              </div>
            </div>
            {previewError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{previewError}</p>}
            {executionError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{executionError}</p>}
            {executionResult && <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">نُفذت الدفعة ذريًا دون كتابة جزئية: {executionResult.summary.executed} جديد، {executionResult.summary.already_applied} مطبق مسبقًا، {executionResult.summary.promoted} مترفع، {executionResult.summary.repeated} معيد، {executionResult.summary.graduated} متخرج، {executionResult.summary.skipped} متخطى.</p>}
            {previewCurrent && preview?.valid && <p className="mt-3 flex items-center gap-2 text-sm font-medium text-green-700"><CheckCircle2 size={18} /> المعاينة الحالية صالحة؛ أي تعديل سيلغيها.</p>}
          </section>
        </>
      )}

      {confirmOpen && canExecute && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="bulk-confirm-title">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-start gap-3 border-b border-gray-100 p-5">
              <div className="rounded-lg bg-red-50 p-2 text-red-600"><AlertTriangle size={22} /></div>
              <div><h2 id="bulk-confirm-title" className="text-lg font-bold">تأكيد تنفيذ الترفيع الجماعي</h2><p className="mt-1 text-sm text-gray-600">ستُنفذ القرارات كلها في معاملة واحدة. إذا تعذر أي صف فلن تُحفظ أي كتابة جزئية.</p></div>
            </div>
            <div className="space-y-2 p-5 text-sm text-gray-700">
              <p>إجمالي المجموعة: <strong>{preview.summary.total}</strong></p>
              <p>إجمالي المحدد: <strong>{preview.summary.selected}</strong> — مترفع: <strong>{preview.summary.promoted}</strong> — معيد: <strong>{preview.summary.repeated}</strong> — متخرج: <strong>{preview.summary.graduated}</strong> — مطبق مسبقًا: <strong>{preview.summary.already_applied}</strong> — متخطى: <strong>{preview.summary.skipped}</strong></p>
              {hasTargetDecision && <p>السنة المستهدفة: <strong><AcademicYearValue value={targetYears.find((year) => year.id === targetAcademicYearId)?.name} /></strong></p>}
              <p className="rounded-lg bg-amber-50 p-3 text-amber-900">سيُقفل تسجيل المصدر لكل طالب محدد، ويُنشأ تسجيل الهدف عند الحاجة. لن تتغير المواقع التاريخية أو المرآة الحالية قبل تفعيل السنة المستهدفة.</p>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 p-5">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={executing} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600">إلغاء</button>
              <button type="button" onClick={() => void executeBulk()} disabled={executing} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><ShieldCheck size={17} />{executing ? 'جاري التنفيذ الذري...' : 'تأكيد تنفيذ الدفعة'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
