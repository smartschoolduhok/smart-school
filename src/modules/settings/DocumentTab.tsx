import { useState, useEffect } from 'react';
import { updateDocumentSettings } from '../../lib/api';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import {
  normalizeResultCardDisplaySettings,
  RESULT_CARD_CUSTOM_TEXT_MAX_LENGTH,
  type ResultCardGradeDetailMode,
  type ResultCardDisplaySettingKey,
} from '../../lib/resultCardPresentation';
import {
  Save,
  Loader2,
  FileText,
  Printer,
  Image,
  Stamp,
  CheckSquare,
  Square,
  CalendarDays,
  CalendarRange,
  ListChecks,
  SlidersHorizontal,
} from 'lucide-react';

interface Props {
  data: Record<string, any>;
  school?: Record<string, any>;
  canEdit: boolean;
  schoolId: number | null;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

interface TextAreaFieldProps {
  label: string;
  name: string;
  value: string;
  canEdit: boolean;
  placeholder?: string;
  hint?: string;
  rows?: number;
  maxLength?: number;
  onChange: (name: string, value: string) => void;
}

function TextAreaField({
  label,
  name,
  value,
  canEdit,
  placeholder,
  hint,
  rows = 3,
  maxLength,
  onChange,
}: TextAreaFieldProps) {
  const inputId = `document-setting-${name}`;
  return (
    <div>
      <div className="mb-1 flex items-end justify-between gap-3">
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">{label}</label>
        {maxLength && <span className="text-[11px] text-gray-400">{value.length}/{maxLength}</span>}
      </div>
      <textarea
        id={inputId}
        name={name}
        value={value}
        onChange={event => onChange(name, event.target.value)}
        disabled={!canEdit}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        className={`w-full resize-none rounded-lg border px-4 py-2 text-sm transition-colors focus:outline-none ${
          canEdit
            ? 'border-gray-200 focus:border-primary-500 focus:ring-1 focus:ring-primary-500'
            : 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-600'
        }`}
      />
      {hint && <p className="mt-1 text-xs leading-relaxed text-gray-500">{hint}</p>}
    </div>
  );
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
  { key: 'show_school_subtitle', label: 'النص المخصص أعلى الكارت' },
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

const RESULT_CARD_GRADE_OPTION_KEYS = new Set<ResultCardDisplaySettingKey>([
  'show_first_term_inputs',
  'show_first_term_average',
  'show_mid_year_exam',
  'show_second_term_inputs',
  'show_second_term_average',
  'show_final_exam',
  'show_annual_effort',
  'show_final_grade',
  'show_effective_grade',
  'show_completion_exam',
]);

const RESULT_CARD_GRADE_VIEW_OPTIONS: Array<{
  value: ResultCardGradeDetailMode;
  title: string;
  description: string;
  icon: typeof CalendarDays;
}> = [
  {
    value: 'annual',
    title: 'سنوي مختصر',
    description: 'النتيجة الرسمية ودرجات القرار في جدول واضح ومضغوط.',
    icon: ListChecks,
  },
  {
    value: 'term',
    title: 'درجات فصلية',
    description: 'سعي الفصلين ونصف السنة مع خلاصة القرار السنوي.',
    icon: CalendarRange,
  },
  {
    value: 'monthly',
    title: 'درجات شهرية',
    description: 'الأشهر المتاحة حسب نظام الدرجات مع النتيجة الرسمية.',
    icon: CalendarDays,
  },
  {
    value: 'custom',
    title: 'أعمدة مخصصة',
    description: 'اختيار كل عمود يدويًا من الخيارات المتقدمة أدناه.',
    icon: SlidersHorizontal,
  },
];

export default function DocumentTab({ data, school, canEdit, schoolId, onSuccess, onError }: Props) {
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
        ...(RESULT_CARD_GRADE_OPTION_KEYS.has(key) ? { grade_detail_mode: 'custom' } : {}),
      },
    }));
    setChanged(true);
  };

  const setResultCardGradeView = (mode: ResultCardGradeDetailMode) => {
    setForm(prev => ({
      ...prev,
      result_card_display_settings: {
        ...normalizeResultCardDisplaySettings(prev.result_card_display_settings),
        grade_detail_mode: mode,
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
        <TextAreaField
          label="النص المخصص أعلى كارت النتيجة"
          name="result_card_header_text"
          value={form.result_card_header_text || ''}
          canEdit={canEdit}
          onChange={handleChange}
          placeholder={'مثال: جمهورية العراق\nوزارة التربية'}
          hint="يظهر كسطر أو عدة أسطر فوق عنوان الكارت، ويُحفظ داخل كل كارت جديد."
          rows={2}
          maxLength={RESULT_CARD_CUSTOM_TEXT_MAX_LENGTH}
        />
        <TextAreaField
          label="تذييل كارت النتيجة"
          name="result_card_footer_text"
          value={form.result_card_footer_text || ''}
          canEdit={canEdit}
          onChange={handleChange}
          placeholder="نص يظهر أسفل كارت النتيجة الرسمي"
          rows={2}
          maxLength={RESULT_CARD_CUSTOM_TEXT_MAX_LENGTH}
        />
        <TextAreaField
          label="تذييل الإيصال"
          name="receipt_footer_text"
          value={form.receipt_footer_text || ''}
          canEdit={canEdit}
          onChange={handleChange}
          placeholder="نص يظهر أسفل إيصال الدفع"
          rows={2}
          maxLength={500}
        />
        <TextAreaField
          label="ملاحظة التحقق العامة"
          name="verification_note_text"
          value={form.verification_note_text || ''}
          canEdit={canEdit}
          onChange={handleChange}
          placeholder="نص يظهر في صفحة التحقق العامة"
          rows={2}
          maxLength={500}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-l from-slate-950 via-blue-950 to-blue-800 text-white shadow-sm">
        <div className="whitespace-pre-line border-b border-white/15 bg-white/5 px-5 py-2 text-center text-xs font-bold leading-relaxed text-blue-50">
          {form.result_card_header_text || 'النص المخصص الذي تختاره المدرسة يظهر هنا'}
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-semibold text-blue-200">معاينة مبسطة للرأس</p>
            <p className="mt-1 text-lg font-black">{school?.name || 'اسم المدرسة'}</p>
            {school?.name_en && <p dir="ltr" className="mt-0.5 text-xs text-blue-100">{school.name_en}</p>}
          </div>
          <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-center">
            <p className="font-black">كارت النتيجة</p>
            <p dir="ltr" className="text-[10px] font-bold tracking-wider text-blue-100">RESULT CARD</p>
          </div>
        </div>
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

        <fieldset>
          <legend className="mb-3 text-sm font-bold text-gray-800">مستوى تفاصيل الدرجات</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {RESULT_CARD_GRADE_VIEW_OPTIONS.map(option => {
              const selected = normalizeResultCardDisplaySettings(
                form.result_card_display_settings,
              ).grade_detail_mode === option.value;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setResultCardGradeView(option.value)}
                  disabled={!canEdit}
                  className={`rounded-xl border p-4 text-right transition-all ${
                    selected
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                      : 'border-gray-200 bg-white text-gray-700'
                  } ${canEdit ? 'hover:border-blue-300 hover:bg-blue-50/50' : 'cursor-not-allowed opacity-70'}`}
                >
                  <span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                    <Icon size={18} />
                  </span>
                  <span className="block text-sm font-bold">{option.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-gray-500">{option.description}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            العرض الشهري والفصلي يتكيّفان تلقائيًا مع طريقة إدخال الدرجات المعتمدة للمدرسة، ولا يغيّران أي درجة أو قرار.
          </p>
        </fieldset>

        <div className="mt-5 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {RESULT_CARD_DISPLAY_OPTIONS.filter(option => !RESULT_CARD_GRADE_OPTION_KEYS.has(option.key)).map((option) => {
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

        <details className="mt-4 rounded-xl border border-gray-200 bg-gray-50/70">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold text-gray-700">
            <SlidersHorizontal size={17} className="text-primary-600" />
            تخصيص أعمدة الدرجات يدويًا
          </summary>
          <div className="grid grid-cols-1 gap-2 border-t border-gray-200 p-4 md:grid-cols-2 lg:grid-cols-3">
            {RESULT_CARD_DISPLAY_OPTIONS.filter(option => RESULT_CARD_GRADE_OPTION_KEYS.has(option.key)).map((option) => {
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
                  } ${canEdit ? 'hover:bg-white' : 'cursor-not-allowed opacity-70'}`}
                >
                  {enabled ? <CheckSquare size={16} /> : <Square size={16} />}
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </details>
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
