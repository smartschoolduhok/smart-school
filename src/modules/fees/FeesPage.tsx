import { useState, useEffect, useCallback } from 'react';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import {
  getStudentFees, createStudentFee, updateStudentFee, deleteStudentFee,
  getFeePayments, createFeePayment, getFeeReceipts, generateFeeReceipt, cancelFeeReceipt,
  getStudents, getAcademicYears,
} from '../../lib/api';
import {
  CreditCard, Plus, Search, Trash2, Edit2, Save, X, DollarSign, Calendar,
  CheckCircle, AlertTriangle, XCircle, ArrowRight, Printer, QrCode, FileText,
  Wallet, GraduationCap, Layers, School, ChevronDown, ChevronUp, Ban
} from 'lucide-react';

// Arabic-Indic digit converter
function toArabicIndic(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return '';
  return String(num).replace(/\d/g, d => String.fromCharCode(0x0660 + parseInt(d, 10)));
}

type TabKey = 'list' | 'add' | 'payments' | 'receipts' | 'verify';

interface FeeRecord {
  id: number;
  student_id: number;
  student_name?: string;
  student_number?: string;
  class_name?: string;
  section_name?: string;
  fee_type: string;
  amount: number;
  paid_amount: number;
  currency: string;
  status: string;
  due_date: number | null;
  notes: string | null;
  created_at: string;
  academic_year_id?: number | null;
  net_fee?: number;
  discount_type?: string;
  discount_value?: number;
  discount_amount?: number;
}

interface PaymentRecord {
  id: number;
  student_fee_id: number;
  student_id: number;
  student_name?: string;
  amount: number;
  payment_method: string;
  payment_date: number;
  notes: string | null;
  created_at: string;
  created_by_name?: string;
}

interface ReceiptRecord {
  id: number;
  receipt_number: string;
  student_name_snapshot: string;
  total_amount: number;
  status: string;
  verification_token: string;
  created_at: string;
}

interface StudentOption {
  id: number;
  full_name: string;
  student_number: string;
  class_name?: string;
  section_name?: string;
}

