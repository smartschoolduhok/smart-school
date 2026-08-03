import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { QRCodeSVG } from 'qrcode.react';
import {
  getResultCards, getResultCard, generateStudentResultCard,
  generateSectionResultCards, markResultCardPrinted, cancelResultCard,
  verifyResultCard,
  getStudents, getClasses, getSections
} from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import {
  hasRole,
  RESULT_CARD_MANAGEMENT_ROLES,
  RESULT_CARD_PRINT_ROLES,
} from '../../lib/rbac';
import type { RoleKey } from '../../types';
import {
  FileText, Printer, Search, User, Users, CheckCircle, AlertCircle,
  Loader2, QrCode, XCircle, Eye, Trash2, CheckSquare, Globe
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
    'bg-gray-100 text-gray-700';
  return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{status}</span>;
}

/* ─── Types ─── */
type TabKey = 'generate-student' | 'generate-section' | 'list' | 'verify';

interface CardRecord {
  id: number;
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
  verification_token: string;
}

interface StudentOption { id: number; full_name: string; student_number: string; }
interface ClassOption { id: number; name: string; }
interface SectionOption { id: number; name: string; class_id: number; }

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
  const { user } = useAuth();
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

      {activeTab === 'generate-student' && <GenerateStudentTab />}
      {activeTab === 'generate-section' && <GenerateSectionTab />}
      {activeTab === 'list' && <ListTab />}
      {activeTab === 'verify' && <VerifyTab />}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 1: Generate Student Card
   ═══════════════════════════════════════ */
