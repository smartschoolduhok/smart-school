import { useState, useEffect, useCallback } from 'react';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import {
  getTreasurySummary, getTreasuryTransactions, createTreasuryTransaction,
  cancelTreasuryTransaction, getTreasuryClosings, closeTreasuryDay,
  getTreasuryDailyReport, getTreasuryMonthlyReport, getTreasuryCategories,
} from '../../lib/api';
import {
  Wallet, Plus, Search, Trash2, X, DollarSign, Calendar,
  CheckCircle, AlertTriangle, ArrowRight, BarChart3, TrendingUp,
  TrendingDown, Layers, Lock, FileText
} from 'lucide-react';

// Arabic-Indic digit converter
function toArabicIndic(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return '';
  return String(num).replace(/\d/g, d => String.fromCharCode(0x0660 + parseInt(d, 10)));
}

function formatDate(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('ar-IQ');
}

function formatMoney(amount: number | null, currency = 'IQD'): string {
  if (amount === null || amount === undefined) return '-';
  return `${toArabicIndic(amount.toLocaleString('en-US'))} ${currency}`;
}

type TabKey = 'dashboard' | 'transactions' | 'add' | 'closings' | 'reports';

interface TxRecord {
  id: number;
  transaction_type: 'income' | 'expense';
  category: string;
  amount: number;
  currency: string;
  description: string | null;
  source_type: string | null;
  status: string;
  created_at: number;
  created_by_name?: string | null;
}

interface ClosingRecord {
  id: number;
  closing_date: string;
  opening_balance: number;
  total_income: number;
  total_expense: number;
  closing_balance: number;
  transaction_count: number;
  closed_by_name?: string;
  closed_at: number;
}

interface ReportRow {
  type: 'income' | 'expense';
  category_name: string;
  count: number;
  total: number;
}

interface MonthlyRow {
  month: string;
  income: number;
  expense: number;
  net: number;
}

interface CategoryOption {
  id: number;
  name: string;
  type: 'income' | 'expense';
  is_system: boolean;
}

