import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { verifyResultCard } from '../../lib/api';
import { CheckCircle, XCircle, AlertTriangle, ArrowRight, Shield, School, GraduationCap, Layers, Calendar } from 'lucide-react';

interface VerifyResult {
  valid: boolean;
  cancelled?: boolean;
  card_number?: string;
  student_name?: string;
  school_name?: string;
  class_name?: string;
  section_name?: string;
  academic_year?: string;
  generated_at?: string;
  status?: string;
  overall_result_status?: string;
  general_exemption_status?: boolean;
  card_mode?: 'partial' | 'complete';
  decision_note?: string | null;
  verification_note?: string | null;
}

export default function ResultCardVerificationPage() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('رمز التحقق مفقود');
      return;
    }
    verifyResultCard(token)
      .then((res) => {
        setResult((res.data as any) || null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err?.response?.data?.error || 'فشل التحقق من البطاقة');
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 font-medium">جاري التحقق من البطاقة...</p>
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
          <p className="text-gray-500 mb-6">{error || 'لم يتم العثور على البطاقة'}</p>
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
            {isValid ? 'بطاقة نتيجة أصلية ومفعّلة' : isCancelled ? 'بطاقة ملغاة' : 'بطاقة غير صالحة'}
          </h1>
          <p className={`text-sm ${isValid ? 'text-emerald-600' : isCancelled ? 'text-amber-600' : 'text-red-600'}`}>
            {isValid
              ? 'تم التحقق من صحة هذه البطاقة وهي مسجلة رسمياً في النظام'
              : isCancelled
              ? 'هذه البطاقة ملغاة ولم تعد صالحة للاستخدام'
              : 'لم يتم العثور على بيانات تطابق رمز التحقق المُدخل'}
          </p>
        </div>

        {/* Card Details */}
        {result.card_number && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="bg-primary-600 px-6 py-4 flex items-center gap-3">
              <Shield size={20} className="text-white" />
              <h2 className="text-white font-bold">بيانات البطاقة</h2>
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
                  <p className="text-xs text-gray-500 mb-1">رقم البطاقة</p>
                  <p className="font-mono font-bold text-gray-900 text-sm">{result.card_number}</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-xl">
                  <p className="text-xs text-gray-500 mb-1">النتيجة العامة</p>
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${result.overall_result_status === 'ناجح' ? 'bg-emerald-100 text-emerald-700' : result.overall_result_status === 'راسب' ? 'bg-red-100 text-red-700' : result.overall_result_status === 'غير مكتمل' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>
                    {result.overall_result_status || '---'}
                  </span>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-xl">
                  <p className="text-xs text-gray-500 mb-1">الإعفاء العام</p>
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${result.general_exemption_status ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>
                    {result.general_exemption_status ? 'معفى عام' : '—'}
                  </span>
                </div>
              </div>

              {result.decision_note && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="mb-1 text-xs text-gray-500">الملاحظة / القرار</p>
                  <p className="whitespace-pre-line text-sm font-medium text-gray-900">{result.decision_note}</p>
                </div>
              )}

              {result.verification_note && (
                <p className="text-center text-xs text-gray-500">{result.verification_note}</p>
              )}

              <div className="border-t border-gray-100 pt-4 text-center">
                <p className="text-xs text-gray-400">
                  تم إصدار البطاقة: {result.generated_at ? new Date(Number(result.generated_at) * 1000).toLocaleString('ar-SA') : '---'}
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