export default function FeesPage() {
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [activeTab, setActiveTab] = useState<TabKey>('list');

  // Shared data
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [academicYears, setAcademicYears] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // List tab
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [feeSearch, setFeeSearch] = useState('');
  const [feeStatusFilter, setFeeStatusFilter] = useState('');

  // Add tab
  const [selectedStudent, setSelectedStudent] = useState<number | ''>('');
  const [feeType, setFeeType] = useState('رسوم دراسية');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EGP');
  const [dueDate, setDueDate] = useState('');
  const [feeNotes, setFeeNotes] = useState('');
  const [selectedYear, setSelectedYear] = useState<number | ''>('');
  const [discountType, setDiscountType] = useState<'none' | 'fixed' | 'percentage'>('none');
  const [discountValue, setDiscountValue] = useState('');

  // Payments tab
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentStudentFilter, setPaymentStudentFilter] = useState<number | ''>('');
  const [payFeeId, setPayFeeId] = useState<number | ''>('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [payNotes, setPayNotes] = useState('');

  // Receipts tab
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [selectedPayments, setSelectedPayments] = useState<number[]>([]);
  const [receiptStudentFilter, setReceiptStudentFilter] = useState<number | ''>('');

  // Verify tab
  const [verifyToken, setVerifyToken] = useState('');
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);

  // Edit modal
  const [editingFee, setEditingFee] = useState<FeeRecord | null>(null);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }, []);

  const showSuccess = useCallback((msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 5000);
  }, []);

  const loadStudents = useCallback(async () => {
    if (schoolId == null) { setStudents([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getStudents(schoolId);
    if (!isCurrent()) return;
    if (res.data) setStudents(res.data.filter((s: any) => s.status === 'active').map((s: any) => ({ id: s.id, full_name: s.full_name, student_number: s.student_number, class_name: s.class_name, section_name: s.section_name })));
  }, [schoolId]);

  const loadAcademicYears = useCallback(async () => {
    if (schoolId == null) { setAcademicYears([]); return; }
    const isCurrent = captureSchoolRequest();
    const res = await getAcademicYears(schoolId);
    if (!isCurrent()) return;
    if (res.data) setAcademicYears(res.data as any);
  }, [schoolId]);

  const loadFees = useCallback(async () => {
    if (schoolId == null) { setFees([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getStudentFees({ school_id: schoolId });
    if (!isCurrent()) return;
    if (res.data) setFees(res.data as any);
    setLoading(false);
  }, [schoolId]);

  const loadPayments = useCallback(async () => {
    if (schoolId == null) { setPayments([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getFeePayments({ school_id: schoolId, student_id: paymentStudentFilter || null });
    if (!isCurrent()) return;
    if (res.data) setPayments(res.data as any);
    setLoading(false);
  }, [schoolId, paymentStudentFilter]);

  const loadReceipts = useCallback(async () => {
    if (schoolId == null) { setReceipts([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const res = await getFeeReceipts({ school_id: schoolId, student_id: receiptStudentFilter || null });
    if (!isCurrent()) return;
    if (res.data) setReceipts(res.data as any);
    setLoading(false);
  }, [schoolId, receiptStudentFilter]);

  useEffect(() => {
    setStudents([]);
    setAcademicYears([]);
    setFees([]);
    setPayments([]);
    setReceipts([]);
    setSelectedStudent('');
    setPaymentStudentFilter('');
    setReceiptStudentFilter('');
    setSelectedPayments([]);
    setPayFeeId('');
    setSelectedYear('');
    setEditingFee(null);
    setLoading(false);
    setError(null);
    setSuccess(null);
    loadStudents();
    loadAcademicYears();
  }, [loadStudents, loadAcademicYears]);

  useEffect(() => {
    if (activeTab === 'list') loadFees();
    if (activeTab === 'payments') loadPayments();
    if (activeTab === 'receipts') loadReceipts();
  }, [activeTab, loadFees, loadPayments, loadReceipts]);

  async function handleAddFee(e: React.FormEvent) {
    e.preventDefault();
    if (schoolId == null) { showError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!selectedStudent || !amount) { showError('الطالب والمبلغ مطلوبان'); return; }
    const isCurrent = captureSchoolRequest();
    const res = await createStudentFee({
      school_id: schoolId,
      student_id: Number(selectedStudent),
      academic_year_id: selectedYear ? Number(selectedYear) : null,
      fee_type: feeType,
      amount: Number(amount),
      currency,
      due_date: dueDate ? Math.floor(new Date(dueDate).getTime() / 1000) : null,
      notes: feeNotes || null,
      discount_type: discountType,
      discount_value: discountType === 'none' ? 0 : Number(discountValue),
    });
    if (!isCurrent()) return;
    if (res.error) { showError(res.error); }
    else {
      showSuccess('تم إضافة القسط بنجاح');
      setSelectedStudent(''); setAmount(''); setDueDate(''); setFeeNotes(''); setSelectedYear(''); setFeeType('رسوم دراسية'); setDiscountType('none'); setDiscountValue('');
      loadFees();
      setActiveTab('list');
    }
  }

  async function handleDeleteFee(id: number) {
    if (schoolId == null) return;
    if (!confirm('هل أنت متأكد من حذف هذا القسط؟')) return;
    const isCurrent = captureSchoolRequest();
    const res = await deleteStudentFee(id, schoolId);
    if (!isCurrent()) return;
    if (res.error) { showError(res.error); }
    else { showSuccess('تم حذف القسط'); loadFees(); }
  }

  async function handleUpdateFee(e: React.FormEvent) {
    e.preventDefault();
    if (schoolId == null) { showError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!editingFee) return;
    const isCurrent = captureSchoolRequest();
    const res = await updateStudentFee(editingFee.id, {
      school_id: schoolId,
      fee_type: editingFee.fee_type,
      amount: editingFee.amount,
      currency: editingFee.currency,
      due_date: editingFee.due_date,
      notes: editingFee.notes,
    });
    if (!isCurrent()) return;
    if (res.error) { showError(res.error); }
    else { showSuccess('تم تحديث القسط'); setEditingFee(null); loadFees(); }
  }

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    if (schoolId == null) { showError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!payFeeId || !payAmount || !payDate) { showError('القسط والمبلغ وتاريخ الدفع مطلوبة'); return; }
    const isCurrent = captureSchoolRequest();
    const res = await createFeePayment({
      school_id: schoolId,
      student_fee_id: Number(payFeeId),
      amount: Number(payAmount),
      payment_method: payMethod,
      payment_date: Math.floor(new Date(payDate).getTime() / 1000),
      notes: payNotes || null,
    });
    if (!isCurrent()) return;
    if (res.error) { showError(res.error); }
    else {
      showSuccess('تم تسجيل الدفع بنجاح');
      setPayFeeId(''); setPayAmount(''); setPayNotes(''); setPayDate(new Date().toISOString().split('T')[0]); setPayMethod('cash');
      loadPayments();
      loadFees();
    }
  }

  async function handleGenerateReceipt() {
    if (schoolId == null) { showError('يجب اختيار المدرسة المستهدفة أولاً'); return; }
    if (!receiptStudentFilter || selectedPayments.length === 0) { showError('اختر الطالب والمدفوعات'); return; }
    const isCurrent = captureSchoolRequest();
    const res = await generateFeeReceipt({ school_id: schoolId, student_id: Number(receiptStudentFilter), payment_ids: selectedPayments });
    if (!isCurrent()) return;
    if (res.error) { showError(res.error); }
    else {
      showSuccess('تم إنشاء الإيصال بنجاح');
      setSelectedPayments([]);
      loadReceipts();
    }
  }

  async function handleCancelReceipt(id: number) {
    if (schoolId == null) return;
    if (!confirm('هل أنت متأكد من إلغاء هذا الإيصال؟')) return;
    const isCurrent = captureSchoolRequest();
    const res = await cancelFeeReceipt(id, schoolId);
    if (!isCurrent()) return;
    if (res.error) { showError(res.error); }
    else { showSuccess('تم إلغاء الإيصال'); loadReceipts(); }
  }

  async function handleVerify() {
    if (!verifyToken) return;
    setVerifying(true);
    try {
      const res = await fetch(`/api/verify/receipt/${verifyToken}`);
      const data = await res.json();
      setVerifyResult(data);
    } catch (err: any) {
      setVerifyResult({ valid: false, message: 'فشل الاتصال بالخادم' });
    }
    setVerifying(false);
  }

  const filteredFees = fees.filter(f => {
    const matchesSearch = !feeSearch || (f.student_name?.includes(feeSearch) || f.student_number?.includes(feeSearch) || f.fee_type?.includes(feeSearch));
    const matchesStatus = !feeStatusFilter || f.status === feeStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const studentPayments = payments.filter(p => !paymentStudentFilter || p.student_id === Number(paymentStudentFilter));
  const studentUnpaidFees = fees.filter(f => f.status !== 'paid' && (!paymentStudentFilter || f.student_id === Number(paymentStudentFilter)));

  function formatDate(ts: number | null): string {
    if (!ts) return '---';
    return new Date(ts * 1000).toLocaleDateString('ar-SA');
  }

  function formatCurrency(amount: number, currency: string): string {
    return `${toArabicIndic(amount.toFixed(2))} ${currency === 'EGP' ? 'جنيه' : currency}`;
  }

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'list', label: 'قائمة الأقساط', icon: <FileText size={18} /> },
    { key: 'add', label: 'إضافة قسط', icon: <Plus size={18} /> },
    { key: 'payments', label: 'المدفوعات', icon: <Wallet size={18} /> },
    { key: 'receipts', label: 'الإيصالات', icon: <Printer size={18} /> },
    { key: 'verify', label: 'اختبار التحقق', icon: <QrCode size={18} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CreditCard size={28} className="text-primary-600" />
          الأقساط والمدفوعات
        </h1>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-700">
          <AlertTriangle size={20} />
          <p className="font-medium">{error}</p>
          <button onClick={() => setError(null)} className="mr-auto"><X size={18} /></button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3 text-emerald-700">
          <CheckCircle size={20} />
          <p className="font-medium">{success}</p>
          <button onClick={() => setSuccess(null)} className="mr-auto"><X size={18} /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex overflow-x-auto border-b border-gray-200">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* ==================== LIST TAB ==================== */}
          {activeTab === 'list' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="بحث باسم الطالب أو رقم القسط..."
                    value={feeSearch}
                    onChange={e => setFeeSearch(e.target.value)}
                    className="w-full pr-10 pl-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                    dir="rtl"
                  />
                </div>
                <select
                  value={feeStatusFilter}
                  onChange={e => setFeeStatusFilter(e.target.value)}
                  className="px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                  dir="rtl"
                >
                  <option value="">كل الحالات</option>
                  <option value="pending">معلق</option>
                  <option value="partial">جزئي</option>
                  <option value="paid">مسدد بالكامل</option>
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm" dir="rtl">
                  <thead>
                    <tr className="bg-gray-50 text-gray-700">
                      <th className="px-4 py-3 text-right font-semibold">الطالب</th>
                      <th className="px-4 py-3 text-right font-semibold">نوع القسط</th>
                      <th className="px-4 py-3 text-right font-semibold">المبلغ</th>
                      <th className="px-4 py-3 text-right font-semibold">المسدد</th>
                      <th className="px-4 py-3 text-right font-semibold">المتبقي</th>
                      <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                      <th className="px-4 py-3 text-right font-semibold">الاستحقاق</th>
                      <th className="px-4 py-3 text-right font-semibold">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">جاري التحميل...</td></tr>
                    ) : filteredFees.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">لا توجد أقساط</td></tr>
                    ) : filteredFees.map(fee => (
                      <tr key={fee.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{fee.student_name}</div>
                          <div className="text-xs text-gray-500">{fee.student_number} — {fee.class_name} {fee.section_name}</div>
                        </td>
                        <td className="px-4 py-3">{fee.fee_type}</td>
                        <td className="px-4 py-3 font-mono font-medium">{formatCurrency(fee.net_fee || fee.amount, fee.currency)}</td>
                        <td className="px-4 py-3 font-mono text-emerald-600">{formatCurrency(fee.paid_amount, fee.currency)}</td>
                        <td className="px-4 py-3 font-mono text-red-600">{formatCurrency((fee.net_fee || fee.amount) - fee.paid_amount, fee.currency)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${
                            fee.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                            fee.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {fee.status === 'paid' ? 'مسدد' : fee.status === 'partial' ? 'جزئي' : 'معلق'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatDate(fee.due_date)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => setEditingFee(fee)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="تعديل"><Edit2 size={16} /></button>
                            <button onClick={() => handleDeleteFee(fee.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="حذف"><Trash2 size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== ADD TAB ==================== */}
          {activeTab === 'add' && (
            <form onSubmit={handleAddFee} className="max-w-2xl mx-auto space-y-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Plus size={20} className="text-primary-600" />
                إضافة قسط جديد
              </h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الطالب</label>
                <select
                  value={selectedStudent}
                  onChange={e => setSelectedStudent(Number(e.target.value) || '')}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                  dir="rtl"
                  required
                >
                  <option value="">اختر الطالب</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name} — {s.student_number} ({s.class_name} {s.section_name})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نوع القسط</label>
                  <input
                    type="text"
                    value={feeType}
                    onChange={e => setFeeType(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                    dir="rtl"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ</label>
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                    dir="rtl"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">العملة</label>
                  <select
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                    dir="rtl"
                  >
                    <option value="EGP">جنيه مصري</option>
                    <option value="USD">دولار أمريكي</option>
                    <option value="SAR">ريال سعودي</option>
                    <option value="AED">درهم إماراتي</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الاستحقاق</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                    dir="rtl"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">نوع الخصم</label>
                  <select
                    value={discountType}
                    onChange={e => setDiscountType(e.target.value as any)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                    dir="rtl"
                  >
                    <option value="none">بدون خصم</option>
                    <option value="fixed">خصم مبلغ ثابت</option>
                    <option value="percentage">خصم نسبة مئوية</option>
                  </select>
                </div>
                {discountType !== 'none' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{discountType === 'percentage' ? 'نسبة الخصم (%)' : 'قيمة الخصم'}</label>
                    <input
                      type="number"
                      step={discountType === 'percentage' ? '1' : '0.01'}
                      value={discountValue}
                      onChange={e => setDiscountValue(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                      dir="rtl"
                      required
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">العام الدراسي</label>
                <select
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value) || '')}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                  dir="rtl"
                >
                  <option value="">اختر العام الدراسي (اختياري)</option>
                  {academicYears.map(y => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
                <textarea
                  value={feeNotes}
                  onChange={e => setFeeNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                  dir="rtl"
                />
              </div>
              <button type="submit" className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium flex items-center gap-2">
                <Save size={18} />
                حفظ القسط
              </button>
            </form>
          )}

          {/* ==================== PAYMENTS TAB ==================== */}
          {activeTab === 'payments' && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <DollarSign size={20} className="text-primary-600" />
                  تسجيل دفعة جديدة
                </h3>
                <form onSubmit={handleAddPayment} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">الطالب</label>
                    <select
                      value={paymentStudentFilter}
                      onChange={e => { setPaymentStudentFilter(Number(e.target.value) || ''); setPayFeeId(''); }}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                      dir="rtl"
                    >
                      <option value="">كل الطلاب</option>
                      {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">القسط</label>
                    <select
                      value={payFeeId}
                      onChange={e => setPayFeeId(Number(e.target.value) || '')}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                      dir="rtl"
                      required
                    >
                      <option value="">اختر القسط</option>
                      {studentUnpaidFees.map(f => (
                        <option key={f.id} value={f.id}>
                          {f.fee_type} — متبقي {formatCurrency((f.net_fee || f.amount) - f.paid_amount, f.currency)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ</label>
                    <input
                      type="number"
                      step="0.01"
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                      dir="rtl"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">طريقة الدفع</label>
                    <select
                      value={payMethod}
                      onChange={e => setPayMethod(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                      dir="rtl"
                    >
                      <option value="cash">نقدي</option>
                      <option value="bank_transfer">تحويل بنكي</option>
                      <option value="cheque">شيك</option>
                      <option value="credit_card">بطاقة ائتمان</option>
                      <option value="debit_card">بطاقة خصم</option>
                      <option value="mobile_payment">محفظة إلكترونية</option>
                      <option value="other">أخرى</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الدفع</label>
                    <input
                      type="date"
                      value={payDate}
                      onChange={e => setPayDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                      dir="rtl"
                      required
                    />
                  </div>
                  <div className="lg:col-span-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
                    <input
                      type="text"
                      value={payNotes}
                      onChange={e => setPayNotes(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                      dir="rtl"
                    />
                  </div>
                  <div className="flex items-end">
                    <button type="submit" className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium flex items-center justify-center gap-2">
                      <Save size={18} />
                      تسجيل الدفع
                    </button>
                  </div>
                </form>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm" dir="rtl">
                  <thead>
                    <tr className="bg-gray-50 text-gray-700">
                      <th className="px-4 py-3 text-right font-semibold">الطالب</th>
                      <th className="px-4 py-3 text-right font-semibold">المبلغ</th>
                      <th className="px-4 py-3 text-right font-semibold">الطريقة</th>
                      <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                      <th className="px-4 py-3 text-right font-semibold">المُسجّل</th>
                      <th className="px-4 py-3 text-right font-semibold">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">جاري التحميل...</td></tr>
                    ) : studentPayments.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">لا توجد مدفوعات</td></tr>
                    ) : studentPayments.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{p.student_name}</div>
                        </td>
                        <td className="px-4 py-3 font-mono font-medium text-emerald-600">{toArabicIndic(p.amount.toFixed(2))}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {p.payment_method === 'cash' ? 'نقدي' : p.payment_method === 'bank_transfer' ? 'تحويل بنكي' : p.payment_method === 'cheque' ? 'شيك' : p.payment_method === 'credit_card' ? 'بطاقة ائتمان' : p.payment_method === 'debit_card' ? 'بطاقة خصم' : p.payment_method === 'mobile_payment' ? 'محفظة إلكترونية' : 'أخرى'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatDate(p.payment_date)}</td>
                        <td className="px-4 py-3 text-gray-500">{p.created_by_name || '---'}</td>
                        <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{p.notes || '---'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== RECEIPTS TAB ==================== */}
          {activeTab === 'receipts' && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Printer size={20} className="text-primary-600" />
                  إنشاء إيصال جديد
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">الطالب</label>
                    <select
                      value={receiptStudentFilter}
                      onChange={e => { setReceiptStudentFilter(Number(e.target.value) || ''); setSelectedPayments([]); }}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                      dir="rtl"
                    >
                      <option value="">اختر الطالب</option>
                      {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleGenerateReceipt}
                      disabled={!receiptStudentFilter || selectedPayments.length === 0}
                      className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-2"
                    >
                      <Printer size={18} />
                      إنشاء الإيصال ({toArabicIndic(selectedPayments.length)})
                    </button>
                  </div>
                </div>

                {receiptStudentFilter && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">اختر المدفوعات:</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" dir="rtl">
                        <thead>
                          <tr className="bg-gray-100 text-gray-600">
                            <th className="px-3 py-2 text-right">#</th>
                            <th className="px-3 py-2 text-right">المبلغ</th>
                            <th className="px-3 py-2 text-right">الطريقة</th>
                            <th className="px-3 py-2 text-right">التاريخ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {payments.filter(p => p.student_id === Number(receiptStudentFilter)).map(p => (
                            <tr key={p.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedPayments.includes(p.id)}
                                  onChange={e => {
                                    if (e.target.checked) setSelectedPayments(prev => [...prev, p.id]);
                                    else setSelectedPayments(prev => prev.filter(id => id !== p.id));
                                  }}
                                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                />
                              </td>
                              <td className="px-3 py-2 font-mono">{toArabicIndic(p.amount.toFixed(2))}</td>
                              <td className="px-3 py-2">{p.payment_method}</td>
                              <td className="px-3 py-2 text-gray-500">{formatDate(p.payment_date)}</td>
                            </tr>
                          ))}
                          {payments.filter(p => p.student_id === Number(receiptStudentFilter)).length === 0 && (
                            <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-sm">لا توجد مدفوعات لهذا الطالب</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm" dir="rtl">
                  <thead>
                    <tr className="bg-gray-50 text-gray-700">
                      <th className="px-4 py-3 text-right font-semibold">رقم الإيصال</th>
                      <th className="px-4 py-3 text-right font-semibold">الطالب</th>
                      <th className="px-4 py-3 text-right font-semibold">المبلغ الإجمالي</th>
                      <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                      <th className="px-4 py-3 text-right font-semibold">تاريخ الإنشاء</th>
                      <th className="px-4 py-3 text-right font-semibold">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">جاري التحميل...</td></tr>
                    ) : receipts.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">لا توجد إيصالات</td></tr>
                    ) : receipts.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs">{r.receipt_number}</td>
                        <td className="px-4 py-3 font-medium">{r.student_name_snapshot}</td>
                        <td className="px-4 py-3 font-mono font-medium">{toArabicIndic(r.total_amount.toFixed(2))}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${
                            r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {r.status === 'active' ? 'فعّال' : 'ملغى'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatDate(r.created_at ? Number(r.created_at) : null)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => window.open(`/verify/receipt/${r.verification_token}`, '_blank')}
                              className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg"
                              title="عرض وتحقق"
                            >
                              <QrCode size={16} />
                            </button>
                            <a
                              href={`/print/receipt/${r.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg"
                              title="طباعة / تصدير PDF"
                            >
                              <Printer size={16} />
                            </a>
                            {r.status === 'active' && (
                              <button
                                onClick={() => handleCancelReceipt(r.id)}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                                title="إلغاء"
                              >
                                <Ban size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== VERIFY TAB ==================== */}
          {activeTab === 'verify' && (
            <div className="max-w-xl mx-auto space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <QrCode size={20} className="text-primary-600" />
                  التحقق من إيصال
                </h3>
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="أدخل رمز التحقق..."
                    value={verifyToken}
                    onChange={e => setVerifyToken(e.target.value)}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                    dir="rtl"
                  />
                  <button
                    onClick={handleVerify}
                    disabled={verifying || !verifyToken}
                    className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium"
                  >
                    {verifying ? 'جاري التحقق...' : 'تحقق'}
                  </button>
                </div>
              </div>

              {verifyResult && (
                <div className={`rounded-xl border p-6 ${verifyResult.valid ? 'bg-emerald-50 border-emerald-200' : verifyResult.cancelled ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="text-center mb-4">
                    {verifyResult.valid ? (
                      <CheckCircle size={48} className="text-emerald-600 mx-auto mb-2" />
                    ) : verifyResult.cancelled ? (
                      <AlertTriangle size={48} className="text-amber-600 mx-auto mb-2" />
                    ) : (
                      <XCircle size={48} className="text-red-600 mx-auto mb-2" />
                    )}
                    <h2 className={`text-xl font-bold ${verifyResult.valid ? 'text-emerald-800' : verifyResult.cancelled ? 'text-amber-800' : 'text-red-800'}`}>
                      {verifyResult.valid ? 'إيصال أصلي ومفعّل' : verifyResult.cancelled ? 'إيصال ملغى' : 'إيصال غير صالح'}
                    </h2>
                    <p className={`text-sm mt-1 ${verifyResult.valid ? 'text-emerald-600' : verifyResult.cancelled ? 'text-amber-600' : 'text-red-600'}`}>
                      {verifyResult.message}
                    </p>
                  </div>

                  {verifyResult.valid && (
                    <div className="bg-white rounded-lg p-4 space-y-3 text-right">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-gray-500">رقم الإيصال</p>
                          <p className="font-mono font-bold text-gray-900">{verifyResult.receipt_number}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">الطالب</p>
                          <p className="font-bold text-gray-900">{verifyResult.student_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">المدرسة</p>
                          <p className="font-bold text-gray-900">{verifyResult.school_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">المبلغ الإجمالي</p>
                          <p className="font-mono font-bold text-emerald-600">{toArabicIndic(verifyResult.total_amount?.toFixed(2))}</p>
                        </div>
                      </div>
                      {verifyResult.payments && verifyResult.payments.length > 0 && (
                        <div className="border-t pt-3">
                          <p className="text-xs text-gray-500 mb-2">تفاصيل المدفوعات:</p>
                          <div className="space-y-1">
                            {verifyResult.payments.map((p: any, i: number) => (
                              <div key={i} className="flex justify-between text-sm bg-gray-50 rounded px-3 py-2">
                                <span>{p.fee_type || p.payment_method}</span>
                                <span className="font-mono">{toArabicIndic(p.amount?.toFixed(2))}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Fee Modal */}
      {editingFee && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">تعديل القسط</h3>
              <button onClick={() => setEditingFee(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateFee} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">نوع القسط</label>
                <input
                  type="text"
                  value={editingFee.fee_type}
                  onChange={e => setEditingFee({ ...editingFee, fee_type: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                  dir="rtl"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المبلغ</label>
                <input
                  type="number"
                  step="0.01"
                  value={editingFee.amount}
                  onChange={e => setEditingFee({ ...editingFee, amount: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                  dir="rtl"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
                <textarea
                  value={editingFee.notes || ''}
                  onChange={e => setEditingFee({ ...editingFee, notes: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary-500 text-sm"
                  dir="rtl"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setEditingFee(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">إلغاء</button>
                <button type="submit" className="px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium flex items-center gap-2">
                  <Save size={18} />
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
