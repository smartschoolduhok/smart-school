import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, BarChart3, CheckCircle, ChevronRight, Layers, Lock, Plus,
  Search, Trash2, TrendingDown, TrendingUp, Wallet, X,
} from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import {
  cancelTreasuryTransaction, closeTreasuryDay, createTreasuryTransaction,
  getTreasuryCategories, getTreasuryClosings, getTreasuryDailyReport,
  getTreasuryMonthlyReport, getTreasurySummary, getTreasuryTransactions,
} from '../../lib/api';
import { BUSINESS_TIME_ZONE_LABEL, businessDate, businessMonth } from '../../lib/businessTime';

function toArabicIndic(value: number | string | null | undefined): string {
  if (value == null) return '';
  return String(value).replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit)));
}

function formatTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) return '-';
  return new Date(timestamp * 1000).toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' });
}

function formatMoney(amount: number | null | undefined): string {
  if (amount == null) return '-';
  return `${toArabicIndic(amount.toLocaleString('en-US'))} د.ع`;
}

const sourceLabels: Record<string, string> = {
  manual: 'يدوي', fee_payment: 'دفعة قسط', salary_payment: 'دفع راتب',
};

type TabKey = 'dashboard' | 'transactions' | 'add' | 'closings' | 'reports';
interface TreasurySummary {
  business_date: string; business_timezone: string; verified_balance: number;
  cached_balance: number; balance_sync: boolean; today_income: number;
  today_expense: number; today_net: number; today_transaction_count: number;
  pending_fees_count: number; today_closed: boolean; payroll_integrity: boolean;
  payroll_unhealthy_count: number;
}
interface TxRecord {
  id: number; transaction_type: 'income' | 'expense'; category: string;
  amount: number; currency: string; description: string | null;
  source_type: string | null; status: 'active' | 'cancelled';
  business_date: string; created_at: number; created_by_name?: string | null;
}
interface ClosingRecord {
  id: number; closing_date: string; opening_balance: number; total_income: number;
  total_expense: number; closing_balance: number; transaction_count: number;
  closed_by_name?: string; created_at: number;
}
interface ReportSummary { total_income: number; total_expense: number; net: number; transaction_count: number }
interface DailyReport {
  date: string; closed: boolean; summary: ReportSummary;
  by_category: Array<{ transaction_type: 'income' | 'expense'; category: string; count: number; total: number }>;
}
interface MonthlyReport {
  month_key: string; closing_count: number; summary: ReportSummary;
  daily_breakdown: Array<{ day: string; income: number; expense: number; net: number; count: number }>;
}
interface CategoryOption { id: number; name: string; name_ar?: string; type: 'income' | 'expense' }
const newRequestId = () => `treasury-${crypto.randomUUID()}`;

