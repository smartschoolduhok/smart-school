import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { verifyReceipt } from '../../lib/api';
import { CheckCircle, XCircle, AlertTriangle, ArrowRight, Shield, School, GraduationCap, Layers, Calendar, DollarSign, Receipt } from 'lucide-react';

interface VerifyReceiptResult {
  valid: boolean;
  cancelled?: boolean;
  receipt_number?: string;
  student_name?: string;
  school_name?: string;
  class_name?: string;
  section_name?: string;
  academic_year?: string;
  total_amount?: number;
  created_at?: string;
  status?: string;
  payments?: Array<{
    payment_id: number;
    amount: number;
    payment_method: string;
    payment_date: number;
    fee_type: string;
  }>;
}

export default function ReceiptVerificationPage() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<VerifyReceiptResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('رمز التحقق مفقود');
      return;
    }
    verifyReceipt(token)
      .then((res) => {
        if (res.error || !res.data) {
          throw new Error(res.error || 'فشل التحقق');
        }
        setResult(res.data as VerifyReceiptResult);
        setLoading(false);
      })
      .catch((err) => {
        setError(err?.message || 'فشل التحقق من الإيصال');
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 font-medium">جاري التحقق من الإيصال...</p>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div dir="rtl" className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle size={32} className="text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">فشل التحقق</h1>
          <p className="text-gray-500 mb-6">{error || 'لم يتم العثور على الإيصال'}</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
          >
            <span>العودة للرئيسية</span>
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    );
  }

  const isValid = result.valid && result.status !== 'cancelled';
  const isCancelled = result.status === 'cancelled';

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Status Banner */}
        <div className={`rounded-2xl shadow-lg p-8 mb-6 text-center ${isValid ? 'bg-emerald-50 border border-emerald-200' : isCancelled ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${isValid ? 'bg-emerald-100' : isCancelled ? 'bg-amber-100' : 'bg-red-100'}`}>
            {isValid ? (
              <CheckCircle size={40} className="text-emerald-600" />
            ) : isCancelled ? (
              <AlertTriangle size={40} className="text-amber-600" />
            ) : (
              <XCircle size={40} className="text-red-600" />
            )}
          </div>
          <h1 className={`text-2xl font-bold mb-1 ${isValid ? 'text-emerald-800' : isCancelled ? 'text-amber-800' : 'text-red-800'}`}>
            {isValid ? 'إيصال أصلي ومفعّل' : isCancelled ? 'إيصال ملغى' : 'إيصال غير صالح'}
          </h1>
          <p className={`text-sm ${isValid ? 'text-emerald-600' : isCancelled ? 'text-amber-600' : 'text-red-600'}`}>
            {isValid
              ? 'تم التحقق من صحة هذا الإيصال وهو مسجل رسمياً في النظام'
              : isCancelled
              ? 'هذا الإيصال ملغى ولم يعد صالحاً للاستخدام'
              : 'لم يتم العثور على بيانات تطابق رمز التحقق المُدخل'}
          </p>
        </div>

        {/* Receipt Details */}
        {result.receipt_number && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="bg-primary-600 px-6 py-4 flex items-center gap-3">
              <Receipt size={20} className="text-white" />
              <h2 className="text-white font-bold">بيانات الإيصال</h2>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center shrink-0">
                    <GraduationCap size={18} className="text-primary-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">اسم الطالب</p>
                    <p className="font-bold text-gray-900">{result.student_name || '---'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center shrink-0">
                    <School size={18} className="text-primary-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">المدرسة</p>
                    <p className="font-bold text-gray-900">{result.school_name || '---'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center shrink-0">
                    <Layers size={18} className="text-primary-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">الصف والشعبة</p>
                    <p className="font-bold text-gray-900">
                      {result.class_name || '---'} {result.section_name ? `- ${result.section_name}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center shrink-0">
                    <Calendar size={18} className="text-primary-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">العام الدراسي</p>
                    <p className="font-bold text-gray-900">{result.academic_year || '---'}</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-3 bg-gray-50 rounded-xl">
                  <p className="text-xs text-gray-500 mb-1">رقم الإيصال</p>
                  <p className="font-mono font-bold text-gray-900 text-sm">{result.receipt_number}</p>
                </div>
                <div className="text-center p-3 bg-emerald-50 rounded-xl">
                  <p className="text-xs text-emerald-600 mb-1">المبلغ الإجمالي</p>
                  <p className="font-mono font-bold text-emerald-700 text-lg">
                    {result.total_amount !== undefined ? result.total_amount.toLocaleString('ar-SA', { minimumFractionDigits: 2 }) : '---'}
                  </p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-xl">
                  <p className="text-xs text-gray-500 mb-1">الحالة</p>
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${isValid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {isValid ? 'مفعّل' : 'ملغى'}
                  </span>
                </div>
              </div>

              {/* Payments Detail */}
              {result.payments && result.payments.length > 0 && (
                <div className="border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                    <DollarSign size={16} className="text-primary-600" />
                    تفاصيل المدفوعات
                  </h3>
                  <div className="space-y-2">
                    {result.payments.map((p, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{p.fee_type || p.payment_method}</p>
                            <p className="text-xs text-gray-500">
                              {p.payment_method === 'cash' ? 'نقدي' : p.payment_method === 'bank_transfer' ? 'تحويل بنكي' : p.payment_method === 'cheque' ? 'شيك' : p.payment_method === 'credit_card' ? 'بطاقة ائتمان' : p.payment_method === 'debit_card' ? 'بطاقة خصم' : p.payment_method === 'mobile_payment' ? 'محفظة إلكترونية' : 'أخرى'}
                            </p>
                          </div>
                        </div>
                        <p className="font-mono font-bold text-gray-900">
                          {p.amount.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-gray-100 pt-4 text-center">
                <p className="text-xs text-gray-400">
                  تم إصدار الإيصال: {result.created_at ? new Date(result.created_at).toLocaleString('ar-SA') : '---'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
          >
            <span>العودة للرئيسية</span>
            <ArrowRight size={18} />
          </Link>
          <p className="mt-4 text-xs text-gray-400">
            نظام إدارة المدارس الذكي — جميع البيانات محمية وموثقة إلكترونياً
          </p>
        </div>
      </div>
    </div>
  );
}