function GenerateStudentTab() {
  const { user } = useAuth();
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [card, setCard] = useState<CardRecord | null>(null);
  const [cardDetails, setCardDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadStudents(); }, [user?.school_id]);

  async function loadStudents() {
    const res = await getStudents(user?.school_id ?? null, null, null);
    if (res.data) setStudents((res.data as any[]).map((s) => ({ id: s.id, full_name: s.full_name, student_number: s.student_number })));
  }

  async function handleGenerate() {
    if (!selectedStudentId) { setMessage({ text: 'يرجى اختيار طالب أولاً', type: 'error' }); return; }
    setGenerating(true);
    const res = await generateStudentResultCard(selectedStudentId);
    setGenerating(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: (res.data as any)?.message || 'تم إنشاء الكارت بنجاح', type: 'success' });
      setCard(res.data?.card || null);
      if (res.data?.card?.id) {
        const d = await getResultCard(res.data.card.id);
        setCardDetails(d.data || null);
      }
    }
    setTimeout(() => setMessage(null), 5000);
  }

  async function handleLoadPreview() {
    if (!selectedStudentId) return;
    setLoading(true);
    // Find existing active card for this student
    const res = await getResultCards({ student_id: Number(selectedStudentId), status: 'active', school_id: user?.school_id ?? null });
    const cards = (res.data || []) as CardRecord[];
    if (cards.length > 0) {
      setCard(cards[0]);
      const d = await getResultCard(cards[0].id);
      setCardDetails(d.data || null);
    } else {
      setCard(null);
      setCardDetails(null);
      setMessage({ text: 'لا يوجد كارت فعّال لهذا الطالب. يمكنك إنشاء كارت جديد.', type: 'error' });
      setTimeout(() => setMessage(null), 4000);
    }
    setLoading(false);
  }

  function handlePrint() {
    if (!printRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const html = `
      <html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>كارت النتيجة</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Cairo', sans-serif; background: #fff; color: #111; }
        .card { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm; border: 2px solid #111; }
        .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
        .header h2 { font-size: 22px; font-weight: 700; }
        .header p { font-size: 14px; color: #444; margin-top: 4px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 16px; font-size: 13px; }
        .info-grid .row { display: flex; gap: 6px; }
        .label { font-weight: 600; color: #333; }
        .value { color: #111; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
        th, td { border: 1px solid #333; padding: 6px 8px; text-align: center; }
        th { background: #f3f4f6; font-weight: 600; }
        .summary { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 12px; }
        .summary-box { border: 1px solid #333; padding: 10px 14px; font-size: 13px; }
        svg { display: block; margin: 0 auto; }
        .footer { margin-top: 24px; text-align: center; font-size: 11px; color: #555; border-top: 1px solid #ccc; padding-top: 10px; }
        @media print { .card { border: none; } body { background: #fff; } }
      </style></head><body>${printRef.current.innerHTML}</body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 300);
  }

  const selectedStudent = students.find((s) => String(s.id) === selectedStudentId);

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
        {canGenerate(user?.role_key) && (
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedStudentId}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            إنشاء / تجديد الكارت
          </button>
        )}
      </div>

      {/* Card Preview */}
      {(card || cardDetails) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">معاينة الكارت</h3>
            <button onClick={handlePrint} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-900 transition-colors print:hidden">
              <Printer size={14} />
              طباعة
            </button>
            <a
              href={`/print/result-card/${card!.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors print:hidden"
            >
              <Printer size={14} />
              تصدير PDF
            </a>
          </div>
          <div ref={printRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-black print:rounded-none">
            <CardPreview card={card} details={cardDetails} student={selectedStudent} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 2: Generate Section Cards
   ═══════════════════════════════════════ */
function GenerateSectionTab() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => { loadClasses(); }, [user?.school_id]);
  useEffect(() => {
    if (selectedClassId) loadSections(selectedClassId);
    else { setSections([]); setSelectedSectionId(''); }
  }, [selectedClassId]);

  async function loadClasses() {
    const res = await getClasses(user?.school_id ?? null);
    if (res.data) setClasses((res.data as any[]).map((c) => ({ id: c.id, name: c.name })));
  }
  async function loadSections(classId: string) {
    const res = await getSections(user?.school_id ?? null, Number(classId));
    if (res.data) setSections((res.data as any[]).map((s) => ({ id: s.id, name: s.name, class_id: s.class_id })));
  }

  async function handleGenerate() {
    if (!selectedClassId || !selectedSectionId) {
      setMessage({ text: 'يرجى اختيار الصف والشعبة', type: 'error' });
      return;
    }
    setGenerating(true);
    setResult(null);
    const res = await generateSectionResultCards({ class_id: Number(selectedClassId), section_id: Number(selectedSectionId) });
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
        {canGenerate(user?.role_key) && (
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
function ListTab() {
  const { user } = useAuth();
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<{ status: string; student_id: string }>({ status: '', student_id: '' });
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);

  useEffect(() => { loadCards(); loadStudents(); }, [user?.school_id]);

  async function loadCards() {
    setLoading(true);
    const res = await getResultCards({
      school_id: user?.school_id ?? null,
      status: filters.status || null,
      student_id: filters.student_id ? Number(filters.student_id) : null,
    });
    setCards((res.data || []) as CardRecord[]);
    setLoading(false);
  }

  async function loadStudents() {
    const res = await getStudents(user?.school_id ?? null, null, null);
    if (res.data) setStudents((res.data as any[]).map((s) => ({ id: s.id, full_name: s.full_name, student_number: s.student_number })));
  }

  async function handleMarkPrinted(id: number) {
    const res = await markResultCardPrinted(id);
    if (res.error) setMessage({ text: res.error, type: 'error' });
    else { setMessage({ text: 'تم تعليم الكارت كمطبوع', type: 'success' }); loadCards(); }
    setTimeout(() => setMessage(null), 3000);
  }

  async function handleCancel(id: number) {
    if (!window.confirm('هل أنت متأكد من إلغاء هذا الكارت؟')) return;
    const res = await cancelResultCard(id);
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
                        <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-700">معفى</span>
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
                              <button onClick={() => handleMarkPrinted(c.id)} title="تعليم كمطبوع" className="p-1.5 rounded-md hover:bg-blue-50 text-blue-600 transition-colors">
                                <Printer size={14} />
                              </button>
                            )}
                            <a
                              href={`/print/result-card/${c.id}`}
                              target="_blank"
                              rel="noreferrer"
                              title="طباعة / تصدير PDF"
                              className="p-1.5 rounded-md hover:bg-indigo-50 text-indigo-600 transition-colors"
                            >
                              <Printer size={14} />
                            </a>
                            {hasRole(user?.role_key, RESULT_CARD_MANAGEMENT_ROLES) && (
                              <button onClick={() => handleCancel(c.id)} title="إلغاء" className="p-1.5 rounded-md hover:bg-red-50 text-red-600 transition-colors">
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
              <div><span className="text-gray-500">الإعفاء العام:</span> {result.general_exemption_status ? <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-700">معفى</span> : <span className="text-gray-400">—</span>}</div>
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

/* ═══════════════════════════════════════
   Card Preview (A4-like layout)
   ═══════════════════════════════════════ */
function CardPreview({ card, details, student }: { card: CardRecord | null; details: any; student?: StudentOption }) {
  if (!card) return null;

  const data = details?.card_data_parsed || {};
  const subjects = (data.subjects || []) as any[];
  const summary = data.summary || {};
  const verificationUrl = card?.verification_token ? `/verify/result-card/${card.verification_token}` : '';

  return (
    <div className="p-8 space-y-6" style={{ maxWidth: '210mm', margin: '0 auto' }}>
      {/* Header */}
      <div className="text-center border-b-2 border-gray-900 pb-4">
        <h2 className="text-2xl font-bold text-gray-900">{card.school_name_snapshot || 'المدرسة'}</h2>
        <p className="text-sm text-gray-600 mt-1">كارت النتيجة الرسمي — {card.academic_year_snapshot || 'السنة الدراسية'}</p>
        <p className="text-xs text-gray-500 mt-1 font-mono">{card.card_number}</p>
      </div>

      {/* Student Info */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex gap-2"><span className="font-semibold text-gray-700">اسم الطالب:</span> <span className="text-gray-900">{card.student_name_snapshot}</span></div>
        <div className="flex gap-2"><span className="font-semibold text-gray-700">رقم الطالب:</span> <span className="text-gray-900 font-mono">{student ? toArabicDigits(student.student_number) : (data.student?.student_number ? toArabicDigits(data.student.student_number) : '—')}</span></div>
        <div className="flex gap-2"><span className="font-semibold text-gray-700">الصف:</span> <span className="text-gray-900">{card.class_name_snapshot || '—'}</span></div>
        <div className="flex gap-2"><span className="font-semibold text-gray-700">الشعبة:</span> <span className="text-gray-900">{card.section_name_snapshot || '—'}</span></div>
      </div>

      {/* Subjects Table */}
      {subjects.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-700">
              <th className="border border-gray-300 px-3 py-2 text-right font-semibold">المادة</th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold w-24">السعي السنوي</th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold w-24">النهائي</th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold w-24">الدرجة الفعّالة</th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold w-24">الحالة</th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold w-20">إعفاء</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((s: any, idx: number) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="border border-gray-200 px-3 py-2 text-gray-900">{s.subject_name || s.name || '—'}</td>
                <td className="border border-gray-200 px-3 py-2 text-center text-gray-700">{displayNum(s.annual_effort)}</td>
                <td className="border border-gray-200 px-3 py-2 text-center text-gray-700">{displayNum(s.final_exam)}</td>
                <td className="border border-gray-200 px-3 py-2 text-center font-semibold text-gray-900">{displayNum(s.effective_grade ?? s.grade_after_completion ?? s.final_grade)}</td>
                <td className="border border-gray-200 px-3 py-2 text-center">{resultStatusBadge(s.result_status)}</td>
                <td className="border border-gray-200 px-3 py-2 text-center">
                  {s.exemption_status ? <span className="text-blue-700 font-semibold text-xs">معفى</span> : <span className="text-gray-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Summary */}
      <div className="flex items-start justify-between gap-4 border-t border-gray-200 pt-4">
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="font-semibold text-gray-700">متوسط السعي السنوي:</span>
            <span className="text-gray-900">{displayNum(summary.annual_effort_average)}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-gray-700">أدنى سعي سنوي:</span>
            <span className="text-gray-900">{displayNum(summary.min_annual_effort)}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-gray-700">النتيجة العامة:</span>
            {resultStatusBadge(card.overall_result_status)}
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-gray-700">الإعفاء العام:</span>
            {card.general_exemption_status ? <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-700">معفى</span> : <span className="text-gray-400">—</span>}
          </div>
        </div>

        {verificationUrl && (
          <div className="shrink-0">
            <QRCodeSVG
              value={`${window.location.origin}${verificationUrl}`}
              size={140}
              level="M"
              bgColor="#ffffff"
              fgColor="#111827"
            />
            <span className="text-[10px] text-gray-400 break-all max-w-[150px] text-center block mt-1" dir="ltr">{verificationUrl}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-gray-500 border-t border-gray-200 pt-3">
        <p>تم إنشاء هذا الكارت إلكترونيًا بتاريخ {card.generated_at ? new Date(card.generated_at * 1000).toLocaleDateString('ar-SY') : '—'}</p>
        <p className="mt-1">للتحقق من صحة الكارت، امسح رمز QR أو ادخل رمز التحقق على الموقع</p>
      </div>
    </div>
  );
}