export default function TreasuryPage() {
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [summary, setSummary] = useState<TreasurySummary | null>(null);
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [txFilters, setTxFilters] = useState({ type: '', category: '', status: '', date_from: '', date_to: '' });
  const [txMeta, setTxMeta] = useState({ total: 0, limit: 50, offset: 0 });
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [manualRequestId, setManualRequestId] = useState(newRequestId);
  const [newTx, setNewTx] = useState({
    transaction_type: 'income' as 'income' | 'expense', category: '', amount: '',
    business_date: businessDate(), description: '',
  });
  const [closings, setClosings] = useState<ClosingRecord[]>([]);
  const [closingDate, setClosingDate] = useState(businessDate);
  const [closingNotes, setClosingNotes] = useState('');
  const [reportType, setReportType] = useState<'daily' | 'monthly'>('daily');
  const [reportDate, setReportDate] = useState(businessDate);
  const [reportMonth, setReportMonth] = useState(businessMonth);
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null);
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReport | null>(null);

  const showError = useCallback((message: string) => {
    setError(message); window.setTimeout(() => setError(null), 6000);
  }, []);
  const showSuccess = useCallback((message: string) => {
    setSuccess(message); window.setTimeout(() => setSuccess(null), 5000);
  }, []);

  const loadSummary = useCallback(async () => {
    if (schoolId == null) { setSummary(null); return; }
    const isCurrent = captureSchoolRequest(); setLoading(true);
    const response = await getTreasurySummary(schoolId);
    if (!isCurrent()) return;
    if (response.data) setSummary(response.data as TreasurySummary);
    else if (response.error) showError(response.error);
    setLoading(false);
  }, [captureSchoolRequest, schoolId, showError]);

  const loadTransactions = useCallback(async () => {
    if (schoolId == null) { setTransactions([]); return; }
    const isCurrent = captureSchoolRequest(); setLoading(true);
    const response = await getTreasuryTransactions({
      school_id: schoolId, type: txFilters.type || null,
      category: txFilters.category || null, status: txFilters.status || null,
      from: txFilters.date_from || null, to: txFilters.date_to || null,
      limit: txMeta.limit, offset: txMeta.offset,
    });
    if (!isCurrent()) return;
    if (response.data) {
      setTransactions(response.data as TxRecord[]);
      setTxMeta((current) => ({ ...current, total: response.meta?.total || 0 }));
    } else if (response.error) showError(response.error);
    setLoading(false);
  }, [captureSchoolRequest, schoolId, showError, txFilters, txMeta.limit, txMeta.offset]);

  const loadCategories = useCallback(async () => {
    const response = await getTreasuryCategories(schoolId);
    if (response.data) setCategories(response.data as CategoryOption[]);
  }, [schoolId]);

  const loadClosings = useCallback(async () => {
    if (schoolId == null) { setClosings([]); return; }
    const isCurrent = captureSchoolRequest(); setLoading(true);
    const response = await getTreasuryClosings(schoolId);
    if (!isCurrent()) return;
    if (response.data) setClosings(response.data as ClosingRecord[]);
    else if (response.error) showError(response.error);
    setLoading(false);
  }, [captureSchoolRequest, schoolId, showError]);

  const loadDailyReport = useCallback(async () => {
    if (schoolId == null) { setDailyReport(null); return; }
    const isCurrent = captureSchoolRequest(); setLoading(true);
    const response = await getTreasuryDailyReport(schoolId, reportDate);
    if (!isCurrent()) return;
    if (response.data) setDailyReport(response.data as unknown as DailyReport);
    else if (response.error) showError(response.error);
    setLoading(false);
  }, [captureSchoolRequest, reportDate, schoolId, showError]);

  const loadMonthlyReport = useCallback(async () => {
    if (schoolId == null) { setMonthlyReport(null); return; }
    const isCurrent = captureSchoolRequest(); setLoading(true);
    const [year, month] = reportMonth.split('-');
    const response = await getTreasuryMonthlyReport(schoolId, month, year);
    if (!isCurrent()) return;
    if (response.data) setMonthlyReport(response.data as unknown as MonthlyReport);
    else if (response.error) showError(response.error);
    setLoading(false);
  }, [captureSchoolRequest, reportMonth, schoolId, showError]);

  useEffect(() => {
    setActiveTab('dashboard'); setSummary(null); setTransactions([]); setClosings([]);
    setDailyReport(null); setMonthlyReport(null);
    setTxFilters({ type: '', category: '', status: '', date_from: '', date_to: '' });
    setTxMeta({ total: 0, limit: 50, offset: 0 });
    setNewTx({ transaction_type: 'income', category: '', amount: '', business_date: businessDate(), description: '' });
    setManualRequestId(newRequestId()); setClosingDate(businessDate()); setClosingNotes('');
    setError(null); setSuccess(null);
  }, [schoolId]);

  useEffect(() => {
    if (activeTab === 'dashboard') void loadSummary();
    if (activeTab === 'transactions') void loadTransactions();
    if (activeTab === 'add') void loadCategories();
    if (activeTab === 'closings') void loadClosings();
    if (activeTab === 'reports' && reportType === 'daily') void loadDailyReport();
    if (activeTab === 'reports' && reportType === 'monthly') void loadMonthlyReport();
  }, [activeTab, loadCategories, loadClosings, loadDailyReport, loadMonthlyReport, loadSummary, loadTransactions, reportType]);

  function changeDraft(patch: Partial<typeof newTx>) {
    setNewTx((current) => ({ ...current, ...patch })); setManualRequestId(newRequestId());
  }

  async function handleAddTx(event: React.FormEvent) {
    event.preventDefault();
    if (schoolId == null) { showError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!newTx.category || !newTx.amount) { showError('التصنيف والمبلغ مطلوبان'); return; }
    const isCurrent = captureSchoolRequest(); setSubmitting(true);
    const response = await createTreasuryTransaction({
      school_id: schoolId, transaction_type: newTx.transaction_type,
      category: newTx.category, amount: Number(newTx.amount), currency: 'IQD',
      business_date: newTx.business_date, description: newTx.description,
      client_request_id: manualRequestId,
    });
    if (!isCurrent()) return;
    setSubmitting(false);
    if (response.error) { showError(response.error); return; }
    showSuccess(response.data?.replayed ? 'القيد موجود مسبقاً؛ لم يتكرر أثره المالي' : 'تمت إضافة القيد المالي');
    setNewTx({ transaction_type: 'income', category: '', amount: '', business_date: businessDate(), description: '' });
    setManualRequestId(newRequestId()); setActiveTab('transactions');
  }

  async function handleCancelTx(id: number) {
    if (schoolId == null) return;
    const reason = window.prompt('اكتب سبب إلغاء القيد المالي:')?.trim();
    if (!reason || !window.confirm('سيُعكس أثر القيد مرة واحدة، ولن يمكن تعديل فترة مقفلة. هل تريد المتابعة؟')) return;
    const isCurrent = captureSchoolRequest(); setSubmitting(true);
    const response = await cancelTreasuryTransaction(id, schoolId, reason);
    if (!isCurrent()) return;
    setSubmitting(false);
    if (response.error) { showError(response.error); return; }
    showSuccess(response.data?.salary_status_synchronized ? 'أُلغي القيد وتزامنت حالة الراتب' : 'أُلغي القيد وعُكس أثره المالي');
    await loadTransactions();
  }

  async function handleCloseDay() {
    if (schoolId == null) { showError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!window.confirm(`إقفال يوم ${closingDate} يمنع إضافة أو إلغاء أي حركة في هذا اليوم وما قبله. هل تريد المتابعة؟`)) return;
    const isCurrent = captureSchoolRequest(); setSubmitting(true);
    const response = await closeTreasuryDay({ school_id: schoolId, closing_date: closingDate, notes: closingNotes });
    if (!isCurrent()) return;
    setSubmitting(false);
    if (response.error) { showError(response.error); return; }
    showSuccess(`تم إقفال ${closingDate} برصيد ختامي ${formatMoney(response.data?.closing_balance)}`);
    setClosingNotes(''); await Promise.all([loadClosings(), loadSummary()]);
  }

  const tabs: Array<{ key: Exclude<TabKey, 'add'>; label: string; icon: React.ReactNode }> = [
    { key: 'dashboard', label: 'الملخص', icon: <Wallet size={18} /> },
    { key: 'transactions', label: 'القيود', icon: <Layers size={18} /> },
    { key: 'closings', label: 'الإقفالات', icon: <Lock size={18} /> },
    { key: 'reports', label: 'التقارير', icon: <BarChart3 size={18} /> },
  ];
  const availableCategories = categories.filter((category) => category.type === newTx.transaction_type);
  const reportSummary = reportType === 'daily' ? dailyReport?.summary : monthlyReport?.summary;

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="flex items-center gap-3 text-2xl font-bold text-gray-900"><Wallet className="text-primary-600" size={28} />الخزنة</h1><p className="mt-1 text-sm text-gray-500">تاريخ العمل: {businessDate()} — {BUSINESS_TIME_ZONE_LABEL}</p></div>
      {schoolId != null && activeTab !== 'add' && <button type="button" onClick={() => setActiveTab('add')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"><Plus size={17} /> إضافة قيد</button>}
    </div>
    <SystemAdminSchoolSelector {...schoolScope} />
    {error && <div role="alert" className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"><AlertTriangle size={20} /><span>{error}</span><button type="button" onClick={() => setError(null)} className="mr-auto" aria-label="إغلاق التنبيه"><X size={16} /></button></div>}
    {success && <div role="status" className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700"><CheckCircle size={20} /><span>{success}</span><button type="button" onClick={() => setSuccess(null)} className="mr-auto" aria-label="إغلاق الرسالة"><X size={16} /></button></div>}

    {activeTab !== 'add' && <div className="flex gap-2 overflow-x-auto border-b border-gray-200" aria-label="أقسام الخزنة">{tabs.map((tab) => <button type="button" key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${activeTab === tab.key ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tab.icon}{tab.label}</button>)}</div>}
    {loading && <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" aria-label="جار التحميل" />}

    {!loading && activeTab === 'dashboard' && summary && <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${summary.today_closed ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800'}`}><div className="flex items-center gap-2 font-semibold">{summary.today_closed ? <Lock size={18} /> : <CheckCircle size={18} />}{summary.today_closed ? `يوم ${summary.business_date} مقفل` : `يوم ${summary.business_date} مفتوح`}</div><p className="mt-1 text-sm">{BUSINESS_TIME_ZONE_LABEL}. {summary.today_closed ? 'لا يمكن إضافة أو إلغاء قيود ضمن الفترة المقفلة.' : 'يمكن تسجيل حركات اليوم ثم إقفاله بعد المطابقة.'}</p></div>
      {(!summary.balance_sync || !summary.payroll_integrity) && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">تحتاج البيانات إلى مراجعة محاسبية قبل عمليات مالية جديدة:{!summary.balance_sync && ' الرصيد المخزن لا يطابق دفتر القيود.'}{!summary.payroll_integrity && ` ${toArabicIndic(summary.payroll_unhealthy_count)} راتب لا يطابق قيد الخزنة.`}</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard title="الرصيد المؤكد" value={formatMoney(summary.verified_balance)} icon={<Wallet size={20} />} tone="blue" /><SummaryCard title="وارد اليوم" value={formatMoney(summary.today_income)} icon={<TrendingUp size={20} />} tone="green" /><SummaryCard title="مصروف اليوم" value={formatMoney(summary.today_expense)} icon={<TrendingDown size={20} />} tone="red" /><SummaryCard title="صافي اليوم" value={formatMoney(summary.today_net)} icon={<BarChart3 size={20} />} tone={summary.today_net >= 0 ? 'green' : 'red'} /><SummaryCard title="قيود اليوم" value={toArabicIndic(summary.today_transaction_count)} icon={<Layers size={20} />} tone="purple" /><SummaryCard title="أقساط معلقة" value={toArabicIndic(summary.pending_fees_count)} icon={<AlertTriangle size={20} />} tone="amber" /></div>
    </div>}

    {!loading && activeTab === 'transactions' && <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-5">
        <select aria-label="نوع القيد" value={txFilters.type} onChange={(e) => setTxFilters((v) => ({ ...v, type: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">كل الأنواع</option><option value="income">وارد</option><option value="expense">مصروف</option></select>
        <input aria-label="التصنيف" placeholder="التصنيف" value={txFilters.category} onChange={(e) => setTxFilters((v) => ({ ...v, category: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select aria-label="حالة القيد" value={txFilters.status} onChange={(e) => setTxFilters((v) => ({ ...v, status: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">كل الحالات</option><option value="active">فعال</option><option value="cancelled">ملغى</option></select>
        <input aria-label="من تاريخ العمل" type="date" value={txFilters.date_from} onChange={(e) => setTxFilters((v) => ({ ...v, date_from: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input aria-label="إلى تاريخ العمل" type="date" value={txFilters.date_to} onChange={(e) => setTxFilters((v) => ({ ...v, date_to: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <button type="button" onClick={() => { setTxMeta((v) => ({ ...v, offset: 0 })); void loadTransactions(); }} className="flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white md:col-span-5"><Search size={16} /> تطبيق المرشحات</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="min-w-[900px] w-full text-sm"><thead className="bg-gray-50 text-gray-700"><tr><th className="px-4 py-3 text-right font-medium">النوع</th><th className="px-4 py-3 text-right font-medium">التصنيف</th><th className="px-4 py-3 text-right font-medium">المبلغ</th><th className="px-4 py-3 text-right font-medium">الوصف</th><th className="px-4 py-3 text-right font-medium">المصدر</th><th className="px-4 py-3 text-right font-medium">الحالة</th><th className="px-4 py-3 text-right font-medium">تاريخ العمل</th><th className="px-4 py-3 text-right font-medium">الإجراء</th></tr></thead><tbody className="divide-y divide-gray-100">
        {transactions.map((tx) => <tr key={tx.id} className={tx.status === 'cancelled' ? 'bg-gray-50 text-gray-500' : ''}><td className="px-4 py-3"><TypeBadge type={tx.transaction_type} /></td><td className="px-4 py-3">{tx.category}</td><td className="px-4 py-3 font-medium">{formatMoney(tx.amount)}</td><td className="max-w-xs px-4 py-3 text-gray-600">{tx.description || '-'}</td><td className="px-4 py-3">{sourceLabels[tx.source_type || ''] || tx.source_type || '-'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${tx.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{tx.status === 'active' ? 'فعال' : 'ملغى'}</span></td><td className="px-4 py-3"><div>{tx.business_date}</div><div className="text-xs text-gray-400">{formatTimestamp(tx.created_at)}</div></td><td className="px-4 py-3">{tx.status === 'active' && tx.source_type !== 'fee_payment' && <button type="button" disabled={submitting} onClick={() => void handleCancelTx(tx.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50" title="إلغاء القيد"><Trash2 size={17} /></button>}</td></tr>)}
        {transactions.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">لا توجد قيود مطابقة</td></tr>}
      </tbody></table></div>
      {txMeta.total > txMeta.limit && <div className="flex items-center justify-between text-sm"><button type="button" disabled={txMeta.offset === 0} onClick={() => setTxMeta((v) => ({ ...v, offset: Math.max(0, v.offset - v.limit) }))} className="rounded-lg border px-3 py-2 disabled:opacity-50">السابق</button><span className="text-gray-500">{toArabicIndic(txMeta.offset + 1)}–{toArabicIndic(Math.min(txMeta.offset + txMeta.limit, txMeta.total))} من {toArabicIndic(txMeta.total)}</span><button type="button" disabled={txMeta.offset + txMeta.limit >= txMeta.total} onClick={() => setTxMeta((v) => ({ ...v, offset: v.offset + v.limit }))} className="rounded-lg border px-3 py-2 disabled:opacity-50">التالي</button></div>}
    </div>}

    {!loading && activeTab === 'add' && <form onSubmit={handleAddTx} className="mx-auto max-w-2xl space-y-5 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-gray-900">إضافة قيد مالي</h2><p className="text-sm text-gray-500">المبالغ أعداد صحيحة بالدينار العراقي فقط.</p></div><button type="button" onClick={() => setActiveTab('transactions')} className="flex items-center gap-1 text-sm text-gray-600"><ChevronRight size={17} /> رجوع</button></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-gray-700">نوع القيد<select value={newTx.transaction_type} onChange={(e) => changeDraft({ transaction_type: e.target.value as 'income' | 'expense', category: '' })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="income">وارد</option><option value="expense">مصروف</option></select></label>
        <label className="text-sm font-medium text-gray-700">التصنيف<select required value={newTx.category} onChange={(e) => changeDraft({ category: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="">اختر التصنيف</option>{availableCategories.map((category) => <option key={category.id} value={category.name}>{category.name_ar || category.name}</option>)}</select></label>
        <label className="text-sm font-medium text-gray-700">المبلغ (د.ع)<input required type="number" inputMode="numeric" min={1} step={1} value={newTx.amount} onChange={(e) => changeDraft({ amount: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <label className="text-sm font-medium text-gray-700">تاريخ العمل ({BUSINESS_TIME_ZONE_LABEL})<input required type="date" max={businessDate()} value={newTx.business_date} onChange={(e) => changeDraft({ business_date: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <label className="text-sm font-medium text-gray-700 sm:col-span-2">الوصف<textarea maxLength={1000} rows={3} value={newTx.description} onChange={(e) => changeDraft({ description: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
      </div>
      <div className="flex justify-end gap-3"><button type="button" onClick={() => setActiveTab('transactions')} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">إلغاء</button><button type="submit" disabled={submitting} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Plus size={16} />{submitting ? 'جار الحفظ…' : 'حفظ القيد'}</button></div>
    </form>}

    {!loading && activeTab === 'closings' && <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 md:grid-cols-[180px_1fr_auto] md:items-end"><label className="text-sm font-medium text-amber-900">تاريخ الإقفال<input type="date" max={businessDate()} value={closingDate} onChange={(e) => setClosingDate(e.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><label className="text-sm font-medium text-amber-900">ملاحظة اختيارية<input maxLength={1000} value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} placeholder="مثال: تمت المطابقة مع النقد الموجود" className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" /></label><button type="button" disabled={submitting || !closingDate} onClick={() => void handleCloseDay()} className="flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Lock size={16} /> إقفال اليوم</button></div>
      <p className="text-sm text-gray-600">الإقفال يثبت الرصيد الافتتاحي وحركات اليوم ويمنع أي حركة لاحقة في التاريخ المقفل أو قبله.</p>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="min-w-[850px] w-full text-sm"><thead className="bg-gray-50 text-gray-700"><tr><th className="px-4 py-3 text-right font-medium">اليوم</th><th className="px-4 py-3 text-right font-medium">الافتتاحي</th><th className="px-4 py-3 text-right font-medium">الوارد</th><th className="px-4 py-3 text-right font-medium">المصروف</th><th className="px-4 py-3 text-right font-medium">الختامي</th><th className="px-4 py-3 text-right font-medium">القيود</th><th className="px-4 py-3 text-right font-medium">أغلقه</th><th className="px-4 py-3 text-right font-medium">وقت التسجيل</th></tr></thead><tbody className="divide-y divide-gray-100">
        {closings.map((closing) => <tr key={closing.id}><td className="px-4 py-3 font-medium">{closing.closing_date}</td><td className="px-4 py-3">{formatMoney(closing.opening_balance)}</td><td className="px-4 py-3 text-green-700">{formatMoney(closing.total_income)}</td><td className="px-4 py-3 text-red-700">{formatMoney(closing.total_expense)}</td><td className="px-4 py-3 font-bold">{formatMoney(closing.closing_balance)}</td><td className="px-4 py-3">{toArabicIndic(closing.transaction_count)}</td><td className="px-4 py-3">{closing.closed_by_name || '-'}</td><td className="px-4 py-3 text-gray-500">{formatTimestamp(closing.created_at)}</td></tr>)}
        {closings.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">لا توجد إقفالات مسجلة</td></tr>}
      </tbody></table></div>
    </div>}

    {!loading && activeTab === 'reports' && <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-end"><div className="flex rounded-lg bg-gray-100 p-1"><button type="button" onClick={() => setReportType('daily')} className={`rounded-md px-4 py-2 text-sm font-medium ${reportType === 'daily' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>يومي</button><button type="button" onClick={() => setReportType('monthly')} className={`rounded-md px-4 py-2 text-sm font-medium ${reportType === 'monthly' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`}>شهري</button></div>{reportType === 'daily' ? <input aria-label="يوم التقرير" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2" /> : <input aria-label="شهر التقرير" type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2" />}<button type="button" onClick={() => void (reportType === 'daily' ? loadDailyReport() : loadMonthlyReport())} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">تحديث التقرير</button><span className="text-xs text-gray-500 sm:mr-auto">{BUSINESS_TIME_ZONE_LABEL}</span></div>
      {reportSummary && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><MiniMetric label="الوارد" value={formatMoney(reportSummary.total_income)} tone="text-green-700" /><MiniMetric label="المصروف" value={formatMoney(reportSummary.total_expense)} tone="text-red-700" /><MiniMetric label="الصافي" value={formatMoney(reportSummary.net)} tone={reportSummary.net >= 0 ? 'text-green-700' : 'text-red-700'} /><MiniMetric label="عدد القيود" value={toArabicIndic(reportSummary.transaction_count)} tone="text-gray-900" /></div>}
      {reportType === 'daily' && dailyReport && <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><div className="border-b border-gray-100 px-4 py-3 text-sm text-gray-600">الحالة: {dailyReport.closed ? 'مقفل' : 'مفتوح'}</div><table className="min-w-[600px] w-full text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-3 text-right font-medium">النوع</th><th className="px-4 py-3 text-right font-medium">التصنيف</th><th className="px-4 py-3 text-right font-medium">العدد</th><th className="px-4 py-3 text-right font-medium">المجموع</th></tr></thead><tbody className="divide-y divide-gray-100">{dailyReport.by_category.map((row) => <tr key={`${row.transaction_type}-${row.category}`}><td className="px-4 py-3"><TypeBadge type={row.transaction_type} /></td><td className="px-4 py-3">{row.category}</td><td className="px-4 py-3">{toArabicIndic(row.count)}</td><td className="px-4 py-3 font-medium">{formatMoney(row.total)}</td></tr>)}{dailyReport.by_category.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-500">لا توجد حركات لهذا اليوم</td></tr>}</tbody></table></div>}
      {reportType === 'monthly' && monthlyReport && <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><div className="border-b border-gray-100 px-4 py-3 text-sm text-gray-600">عدد الأيام المقفلة في الشهر: {toArabicIndic(monthlyReport.closing_count)}</div><table className="min-w-[650px] w-full text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-3 text-right font-medium">اليوم</th><th className="px-4 py-3 text-right font-medium">الوارد</th><th className="px-4 py-3 text-right font-medium">المصروف</th><th className="px-4 py-3 text-right font-medium">الصافي</th><th className="px-4 py-3 text-right font-medium">القيود</th></tr></thead><tbody className="divide-y divide-gray-100">{monthlyReport.daily_breakdown.map((row) => <tr key={row.day}><td className="px-4 py-3 font-medium">{row.day}</td><td className="px-4 py-3 text-green-700">{formatMoney(row.income)}</td><td className="px-4 py-3 text-red-700">{formatMoney(row.expense)}</td><td className={`px-4 py-3 font-bold ${row.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatMoney(row.net)}</td><td className="px-4 py-3">{toArabicIndic(row.count)}</td></tr>)}{monthlyReport.daily_breakdown.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">لا توجد حركات لهذا الشهر</td></tr>}</tbody></table></div>}
    </div>}
  </div>;
}

function TypeBadge({ type }: { type: 'income' | 'expense' }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{type === 'income' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{type === 'income' ? 'وارد' : 'مصروف'}</span>;
}

function SummaryCard({ title, value, icon, tone }: { title: string; value: string; icon: React.ReactNode; tone: 'blue' | 'green' | 'red' | 'purple' | 'amber' }) {
  const tones = { blue: 'bg-blue-50 text-blue-600', green: 'bg-green-50 text-green-600', red: 'bg-red-50 text-red-600', purple: 'bg-purple-50 text-purple-600', amber: 'bg-amber-50 text-amber-600' };
  return <div className="rounded-xl border border-gray-200 bg-white p-5"><div className="mb-2 flex items-center gap-3"><div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</div><p className="text-sm text-gray-500">{title}</p></div><p className="text-2xl font-bold text-gray-900">{value}</p></div>;
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">{label}</p><p className={`mt-1 font-bold ${tone}`}>{value}</p></div>;
}
