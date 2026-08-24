import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import {
  getResultCards, getResultCard, generateStudentResultCard,
  generateSectionResultCards, markResultCardPrinted, cancelResultCard,
  previewStudentResultCard, verifyResultCard,
  getStudents, getClasses, getSections
} from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { ResultCardDocument } from '../../components/resultCards/ResultCardDocument';
import {
  hasRole,
  RESULT_CARD_MANAGEMENT_ROLES,
  RESULT_CARD_PRINT_ROLES,
} from '../../lib/rbac';
import type { RoleKey } from '../../types';
import {
  FileText, Printer, Search, User, Users, CheckCircle, AlertCircle,
  Loader2, QrCode, XCircle, Eye, CheckSquare, Globe
} from 'lucide-react';

/* ─── Helpers ─── */
function displayNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return toArabicDigits(String(n));
}
function canGenerate(roleKey?: RoleKey): boolean {
  return hasRole(roleKey, RESULT_CARD_MANAGEMENT_ROLES);
}

function statusBadge(status: string | null) {
  if (!status) return <span className="text-gray-400">—</span>;
  const cls =
    status === 'active' ? 'bg-emerald-100 text-emerald-700' :
    status === 'cancelled' ? 'bg-red-100 text-red-700' :
    status === 'printed' ? 'bg-blue-100 text-blue-700' :
    'bg-gray-100 text-gray-700';
  const label =
    status === 'active' ? 'فعّال' :
    status === 'cancelled' ? 'ملغى' :
    status === 'printed' ? 'مطبوع' :
    status;
  return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{label}</span>;
}

function resultStatusBadge(status: string | null) {
  if (!status) return <span className="text-gray-400">—</span>;
  const cls =
    status === 'ناجح' ? 'bg-emerald-100 text-emerald-700' :
    status === 'راسب' ? 'bg-red-100 text-red-700' :
    status === 'مكمل' ? 'bg-amber-100 text-amber-700' :
    status === 'غير مكتمل' ? 'bg-slate-200 text-slate-700' :
    status === 'معفو' ? 'bg-indigo-100 text-indigo-700' :
    'bg-gray-100 text-gray-700';
  return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{status}</span>;
}

/* ─── Types ─── */
type TabKey = 'generate-student' | 'generate-section' | 'list' | 'verify';

interface CardRecord {
  id: number | null;
  school_id: number;
  card_number: string;
  student_name_snapshot: string;
  class_name_snapshot: string | null;
  section_name_snapshot: string | null;
  school_name_snapshot: string | null;
  academic_year_snapshot: string | null;
  general_exemption_status: number;
  overall_result_status: string;
  generated_at: number;
  printed_at: number | null;
  status: string;
  verification_token: string | null;
  card_data_parsed?: Record<string, any>;
}

interface StudentOption { id: number; full_name: string; student_number: string; }
interface ClassOption { id: number; name: string; }
interface SectionOption { id: number; name: string; class_id: number; }

const RESULT_CARD_DECISION_PRESETS = [
  'معفى عام',
  'ناجح بقرار مجلس المدرسين',
  'مكمل',
  'مؤجل',
];

const RESULT_CARD_EXAM_ROUNDS = ['الدور الأول', 'الدور الثاني'];

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'generate-student', label: 'إنشاء كارت طالب', icon: <User size={18} /> },
  { key: 'generate-section', label: 'إنشاء كارتات شعبة', icon: <Users size={18} /> },
  { key: 'list', label: 'الكارتات المنشأة', icon: <FileText size={18} /> },
  { key: 'verify', label: 'التحقق من الكارت', icon: <CheckSquare size={18} /> },
];

/* ═══════════════════════════════════════
   Main Page
   ═══════════════════════════════════════ */
