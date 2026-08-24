import { useState, useEffect } from 'react';
import { updateDocumentSettings } from '../../lib/api';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import {
  normalizeResultCardDisplaySettings,
  type ResultCardDisplaySettingKey,
} from '../../lib/resultCardPresentation';
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

const RESULT_CARD_DISPLAY_OPTIONS: Array<{
  key: ResultCardDisplaySettingKey;
  label: string;
}> = [
  { key: 'show_school_logo', label: 'شعار المدرسة' },
  { key: 'show_school_subtitle', label: 'العنوان الفرعي / الشعار النصي' },
  { key: 'show_phone', label: 'رقم الهاتف' },
  { key: 'show_address', label: 'العنوان' },
  { key: 'show_email_website', label: 'البريد والموقع الإلكتروني' },
  { key: 'show_class_section_in_header', label: 'الصف والشعبة في الرأس' },
  { key: 'show_student_number', label: 'رقم الطالب' },
  { key: 'show_exam_number', label: 'الرقم الامتحاني عند توفره' },
  { key: 'show_gender', label: 'الجنس' },
  { key: 'show_exam_round', label: 'الدور' },
  { key: 'show_overall_average', label: 'المعدل العام' },
  { key: 'show_appreciation', label: 'التقدير' },
  { key: 'show_subject_status', label: 'حالة المادة' },
  { key: 'show_exemption_detail', label: 'تفصيل الإعفاء الفردي' },
  { key: 'show_first_term_inputs', label: 'مدخلات الفصل الأول' },
  { key: 'show_first_term_average', label: 'سعي الفصل الأول' },
  { key: 'show_mid_year_exam', label: 'امتحان نصف السنة' },
  { key: 'show_second_term_inputs', label: 'مدخلات الفصل الثاني' },
  { key: 'show_second_term_average', label: 'سعي الفصل الثاني' },
  { key: 'show_final_exam', label: 'امتحان نهاية السنة' },
  { key: 'show_annual_effort', label: 'السعي السنوي' },
  { key: 'show_final_grade', label: 'الدرجة النهائية' },
  { key: 'show_effective_grade', label: 'الدرجة الفعّالة' },
  { key: 'show_completion_exam', label: 'امتحان الإكمال عند تفعيله' },
  { key: 'show_qr_code', label: 'رمز QR' },
  { key: 'show_verification_code_text', label: 'نص رمز التحقق' },
  { key: 'show_notes_decisions', label: 'الملاحظات والقرارات' },
  { key: 'show_signatures_block', label: 'كتلة التواقيع' },
  { key: 'show_school_stamp_placeholder', label: 'الختم أو موضعه' },
];

export default function DocumentTab({ data, canEdit, schoolId, onSuccess, onError }: Props) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
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
      result_card_display_settings: normalizeResultCardDisplaySettings(
        settings.result_card_display_settings,
      ),
    });
    setSaving(false);
    setChanged(false);
  }, [settings, schoolId]);

  const handleChange = (key: string, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setChanged(true);
  };

  const toggleBool = (key: string) => {
    handleChange(key, form[key] ? 0 : 1);
  };

  const toggleResultCardDisplay = (key: ResultCardDisplaySettingKey) => {
    setForm(prev => ({
      ...prev,
      result_card_display_settings: {
        ...normalizeResultCardDisplaySettings(prev.result_card_display_settings),
        [key]: !normalizeResultCardDisplaySettings(prev.result_card_display_settings)[key],
      },
    }));
    setChanged(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolId || !canEdit) return;
    const isCurrent = captureSchoolRequest();
    setSaving(true);
    const { data: resData, error } = await updateDocumentSettings(form, schoolId);
    if (!isCurrent()) return;
    setSaving(false);
    if (error) {
      onError(error);
    } else {
      onSuccess(resData?.message || 'تم تحديث إعدادات الوثائق بنجاح');
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

      <div className="border-t border-gray-200 pt-5">
        <h3 className="mb-1 text-sm font-semibold text-gray-700">محتوى كارت النتيجة</h3>
        <p className="mb-4 text-xs text-gray-500">
          تُحفظ هذه الخيارات داخل كل كارت عند إصداره، لذلك تبقى الكارتات القديمة كما صدرت.
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {RESULT_CARD_DISPLAY_OPTIONS.map((option) => {
            const enabled = normalizeResultCardDisplaySettings(
              form.result_card_display_settings,
            )[option.key];
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => toggleResultCardDisplay(option.key)}
                disabled={!canEdit}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-right text-xs transition-colors ${
                  enabled
                    ? 'border-primary-200 bg-primary-50 text-primary-700'
                    : 'border-gray-200 bg-white text-gray-600'
                } ${canEdit ? 'hover:bg-gray-50' : 'cursor-not-allowed opacity-70'}`}
              >
                {enabled ? <CheckSquare size={16} /> : <Square size={16} />}
                <span>{option.label}</span>
              </button>
            );
          })}
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
