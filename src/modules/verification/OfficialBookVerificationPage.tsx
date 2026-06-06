import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { verifyOfficialBook } from '../../lib/api';
import { FileText, CheckCircle, XCircle, AlertTriangle, Loader2, QrCode } from 'lucide-react';

interface VerificationData {
  valid: boolean;
  document_number: string;
  title: string;
  school_name: string;
  student_name?: string;
  employee_name?: string;
  generated_at: string;
  status: string;
  verification_note?: string;
  cancelled_warning?: string;
}

export default function OfficialBookVerificationPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<VerificationData | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('الكتاب غير موجود أو رمز التحقق غير صحيح');
      return;
    }
    verifyOfficialBook(token)
      .then((res: any) => {
        if (res.data?.valid) {
          setData(res.data);
        } else {
          setError(res.data?.message || 'الكتاب غير موجود أو رمز التحقق غير صحيح');
        }
      })
      .catch((err: any) => {
        setError(err?.data?.message || err?.error || 'الكتاب غير موجود أو رمز التحقق غير صحيح');
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <div className="text-center">
          <Loader2 className="animate-spin mx-auto text-primary-600 mb-3" size={40} />
          <p className="text-gray-600">جاري التحقق...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
          <XCircle className="mx-auto text-red-500 mb-4" size={56} />
          <h2 className="text-xl font-bold text-red-700 mb-2">الكتاب غير موجود</h2>
          <p className="text-gray-600">{error || 'الكتاب غير موجود أو رمز التحقق غير صحيح'}</p>
        </div>
      </div>
    );
  }

  const isValid = data.status === 'active';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4" dir="rtl">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className={`p-6 text-center ${isValid ? 'bg-emerald-50' : 'bg-amber-50'}`}>
          {isValid ? (
            <CheckCircle className="mx-auto text-emerald-600 mb-3" size={56} />
          ) : (
            <AlertTriangle className="mx-auto text-amber-600 mb-3" size={56} />
          )}
          <h2 className={`text-2xl font-bold ${isValid ? 'text-emerald-700' : 'text-amber-700'}`}>
            {isValid ? 'الكتاب الرسمي صالح' : 'الكتاب غير صالح'}
          </h2>
          <p className="text-sm mt-1 text-gray-600">{data.school_name}</p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {data.cancelled_warning && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <XCircle className="mx-auto text-red-600 mb-2" size={32} />
              <p className="text-red-700 font-bold">{data.cancelled_warning}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">رقم الكتاب</div>
              <div className="font-bold text-gray-900">{data.document_number}</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">العنوان</div>
              <div className="font-bold text-gray-900">{data.title}</div>
            </div>
            {data.student_name && (
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">الطالب</div>
                <div className="font-bold text-gray-900">{data.student_name}</div>
              </div>
            )}
            {data.employee_name && (
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">الموظف</div>
                <div className="font-bold text-gray-900">{data.employee_name}</div>
              </div>
            )}
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">تاريخ الإنشاء</div>
              <div className="font-bold text-gray-900">{new Date(data.generated_at).toLocaleDateString('ar-IQ')}</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">الحالة</div>
              <div className={`font-bold ${isValid ? 'text-emerald-700' : 'text-red-700'}`}>
                {data.status === 'active' ? 'فعّال' : 'ملغى'}
              </div>
            </div>
          </div>

          {data.verification_note && (
            <div className="text-xs text-gray-500 text-center mt-4">{data.verification_note}</div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 p-4 text-center border-t">
          <p className="text-xs text-gray-400">تم التحقق من خلال نظام المدرسة الذكي</p>
        </div>
      </div>
    </div>
  );
}