export default function ResultCardsPage() {
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const [activeTab, setActiveTab] = useState<TabKey>('list');

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center">
          <FileText size={20} className="text-primary-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">كارتات النتائج</h1>
          <p className="text-sm text-gray-500">إنشاء كارتات النتائج الرسمية مع التحقق عبر QR</p>
        </div>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'generate-student' && <GenerateStudentTab schoolId={schoolId} />}
      {activeTab === 'generate-section' && <GenerateSectionTab schoolId={schoolId} />}
      {activeTab === 'list' && <ListTab schoolId={schoolId} />}
      {activeTab === 'verify' && <VerifyTab />}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 1: Generate Student Card
   ═══════════════════════════════════════ */
function GenerateStudentTab({ schoolId }: { schoolId: number | null }) {
  const { user } = useAuth();
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [card, setCard] = useState<CardRecord | null>(null);
  const [cardDetails, setCardDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [decisionNote, setDecisionNote] = useState('');
  const [examRound, setExamRound] = useState('الدور الأول');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    setStudents([]);
    setSelectedStudentId('');
    setCard(null);
    setCardDetails(null);
    setLoading(false);
    setPreviewing(false);
    setGenerating(false);
    setDecisionNote('');
    setExamRound('الدور الأول');
    setMessage(null);
    void loadStudents();
  }, [schoolId]);

  async function loadStudents() {
    if (schoolId == null) { setStudents([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getStudents(schoolId, null, null);
    if (!isCurrent()) return;
    if (res.data) setStudents((res.data as any[]).map((s) => ({ id: s.id, full_name: s.full_name, student_number: s.student_number })));
  }

  async function handleGenerate() {
    if (schoolId == null) { setMessage({ text: 'يجب اختيار المدرسة المستهدفة أولاً', type: 'error' }); return; }
    if (!selectedStudentId) { setMessage({ text: 'يرجى اختيار طالب أولاً', type: 'error' }); return; }
    const isCurrent = captureSchoolRequest();
    setGenerating(true);
    const res = await generateStudentResultCard(selectedStudentId, schoolId, {
      decision_note: decisionNote,
      exam_round: examRound,
    });
    if (!isCurrent()) return;
    setGenerating(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: (res.data as any)?.message || 'تم إنشاء الكارت بنجاح', type: 'success' });
      setCard(res.data?.card || null);
      if (res.data?.card?.id) {
        const d = await getResultCard(res.data.card.id, schoolId);
        if (!isCurrent()) return;
        setCardDetails(d.data || null);
      }
    }
    setTimeout(() => setMessage(null), 5000);
  }

  async function handleLivePreview() {
    if (schoolId == null) { setMessage({ text: 'يجب اختيار المدرسة المستهدفة أولاً', type: 'error' }); return; }
    if (!selectedStudentId) { setMessage({ text: 'يرجى اختيار طالب أولاً', type: 'error' }); return; }
    const isCurrent = captureSchoolRequest();
    setPreviewing(true);
    const res = await previewStudentResultCard(selectedStudentId, schoolId, {
      decision_note: decisionNote,
      exam_round: examRound,
    });
    if (!isCurrent()) return;
    setPreviewing(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
      return;
    }
    const previewCard = res.data?.card as CardRecord | undefined;
    setCard(previewCard || null);
    setCardDetails(previewCard ? { card_data_parsed: previewCard.card_data_parsed } : null);
    setMessage({
      text: (res.data as any)?.message || 'تم إعداد المعاينة المباشرة دون حفظ',
      type: 'success',
    });
  }

  async function handleLoadPreview() {
    if (schoolId == null || !selectedStudentId) return;
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    // Find existing active card for this student
    const res = await getResultCards({ student_id: Number(selectedStudentId), status: 'active', school_id: schoolId });
    if (!isCurrent()) return;
    const cards = (res.data || []) as CardRecord[];
    if (cards.length > 0) {
      setCard(cards[0]);
      const d = await getResultCard(cards[0].id!, schoolId);
      if (!isCurrent()) return;
      setCardDetails(d.data || null);
    } else {
      setCard(null);
      setCardDetails(null);
      setMessage({ text: 'لا يوجد كارت فعّال لهذا الطالب. يمكنك إنشاء كارت جديد.', type: 'error' });
      setTimeout(() => setMessage(null), 4000);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-[180px_1fr]">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">الدور</label>
          <select
            value={examRound}
            onChange={(event) => { setExamRound(event.target.value); setCard(null); setCardDetails(null); }}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {RESULT_CARD_EXAM_ROUNDS.map((round) => <option key={round}>{round}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">ملاحظة / قرار رسمي اختياري</label>
          <textarea
            value={decisionNote}
            onChange={(event) => { setDecisionNote(event.target.value); setCard(null); setCardDetails(null); }}
            maxLength={1000}
            rows={2}
            placeholder="مثال: ناجح بقرار مجلس المدرسين"
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {RESULT_CARD_DECISION_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => { setDecisionNote(preset); setCard(null); setCardDetails(null); }}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">اختيار الطالب</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={selectedStudentId}
              onChange={(e) => { setSelectedStudentId(e.target.value); setCard(null); setCardDetails(null); }}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
            >
              <option value="">— اختر طالب —</option>
              {students.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.full_name} ({toArabicDigits(s.student_number)})
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={handleLoadPreview}
          disabled={!selectedStudentId || loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
          عرض الكارت الحالي
        </button>
        {canGenerate(user?.role_key) && schoolId != null && (
          <>
            <button
              onClick={handleLivePreview}
              disabled={previewing || !selectedStudentId}
              className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
            >
              {previewing ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
              معاينة مباشرة
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedStudentId}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {generating ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
              إصدار وحفظ الكارت
            </button>
          </>
        )}
      </div>

      {/* Card Preview */}
      {(card || cardDetails) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">معاينة الكارت</h3>
            {card?.id && (
              <a
                href={`/print/result-card/${card.id}?school_id=${schoolId}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors print:hidden"
              >
                <Printer size={14} />
                طباعة / تصدير PDF
              </a>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-black print:rounded-none">
            {card && (
              <ResultCardDocument
                card={card}
                data={cardDetails?.card_data_parsed || card.card_data_parsed}
                verificationUrl={card.verification_token
                  ? `${window.location.origin}/verify/result-card/${card.verification_token}`
                  : null}
                compact
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
/* ═══════════════════════════════════════
   Tab 2: Generate Section Cards
   ═══════════════════════════════════════ */
function GenerateSectionTab({ schoolId }: { schoolId: number | null }) {
  const { user } = useAuth();
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [decisionNote, setDecisionNote] = useState('');
  const [examRound, setExamRound] = useState('الدور الأول');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    setClasses([]);
    setSections([]);
    setSelectedClassId('');
    setSelectedSectionId('');
    setResult(null);
    setGenerating(false);
    setDecisionNote('');
    setExamRound('الدور الأول');
    setMessage(null);
    void loadClasses();
  }, [schoolId]);
  useEffect(() => {
    if (selectedClassId) loadSections(selectedClassId);
    else { setSections([]); setSelectedSectionId(''); }
  }, [selectedClassId]);

  async function loadClasses() {
    if (schoolId == null) { setClasses([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getClasses(schoolId);
    if (!isCurrent()) return;
    if (res.data) setClasses((res.data as any[]).map((c) => ({ id: c.id, name: c.name })));
  }
  async function loadSections(classId: string) {
    if (schoolId == null) { setSections([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getSections(schoolId, Number(classId));
    if (!isCurrent()) return;
    if (res.data) setSections((res.data as any[]).map((s) => ({ id: s.id, name: s.name, class_id: s.class_id })));
  }

  async function handleGenerate() {
    if (schoolId == null) { setMessage({ text: 'يجب اختيار المدرسة المستهدفة أولاً', type: 'error' }); return; }
    if (!selectedClassId || !selectedSectionId) {
      setMessage({ text: 'يرجى اختيار الصف والشعبة', type: 'error' });
      return;
    }
    const isCurrent = captureSchoolRequest();
    setGenerating(true);
    setResult(null);
    const res = await generateSectionResultCards({
      school_id: schoolId,
      class_id: Number(selectedClassId),
      section_id: Number(selectedSectionId),
      decision_note: decisionNote,
      exam_round: examRound,
    });
    if (!isCurrent()) return;
    setGenerating(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: (res.data as any)?.message || `تم إنشاء ${displayNum(res.data?.generated_count)} كارت`, type: 'success' });
      setResult(res.data || null);
    }
    setTimeout(() => setMessage(null), 6000);
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      {!canGenerate(user?.role_key) && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-sm">
          <AlertCircle size={16} />
          <span>ليس لديك صلاحية إنشاء كارتات النتائج.</span>
        </div>
      )}

      <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-[180px_1fr]">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">الدور لكل الكارتات</label>
          <select
            value={examRound}
            onChange={(event) => setExamRound(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {RESULT_CARD_EXAM_ROUNDS.map((round) => <option key={round}>{round}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">قرار اختياري يطبق على جميع كارتات الشعبة</label>
          <textarea
            value={decisionNote}
            onChange={(event) => setDecisionNote(event.target.value)}
            maxLength={1000}
            rows={2}
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">الصف</label>
          <select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">— اختر —</option>
            {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>
        <div className="w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">الشعبة</label>
          <select value={selectedSectionId} onChange={(e) => setSelectedSectionId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" disabled={!selectedClassId}>
            <option value="">— اختر —</option>
            {sections.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        </div>
        {canGenerate(user?.role_key) && schoolId != null && (
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedSectionId}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
            إنشاء كارتات الشعبة
          </button>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          {result.generated_count > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <h4 className="text-sm font-bold text-emerald-800 mb-2">تم إنشاؤها ({displayNum(result.generated_count)})</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {result.generated?.map((g: any) => (
                  <div key={g.student_id} className="bg-white rounded-md border border-emerald-200 px-3 py-2 text-sm">
                    <span className="font-medium text-gray-900">{g.student_name}</span>
                    <span className="text-gray-500 mr-2">{g.card_number}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.skipped_count > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 className="text-sm font-bold text-amber-800 mb-2">تم تخطيها ({displayNum(result.skipped_count)})</h4>
              <div className="space-y-2">
                {result.skipped?.map((s: any) => (
                  <div key={s.student_id} className="bg-white rounded-md border border-amber-200 px-3 py-2 text-sm flex items-center justify-between">
                    <span className="font-medium text-gray-900">{s.student_name}</span>
                    <span className="text-amber-700 text-xs">{s.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 3: List Cards
   ═══════════════════════════════════════ */
function ListTab({ schoolId }: { schoolId: number | null }) {
  const { user } = useAuth();
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<{ status: string; student_id: string }>({ status: '', student_id: '' });
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);

  useEffect(() => {
    setCards([]);
    setStudents([]);
    setFilters({ status: '', student_id: '' });
    setLoading(false);
    setMessage(null);
    void loadCards();
    void loadStudents();
  }, [schoolId]);

  async function loadCards() {
    if (schoolId == null) { setCards([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getResultCards({
      school_id: schoolId,
      status: filters.status || null,
      student_id: filters.student_id ? Number(filters.student_id) : null,
    });
    if (!isCurrent()) return;
    setCards((res.data || []) as CardRecord[]);
    setLoading(false);
  }

  async function loadStudents() {
    if (schoolId == null) { setStudents([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getStudents(schoolId, null, null);
    if (!isCurrent()) return;
    if (res.data) setStudents((res.data as any[]).map((s) => ({ id: s.id, full_name: s.full_name, student_number: s.student_number })));
  }

  async function handleMarkPrinted(id: number) {
    if (schoolId == null) return;
    const isCurrent = captureSchoolRequest();
    const res = await markResultCardPrinted(id, schoolId);
    if (!isCurrent()) return;
    if (res.error) setMessage({ text: res.error, type: 'error' });
    else { setMessage({ text: 'تم تعليم الكارت كمطبوع', type: 'success' }); loadCards(); }
    setTimeout(() => setMessage(null), 3000);
  }

  async function handleCancel(id: number) {
    if (schoolId == null) return;
    if (!window.confirm('هل أنت متأكد من إلغاء هذا الكارت؟')) return;
    const isCurrent = captureSchoolRequest();
    const res = await cancelResultCard(id, schoolId);
    if (!isCurrent()) return;
    if (res.error) setMessage({ text: res.error, type: 'error' });
    else { setMessage({ text: 'تم إلغاء الكارت', type: 'success' }); loadCards(); }
    setTimeout(() => setMessage(null), 3000);
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">الطالب</label>
          <select value={filters.student_id} onChange={(e) => setFilters((f) => ({ ...f, student_id: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">الكل</option>
            {students.map((s) => <option key={s.id} value={String(s.id)}>{s.full_name}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label className="block text-sm font-medium text-gray-700 mb-1">الحالة</label>
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">الكل</option>
            <option value="active">فعّال</option>
            <option value="printed">مطبوع</option>
            <option value="cancelled">ملغى</option>
          </select>
        </div>
        <button onClick={loadCards} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          بحث
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={28} className="animate-spin text-primary-600" />
          <span className="mr-2 text-sm text-gray-500">جاري التحميل...</span>
        </div>
      ) : cards.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <FileText size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">لا توجد كارتات نتائج</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs">
                  <th className="px-3 py-2 text-right font-medium border-b border-gray-200">رقم الكارت</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-gray-200">الطالب</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-gray-200">الصف / الشعبة</th>
                  <th className="px-3 py-2 text-center font-medium border-b border-gray-200">السنة</th>
                  <th className="px-3 py-2 text-center font-medium border-b border-gray-200">الحالة</th>
                  <th className="px-3 py-2 text-center font-medium border-b border-gray-200">النتيجة</th>
                  <th className="px-3 py-2 text-center font-medium border-b border-gray-200">الإعفاء</th>
                  <th className="px-3 py-2 text-center font-medium border-b border-gray-200">تاريخ الإنشاء</th>
                  <th className="px-3 py-2 text-center font-medium border-b border-gray-200">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 border-b border-gray-100 font-mono text-xs text-gray-700">{c.card_number}</td>
                    <td className="px-3 py-2 border-b border-gray-100 font-medium text-gray-900">{c.student_name_snapshot}</td>
                    <td className="px-3 py-2 border-b border-gray-100 text-gray-600 text-xs">{c.class_name_snapshot}{c.section_name_snapshot ? ` / ${c.section_name_snapshot}` : ''}</td>
                    <td className="px-3 py-2 border-b border-gray-100 text-center text-gray-600 text-xs">{c.academic_year_snapshot || '—'}</td>
                    <td className="px-3 py-2 border-b border-gray-100 text-center">{statusBadge(c.status)}</td>
                    <td className="px-3 py-2 border-b border-gray-100 text-center">{resultStatusBadge(c.overall_result_status)}</td>
                    <td className="px-3 py-2 border-b border-gray-100 text-center">
                      {c.general_exemption_status ? (
                        <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-700">معفى عام</span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-100 text-center text-gray-500 text-xs">
                      {c.generated_at ? new Date(c.generated_at * 1000).toLocaleDateString('ar-SY') : '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-100 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {c.status === 'active' && (
                          <>
                            {hasRole(user?.role_key, RESULT_CARD_PRINT_ROLES) && (
                              <button onClick={() => handleMarkPrinted(c.id!)} title="تعليم كمطبوع" className="p-1.5 rounded-md hover:bg-blue-50 text-blue-600 transition-colors">
                                <Printer size={14} />
                              </button>
                            )}
                            <a
                              href={`/print/result-card/${c.id}?school_id=${schoolId}`}
                              target="_blank"
                              rel="noreferrer"
                              title="طباعة / تصدير PDF"
                              className="p-1.5 rounded-md hover:bg-indigo-50 text-indigo-600 transition-colors"
                            >
                              <Printer size={14} />
                            </a>
                            {hasRole(user?.role_key, RESULT_CARD_MANAGEMENT_ROLES) && (
                              <button onClick={() => handleCancel(c.id!)} title="إلغاء" className="p-1.5 rounded-md hover:bg-red-50 text-red-600 transition-colors">
                                <XCircle size={14} />
                              </button>
                            )}
                          </>
                        )}
                        <a
                          href={`/verify/result-card/${c.verification_token}`}
                          target="_blank"
                          rel="noreferrer"
                          title="فتح صفحة التحقق"
                          className="p-1.5 rounded-md hover:bg-emerald-50 text-emerald-600 transition-colors"
                        >
                          <Globe size={14} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 4: Verify Card
   ═══════════════════════════════════════ */
function VerifyTab() {
  const [token, setToken] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  async function handleVerify() {
    if (!token.trim()) { setMessage({ text: 'يرجى إدخال رمز التحقق', type: 'error' }); return; }
    setLoading(true);
    setResult(null);
    const res = await verifyResultCard(token.trim());
    setLoading(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setResult(res.data || null);
      if (res.data?.valid) {
        setMessage({ text: 'الكارت صالح ومؤكد', type: 'success' });
      } else if (res.data?.cancelled) {
        setMessage({ text: 'هذا الكارت ملغى ولا يُعتد به', type: 'error' });
      } else {
        setMessage({ text: 'الكارت غير موجود أو رمز التحقق غير صحيح', type: 'error' });
      }
    }
    setTimeout(() => setMessage(null), 5000);
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">رمز التحقق (Token)</label>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleVerify(); }}
            placeholder="أدخل رمز التحقق المطبوع على الكارت"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono"
            dir="ltr"
          />
        </div>
        <button
          onClick={handleVerify}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
          تحقق
        </button>
      </div>

      {result && result.valid && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
              <CheckCircle size={24} className="text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-emerald-900">كارت نتيجة مؤكد</h3>
              <p className="text-sm text-emerald-700">هذا الكارت صادر من النظام ولم يُلغَ</p>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-emerald-200 p-4 space-y-2 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><span className="text-gray-500">رقم الكارت:</span> <span className="font-mono font-medium text-gray-900">{result.card_number}</span></div>
              <div><span className="text-gray-500">الطالب:</span> <span className="font-medium text-gray-900">{result.student_name}</span></div>
              <div><span className="text-gray-500">المدرسة:</span> <span className="font-medium text-gray-900">{result.school_name}</span></div>
              <div><span className="text-gray-500">الصف / الشعبة:</span> <span className="font-medium text-gray-900">{result.class_name}{result.section_name ? ` / ${result.section_name}` : ''}</span></div>
              <div><span className="text-gray-500">السنة الدراسية:</span> <span className="font-medium text-gray-900">{result.academic_year || '—'}</span></div>
              <div><span className="text-gray-500">تاريخ الإنشاء:</span> <span className="font-medium text-gray-900">{result.generated_at ? new Date(result.generated_at * 1000).toLocaleDateString('ar-SY') : '—'}</span></div>
              <div><span className="text-gray-500">النتيجة العامة:</span> {resultStatusBadge(result.overall_result_status)}</div>
              <div><span className="text-gray-500">الإعفاء العام:</span> {result.general_exemption_status ? <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-700">معفى عام</span> : <span className="text-gray-400">—</span>}</div>
              {result.card_mode === 'partial' && <div><span className="text-gray-500">نوع الكارت:</span> <span className="font-semibold text-amber-700">جزئي</span></div>}
              {result.decision_note && <div className="sm:col-span-2"><span className="text-gray-500">القرار:</span> <span className="font-medium text-gray-900">{result.decision_note}</span></div>}
            </div>
          </div>
        </div>
      )}

      {result && !result.valid && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <XCircle size={24} className="text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-red-900">كارت غير صالح</h3>
              <p className="text-sm text-red-700">{result.message || 'هذا الكارت غير موجود أو رمز التحقق غير صحيح'}</p>
            </div>
          </div>
          {result.card_number && (
            <div className="mt-4 bg-white rounded-lg border border-red-200 p-4 text-sm space-y-1">
              <p><span className="text-gray-500">رقم الكارت:</span> <span className="font-mono font-medium">{result.card_number}</span></p>
              <p><span className="text-gray-500">الطالب:</span> <span className="font-medium">{result.student_name || '—'}</span></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