export default function TreasuryPage() {
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dashboard
  const [summary, setSummary] = useState<any>(null);

  // Transactions list
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [txFilters, setTxFilters] = useState({ type: '', category: '', status: '', date_from: '', date_to: '' });
  const [txMeta, setTxMeta] = useState({ total: 0, limit: 50, offset: 0 });

  // Add transaction
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [newTx, setNewTx] = useState({
    transaction_type: 'income' as 'income' | 'expense',
    category: '',
    amount: '',
    currency: 'IQD',
    description: '',
  });

  // Closings
  const [closings, setClosings] = useState<ClosingRecord[]>([]);

  // Reports
  const [reportType, setReportType] = useState<'daily' | 'monthly'>('daily');
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [reportMonth, setReportMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dailyReport, setDailyReport] = useState<ReportRow[]>([]);
  const [monthlyReport, setMonthlyReport] = useState<MonthlyRow[]>([]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }, []);

  const showSuccess = useCallback((msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 5000);
  }, []);

  const loadSummary = useCallback(async () => {
    if (schoolId == null) { setSummary(null); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getTreasurySummary(schoolId);
    if (!isCurrent()) return;
    if (res.data) setSummary(res.data);
    setLoading(false);
  }, [schoolId]);

  const loadTransactions = useCallback(async () => {
    if (schoolId == null) { setTransactions([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const filters: any = { school_id: schoolId, limit: txMeta.limit, offset: txMeta.offset };
    if (txFilters.type) filters.type = txFilters.type;
    if (txFilters.category) filters.category = txFilters.category;
    if (txFilters.status) filters.status = txFilters.status;
    if (txFilters.date_from) filters.date_from = Math.floor(new Date(txFilters.date_from).getTime() / 1000);
    if (txFilters.date_to) filters.date_to = Math.floor(new Date(txFilters.date_to).getTime() / 1000) + 86400;
    const res = await getTreasuryTransactions(filters);
    if (!isCurrent()) return;
    if (res.data) {
      setTransactions(res.data as TxRecord[]);
      if (res.meta) setTxMeta(prev => ({ ...prev, total: res.meta!.total }));
    }
    setLoading(false);
  }, [schoolId, txFilters, txMeta.limit, txMeta.offset]);

  const loadCategories = useCallback(async () => {
    const res = await getTreasuryCategories();
    if (res.data) setCategories(res.data as CategoryOption[]);
  }, []);

  const loadClosings = useCallback(async () => {
    if (schoolId == null) { setClosings([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getTreasuryClosings(schoolId);
    if (!isCurrent()) return;
    if (res.data) setClosings(res.data as ClosingRecord[]);
    setLoading(false);
  }, [schoolId]);

  const loadDailyReport = useCallback(async () => {
    if (schoolId == null) { setDailyReport([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getTreasuryDailyReport(schoolId, reportDate);
    if (!isCurrent()) return;
    if (res.data && res.data.by_category) setDailyReport(res.data.by_category as ReportRow[]);
    setLoading(false);
  }, [schoolId, reportDate]);

  const loadMonthlyReport = useCallback(async () => {
    if (schoolId == null) { setMonthlyReport([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getTreasuryMonthlyReport(schoolId, reportMonth);
    if (!isCurrent()) return;
    if (res.data && res.data.daily_breakdown) setMonthlyReport(res.data.daily_breakdown as MonthlyRow[]);
    setLoading(false);
  }, [schoolId, reportMonth]);

  useEffect(() => {
    setSummary(null);
    setTransactions([]);
    setClosings([]);
    setDailyReport([]);
    setMonthlyReport([]);
    setTxFilters({ type: '', category: '', status: '', date_from: '', date_to: '' });
    setTxMeta({ total: 0, limit: 50, offset: 0 });
    setNewTx({ transaction_type: 'income', category: '', amount: '', currency: 'IQD', description: '' });
    setLoading(false);
    setError(null);
    setSuccess(null);
  }, [schoolId]);

  useEffect(() => {
    if (activeTab === 'dashboard') loadSummary();
    if (activeTab === 'transactions') loadTransactions();
    if (activeTab === 'add') loadCategories();
    if (activeTab === 'closings') loadClosings();
    if (activeTab === 'reports') {
      if (reportType === 'daily') loadDailyReport();
      else loadMonthlyReport();
    }
  }, [activeTab, loadSummary, loadTransactions, loadCategories, loadClosings, loadDailyReport, loadMonthlyReport, reportType]);

  async function handleAddTx(e: React.FormEvent) {
    e.preventDefault();
    if (schoolId == null) { showError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!newTx.category || !newTx.amount) { showError('التصنيف والمبلغ مطلوبان'); return; }
    const isCurrent = captureSchoolRequest();
    const res = await createTreasuryTransaction({
      school_id: schoolId,
      transaction_type: newTx.transaction_type,
      category: newTx.category,
      amount: Number(newTx.amount),
      currency: newTx.currency,
      description: newTx.description,
    });
    if (!isCurrent()) return;
    if (res.error) { showError(res.error); }
    else {
      showSuccess('تم إضافة القيد المالي بنجاح');
      setNewTx({ transaction_type: 'income', category: '', amount: '', currency: 'IQD', description: '' });
      setActiveTab('transactions');
    }
  }

  async function handleCancelTx(id: number) {
    if (schoolId == null) return;
    if (!confirm('هل أنت متأكد من إلغاء هذا القيد؟')) return;
    const isCurrent = captureSchoolRequest();
    const res = await cancelTreasuryTransaction(id, schoolId, 'إلغاء يدوي من واجهة الخزنة');
    if (!isCurrent()) return;
    if (res.error) { showError(res.error); }
    else { showSuccess('تم إلغاء القيد بنجاح'); loadTransactions(); }
  }

  async function handleCloseDay() {
    if (schoolId == null) { showError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!confirm('هل أنت متأكد من إغلاق اليوم المالي؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    const isCurrent = captureSchoolRequest();
    const res = await closeTreasuryDay({ school_id: schoolId, closing_date: new Date().toISOString().split('T')[0] });
    if (!isCurrent()) return;
    if (res.error) { showError(res.error); }
    else { showSuccess('تم إغلاق اليوم المالي بنجاح'); loadClosings(); }
  }

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'لوحة الخزنة', icon: <Wallet size={18} /> },
    { key: 'transactions', label: 'القيود المالية', icon: <Layers size={18} /> },
    { key: 'add', label: 'إضافة وارد / مصروف', icon: <Plus size={18} /> },
    { key: 'closings', label: 'إغلاق اليوم المالي', icon: <Lock size={18} /> },
    { key: 'reports', label: 'التقارير', icon: <BarChart3 size={18} /> },
  ];

  const incomeCategories = categories.filter(c => c.type === 'income');
  const expenseCategories = categories.filter(c => c.type === 'expense');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
          <Wallet className="text-primary-600" size={28} />
          الخزنة والواردات والمصروفات
        </h1>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {/* Notifications */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-red-700">
          <AlertTriangle size={20} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="mr-auto"><X size={16} /></button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3 text-green-700">
          <CheckCircle size={20} />
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="mr-auto"><X size={16} /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Dashboard */}
      {activeTab === 'dashboard' && summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                <Wallet className="text-blue-600" size={20} />
              </div>
              <p className="text-sm text-gray-500">الرصيد المؤكد</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{formatMoney(summary.verified_balance)}</p>
            {!summary.balance_sync && <p className="text-xs text-amber-600 mt-1">الرصيد المخزن غير متزامن</p>}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                <TrendingUp className="text-green-600" size={20} />
              </div>
              <p className="text-sm text-gray-500">وارد اليوم</p>
            </div>
            <p className="text-2xl font-bold text-green-700">{formatMoney(summary.today_income)}</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
                <TrendingDown className="text-red-600" size={20} />
              </div>
              <p className="text-sm text-gray-500">مصروف اليوم</p>
            </div>
            <p className="text-2xl font-bold text-red-700">{formatMoney(summary.today_expense)}</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                <DollarSign className="text-amber-600" size={20} />
              </div>
              <p className="text-sm text-gray-500">صافي اليوم</p>
            </div>
            <p className={`text-2xl font-bold ${summary.today_net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {formatMoney(summary.today_net)}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 md:col-span-2">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
                <FileText className="text-purple-600" size={20} />
              </div>
              <p className="text-sm text-gray-500">قيود اليوم</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{toArabicIndic(summary.today_transaction_count)}</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 md:col-span-2">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
                <AlertTriangle className="text-orange-600" size={20} />
              </div>
              <p className="text-sm text-gray-500">أقساط معلقة</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{toArabicIndic(summary.pending_fees_count)}</p>
          </div>
        </div>
      )}

      {/* Transactions List */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
            <select
              value={txFilters.type}
              onChange={e => setTxFilters(prev => ({ ...prev, type: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">كل الأنواع</option>
              <option value="income">وارد</option>
              <option value="expense">مصروف</option>
            </select>
            <input
              type="text"
              placeholder="التصنيف"
              value={txFilters.category}
              onChange={e => setTxFilters(prev => ({ ...prev, category: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={txFilters.status}
              onChange={e => setTxFilters(prev => ({ ...prev, status: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="cancelled">ملغى</option>
            </select>
            <input
              type="date"
              placeholder="من"
              value={txFilters.date_from}
              onChange={e => setTxFilters(prev => ({ ...prev, date_from: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="date"
              placeholder="إلى"
              value={txFilters.date_to}
              onChange={e => setTxFilters(prev => ({ ...prev, date_to: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => { setTxMeta(prev => ({ ...prev, offset: 0 })); loadTransactions(); }}
              className="md:col-span-5 bg-primary-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
            >
              <Search size={16} />
              تصفية
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">النوع</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">التصنيف</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">المبلغ</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">الوصف</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">المصدر</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">الحالة</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">التاريخ</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.map(tx => (
                  <tr key={tx.id} className={tx.status === 'cancelled' ? 'bg-gray-50 opacity-60' : ''}>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        tx.transaction_type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {tx.transaction_type === 'income' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {tx.transaction_type === 'income' ? 'وارد' : 'مصروف'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{tx.category}</td>
                    <td className="px-4 py-3 font-medium">{formatMoney(tx.amount, tx.currency)}</td>
                    <td className="px-4 py-3 text-gray-500">{tx.description || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{tx.source_type || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        tx.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {tx.status === 'active' ? 'نشط' : 'ملغى'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(tx.created_at)}</td>
                    <td className="px-4 py-3">
                      {tx.status === 'active' && tx.source_type !== 'fee_payment' && (
                        <button
                          onClick={() => handleCancelTx(tx.id)}
                          className="text-red-600 hover:text-red-800 transition-colors"
                          title="إلغاء"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      لا توجد قيود مالية
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {txMeta.total > txMeta.limit && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setTxMeta(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                disabled={txMeta.offset === 0}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50"
              >
                السابق
              </button>
              <span className="text-sm text-gray-500">
                {toArabicIndic(txMeta.offset + 1)} - {toArabicIndic(Math.min(txMeta.offset + txMeta.limit, txMeta.total))} من {toArabicIndic(txMeta.total)}
              </span>
              <button
                onClick={() => setTxMeta(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
                disabled={txMeta.offset + txMeta.limit >= txMeta.total}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50"
              >
                التالي
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add Transaction */}
      {activeTab === 'add' && (
        <form onSubmit={handleAddTx} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">نوع القيد</label>
              <select
                value={newTx.transaction_type}
                onChange={e => setNewTx(prev => ({ ...prev, transaction_type: e.target.value as 'income' | 'expense', category: '' }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="income">وارد</option>
                <option value="expense">مصروف</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">التصنيف</label>
              <select
                value={newTx.category}
                onChange={e => setNewTx(prev => ({ ...prev, category: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                required
              >
                <option value="">اختر التصنيف</option>
                {(newTx.transaction_type === 'income' ? incomeCategories : expenseCategories).map(cat => (
                  <option key={cat.id} value={cat.name}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ (د.ع)</label>
              <input
                type="number"
                value={newTx.amount}
                onChange={e => setNewTx(prev => ({ ...prev, amount: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                required
                min={1}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">العملة</label>
              <select
                value={newTx.currency}
                onChange={e => setNewTx(prev => ({ ...prev, currency: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="IQD">دينار عراقي (IQD)</option>
                <option value="USD">دولار أمريكي (USD)</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">الوصف</label>
              <textarea
                value={newTx.description}
                onChange={e => setNewTx(prev => ({ ...prev, description: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                rows={3}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => setActiveTab('transactions')}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors flex items-center gap-2"
            >
              <Plus size={16} />
              إضافة القيد
            </button>
          </div>
        </form>
      )}

      {/* Closings */}
      {activeTab === 'closings' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={handleCloseDay}
              className="bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-amber-700 transition-colors flex items-center gap-2"
            >
              <Lock size={16} />
              إغلاق اليوم المالي
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">تاريخ الإغلاق</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">الرصيد الافتتاحي</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">الوارد</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">المصروف</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">الرصيد الختامي</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">عدد القيود</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">أغلقه</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {closings.map(c => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 text-gray-700">{c.closing_date}</td>
                    <td className="px-4 py-3">{formatMoney(c.opening_balance)}</td>
                    <td className="px-4 py-3 text-green-700">{formatMoney(c.total_income)}</td>
                    <td className="px-4 py-3 text-red-700">{formatMoney(c.total_expense)}</td>
                    <td className="px-4 py-3 font-bold">{formatMoney(c.closing_balance)}</td>
                    <td className="px-4 py-3">{toArabicIndic(c.transaction_count)}</td>
                    <td className="px-4 py-3 text-gray-500">{c.closed_by_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(c.closed_at)}</td>
                  </tr>
                ))}
                {closings.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      لا توجد إغلاقات مالية
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reports */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <button
              onClick={() => setReportType('daily')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                reportType === 'daily' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              تقرير يومي
            </button>
            <button
              onClick={() => setReportType('monthly')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                reportType === 'monthly' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              تقرير شهري
            </button>
          </div>

          {reportType === 'daily' && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={reportDate}
                  onChange={e => setReportDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2"
                />
                <button
                  onClick={loadDailyReport}
                  className="bg-primary-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-700 transition-colors"
                >
                  عرض التقرير
                </button>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-right px-4 py-3 font-medium text-gray-700">النوع</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-700">التصنيف</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-700">العدد</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-700">المجموع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dailyReport.map((row, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            row.type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {row.type === 'income' ? 'وارد' : 'مصروف'}
                          </span>
                        </td>
                        <td className="px-4 py-3">{row.category_name}</td>
                        <td className="px-4 py-3">{toArabicIndic(row.count)}</td>
                        <td className="px-4 py-3 font-medium">{formatMoney(row.total)}</td>
                      </tr>
                    ))}
                    {dailyReport.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                          لا توجد بيانات لهذا اليوم
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportType === 'monthly' && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="month"
                  value={reportMonth}
                  onChange={e => setReportMonth(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2"
                />
                <button
                  onClick={loadMonthlyReport}
                  className="bg-primary-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-700 transition-colors"
                >
                  عرض التقرير
                </button>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-right px-4 py-3 font-medium text-gray-700">الشهر</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-700">الوارد</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-700">المصروف</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-700">الصافي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {monthlyReport.map((row, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-3">{row.month}</td>
                        <td className="px-4 py-3 text-green-700">{formatMoney(row.income)}</td>
                        <td className="px-4 py-3 text-red-700">{formatMoney(row.expense)}</td>
                        <td className={`px-4 py-3 font-bold ${row.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatMoney(row.net)}
                        </td>
                      </tr>
                    ))}
                    {monthlyReport.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                          لا توجد بيانات لهذا الشهر
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
