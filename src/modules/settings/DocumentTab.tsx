import { useState, useEffect } from 'react';
import { updateDocumentSettings } from '../../lib/api';
import { Save, Loader2, FileText, Printer, Image, Stamp, CheckSquare, Square } from 'lucide-react';

interface Props {
  data: Record<string, any>;
  canEdit: boolean;
  schoolId: number | null;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const PRINT_SIZES = [
  { value: 'A4', label: 'A4 (القياسي)' },
  { value: 'A5', label: 'A5 (نصف القياس)' },
  { value: 'Letter', label: 'Letter (رسالة)' },
];

const RECEIPT_SIZES = [
  { value: 'A5', label: 'A5 (نصف القياس)' },
  { value: 'A4', label: 'A4 (القياسي)' },
];

export default function DocumentTab({ data, canEdit, schoolId, onSuccess, onError }: Props) {
  const settings = data || {};
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    setForm({
      result_card_header_text: settings.result_card_header_text || '',
      result_card_footer_text: settings.result_card_footer_text || '',
      receipt_footer_text: settings.receipt_footer_text || '',
      verification_note_text: settings.verification_note_text || '',
      use_school_logo_on_docs: settings.use_school_logo_on_docs ?? 1,
      use_school_stamp_on_docs: settings.use_school_stamp_on_docs ?? 0,
      default_print_size: settings.default_print_size || 'A4',
      default_receipt_size: settings.default_receipt_size || 'A5',
    });
    setChanged(false);
  }, [settings]);

  const handleChange = (key: string, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setChanged(true);
  };

  const toggleBool = (key: string) => {
    handleChange(key, form[key] ? 0 : 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolId || !canEdit) return;
    setSaving(true);
    const { data: resData, error } = await updateDocumentSettings(form, schoolId);
    setSaving(false);
    if (error) {
      onError(error);
    } else {
      onSuccess(resData?.data?.message || 'تم تحديث إعدادات الوثائق بنجاح');
      setChanged(false);
    }
  };

  const TextArea = ({ label, name, placeholder, rows = 3 }: {
    label: string; name: string; placeholder?: string; rows?: number;
  }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <textarea
        value={form[name] || ''}
        onChange={e => handleChange(name, e.target.value)}
        disabled={!canEdit}
        rows={rows}
        placeholder={placeholder}
        className={`w-full px-4 py-2 rounded-lg border text-sm transition-colors focus:outline-none resize-none ${
          canEdit
            ? 'border-gray-200 focus:border-primary-500 focus:ring-1 focus:ring-primary-500'
            : 'border-gray-100 bg-gray-50 text-gray-600 cursor-not-allowed'
        }`}
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <FileText size={20} className="text-primary-600" />
          إعدادات الطباعة والوثائق
        </h2>
        {canEdit && changed && (
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            حفظ التغييرات
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <TextArea
          label="عنوان رأس كارت النتيجة"
          name="result_card_header_text"
          placeholder="نص يظهر أعلى كارت النتيجة الرسمي"
          rows={2}
        />
        <TextArea
          label="تذييل كارت النتيجة"
          name="result_card_footer_text"
          placeholder="نص يظهر أسفل كارت النتيجة الرسمي"
          rows={2}
        />
        <TextArea
          label="تذييل الإيصال"
          name="receipt_footer_text"
          placeholder="نص يظهر أسفل إيصال الدفع"
          rows={2}
        />
        <TextArea
          label="ملاحظة التحقق العامة"
          name="verification_note_text"
          placeholder="نص يظهر في صفحة التحقق العامة"
          rows={2}
        />
      </div>

      <div className="border-t border-gray-200 pt-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">خيارات الطباعة</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">حجم الطباعة الافتراضي</label>
            <div className="flex items-center gap-2">
              <Printer size={16} className="text-gray-400" />
              <select
                value={form.default_print_size || 'A4'}
                onChange={e => handleChange('default_print_size', e.target.value)}
                disabled={!canEdit}
                className={`flex-1 px-4 py-2 rounded-lg border text-sm transition-colors focus:outline-none ${
                  canEdit
                    ? 'border-gray-200 focus:border-primary-500 focus:ring-1 focus:ring-primary-500'
                    : 'border-gray-100 bg-gray-50 text-gray-600 cursor-not-allowed'
                }`}
              >
                {PRINT_SIZES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">حجم الإيصال الافتراضي</label>
            <div className="flex items-center gap-2">
              <Printer size={16} className="text-gray-400" />
              <select
                value={form.default_receipt_size || 'A5'}
                onChange={e => handleChange('default_receipt_size', e.target.value)}
                disabled={!canEdit}
                className={`flex-1 px-4 py-2 rounded-lg border text-sm transition-colors focus:outline-none ${
                  canEdit
                    ? 'border-gray-200 focus:border-primary-500 focus:ring-1 focus:ring-primary-500'
                    : 'border-gray-100 bg-gray-50 text-gray-600 cursor-not-allowed'
                }`}
              >
                {RECEIPT_SIZES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">خيارات الشعار والختم</h3>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => toggleBool('use_school_logo_on_docs')}
            disabled={!canEdit}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm transition-colors text-right ${
              canEdit ? 'hover:bg-gray-50' : 'cursor-not-allowed opacity-70'
            } ${form.use_school_logo_on_docs ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700'}`}
          >
            {form.use_school_logo_on_docs ? <CheckSquare size={18} /> : <Square size={18} />}
            <Image size={16} />
            <span>استخدام شعار المدرسة على الوثائق</span>
          </button>

          <button
            type="button"
            onClick={() => toggleBool('use_school_stamp_on_docs')}
            disabled={!canEdit}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm transition-colors text-right ${
              canEdit ? 'hover:bg-gray-50' : 'cursor-not-allowed opacity-70'
            } ${form.use_school_stamp_on_docs ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700'}`}
          >
            {form.use_school_stamp_on_docs ? <CheckSquare size={18} /> : <Square size={18} />}
            <Stamp size={16} />
            <span>استخدام الختم الرسمي على الوثائق</span>
          </button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 text-blue-700">
        <FileText size={20} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-sm mb-1">ملاحظة</p>
          <p className="text-sm opacity-90">
            الإعدادات الجديدة تُطبّق فقط على الوثائق التي يتم إنشاؤها بعد التعديل.
            الوثائق السابقة تبقى غير قابلة للتعديل لضمان التحقق والموثوقية.
          </p>
        </div>
      </div>
    </form>
  );
}
