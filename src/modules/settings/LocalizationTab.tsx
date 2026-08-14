import { useState, useEffect } from 'react';
import { updateSystemSettings } from '../../lib/api';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { Save, Loader2, Globe, Hash, Calendar, Coins } from 'lucide-react';

interface Props {
  data: Record<string, any>;
  canEdit: boolean;
  schoolId: number | null;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const DATE_FORMATS = [
  { value: 'dd/MM/yyyy', label: '٢٩/٠٥/٢٠٢٦' },
  { value: 'yyyy-MM-dd', label: '2026-05-29' },
  { value: 'dd-MM-yyyy', label: '29-05-2026' },
  { value: 'MM/dd/yyyy', label: '05/29/2026' },
];

const CURRENCY_LABELS = [
  { value: 'د.ع', label: 'دينار عراقي (د.ع)' },
  { value: '$', label: 'دولار أمريكي ($)' },
  { value: '€', label: 'يورو (€)' },
  { value: '£', label: 'جنيه إسترليني (£)' },
  { value: '﷼', label: 'ريال سعودي (﷼)' },
  { value: 'د.إ', label: 'درهم إماراتي (د.إ)' },
  { value: 'د.ك', label: 'دينار كويتي (د.ك)' },
];

export default function LocalizationTab({ data, canEdit, schoolId, onSuccess, onError }: Props) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const settings = data || {};
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    setForm({
      use_arabic_indic_digits: settings.use_arabic_indic_digits ?? 1,
      currency_label: settings.currency_label || 'د.ع',
      date_format: settings.date_format || 'dd/MM/yyyy',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolId || !canEdit) return;
    const isCurrent = captureSchoolRequest();
    setSaving(true);
    const { data: resData, error } = await updateSystemSettings(form, schoolId);
    if (!isCurrent()) return;
    setSaving(false);
    if (error) {
      onError(error);
    } else {
      onSuccess(resData?.data?.message || 'تم تحديث إعدادات النظام بنجاح');
      setChanged(false);
    }
  };

  const todayPreview = new Date().toLocaleDateString('ar-IQ', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Globe size={20} className="text-primary-600" />
          إعدادات اللغة والتنسيق
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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">الأرقام المستخدمة</label>
          <button
            type="button"
            onClick={() => toggleBool('use_arabic_indic_digits')}
            disabled={!canEdit}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-sm transition-colors ${
              canEdit ? 'hover:bg-gray-50' : 'cursor-not-allowed opacity-70'
            } ${form.use_arabic_indic_digits ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700'}`}
          >
            <div className="flex items-center gap-2">
              <Hash size={16} />
              <span>استخدام الأرقام الهندية العربية</span>
            </div>
            <span className="text-lg font-bold">
              {form.use_arabic_indic_digits ? '٠١٢٣٤٥٦٧٨٩' : '0123456789'}
            </span>
          </button>
          <p className="text-xs text-gray-500 mt-1">
            عند التفعيل، يتم عرض جميع الأرقام في النظام بالهندية العربية (٠١٢٣٤٥٦٧٨٩)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">العملة الافتراضية</label>
          <div className="relative">
            <Coins size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={form.currency_label || 'د.ع'}
              onChange={e => handleChange('currency_label', e.target.value)}
              disabled={!canEdit}
              className={`w-full pr-10 pl-4 py-2 rounded-lg border text-sm transition-colors focus:outline-none ${
                canEdit
                  ? 'border-gray-200 focus:border-primary-500 focus:ring-1 focus:ring-primary-500'
                  : 'border-gray-100 bg-gray-50 text-gray-600 cursor-not-allowed'
              }`}
            >
              {CURRENCY_LABELS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">تنسيق التاريخ</label>
          <div className="relative">
            <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={form.date_format || 'dd/MM/yyyy'}
              onChange={e => handleChange('date_format', e.target.value)}
              disabled={!canEdit}
              className={`w-full pr-10 pl-4 py-2 rounded-lg border text-sm transition-colors focus:outline-none ${
                canEdit
                  ? 'border-gray-200 focus:border-primary-500 focus:ring-1 focus:ring-primary-500'
                  : 'border-gray-100 bg-gray-50 text-gray-600 cursor-not-allowed'
              }`}
            >
              {DATE_FORMATS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">معاينة التنسيق</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500 mb-1">التاريخ اليوم</p>
            <p className="font-medium text-gray-900">{todayPreview}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500 mb-1">الأرقام</p>
            <p className="font-medium text-gray-900">
              {form.use_arabic_indic_digits ? '١٢٣٤٥' : '12345'}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500 mb-1">العملة</p>
            <p className="font-medium text-gray-900">1,250 {form.currency_label || 'د.ع'}</p>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 text-blue-700">
        <Globe size={20} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-sm mb-1">ملاحظة</p>
          <p className="text-sm opacity-90">
            إعدادات اللغة والأرقام تُطبّق فقط على الوثائق والتقارير الجديدة.
            التطبيق الكامل في جميع الوحدات سيتم في تحديث قادم.
          </p>
        </div>
      </div>
    </form>
  );
}
