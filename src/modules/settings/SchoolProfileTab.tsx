import { useState, useEffect } from 'react';
import { updateSchoolProfile } from '../../lib/api';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { Save, Loader2, MapPin, Phone, Mail, Globe, User, Image, Building2 } from 'lucide-react';

interface Props {
  data: Record<string, any>;
  canEdit: boolean;
  schoolId: number | null;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const SCHOOL_TYPES = ['خاص', 'حكومي', 'دولي', 'مختلط'];
const EMPTY_SCHOOL_PROFILE: Record<string, any> = {};

export default function SchoolProfileTab({ data, canEdit, schoolId, onSuccess, onError }: Props) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const school = data?.school || EMPTY_SCHOOL_PROFILE;
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    setForm({
      name: school.name || '',
      name_en: school.name_en || '',
      school_type: school.school_type || '',
      city: school.city || '',
      province: school.province || '',
      address: school.address || '',
      phone: school.phone || '',
      email: school.email || '',
      website: school.website || '',
      principal_name: school.principal_name || '',
      logo_url: school.logo_url || '',
      official_stamp_url: school.official_stamp_url || '',
    });
    setSaving(false);
    setChanged(false);
  }, [school, schoolId]);

  const handleChange = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setChanged(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolId || !canEdit) return;
    const isCurrent = captureSchoolRequest();
    setSaving(true);
    const { data: resData, error } = await updateSchoolProfile(form, schoolId);
    if (!isCurrent()) return;
    setSaving(false);
    if (error) {
      onError(error);
    } else {
      onSuccess(resData?.message || 'تم تحديث بيانات المدرسة بنجاح');
      setChanged(false);
    }
  };

  const Input = ({ label, name, type = 'text', icon: Icon, placeholder }: {
    label: string; name: string; type?: string; icon?: any; placeholder?: string;
  }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        {Icon && <Icon size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />}
        <input
          type={type}
          value={form[name] || ''}
          onChange={e => handleChange(name, e.target.value)}
          disabled={!canEdit}
          placeholder={placeholder}
          className={`w-full ${Icon ? 'pr-10' : 'pr-4'} pl-4 py-2 rounded-lg border text-sm transition-colors focus:outline-none ${
            canEdit
              ? 'border-gray-200 focus:border-primary-500 focus:ring-1 focus:ring-primary-500'
              : 'border-gray-100 bg-gray-50 text-gray-600 cursor-not-allowed'
          }`}
        />
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Building2 size={20} className="text-primary-600" />
          بيانات المدرسة
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
        <Input label="اسم المدرسة" name="name" icon={Building2} placeholder="مثال: مدرسة النور" />
        <Input label="الاسم بالإنجليزية" name="name_en" icon={Building2} placeholder="Al-Noor School" />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">نوع المدرسة</label>
          <select
            value={form.school_type || ''}
            onChange={e => handleChange('school_type', e.target.value)}
            disabled={!canEdit}
            className={`w-full pr-4 pl-4 py-2 rounded-lg border text-sm transition-colors focus:outline-none ${
              canEdit
                ? 'border-gray-200 focus:border-primary-500 focus:ring-1 focus:ring-primary-500'
                : 'border-gray-100 bg-gray-50 text-gray-600 cursor-not-allowed'
            }`}
          >
            <option value="">اختر نوع المدرسة</option>
            {SCHOOL_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <Input label="المحافظة / المدينة" name="city" icon={MapPin} placeholder="مثال: بغداد" />
        <Input label="المنطقة / المحافظة" name="province" icon={MapPin} placeholder="مثال: بغداد" />
        <Input label="العنوان التفصيلي" name="address" icon={MapPin} placeholder="الحي، الشارع، رقم البناء" />
        <Input label="رقم الهاتف" name="phone" icon={Phone} placeholder="0770xxxxxxx" />
        <Input label="البريد الإلكتروني" name="email" type="email" icon={Mail} placeholder="info@school.iq" />
        <Input label="الموقع الإلكتروني" name="website" icon={Globe} placeholder="https://school.iq" />
        <Input label="اسم المدير / المسؤول" name="principal_name" icon={User} placeholder="اسم المدير الكامل" />
        <Input label="رابط شعار المدرسة" name="logo_url" icon={Image} placeholder="https://..." />
        <Input label="رابط الختم الرسمي" name="official_stamp_url" icon={Image} placeholder="https://..." />
      </div>

      {/* Preview images */}
      {(form.logo_url || form.official_stamp_url) && (
        <div className="flex gap-6 items-start">
          {form.logo_url && (
            <div>
              <p className="text-xs text-gray-500 mb-1">معاينة الشعار</p>
              <img src={form.logo_url} alt="شعار المدرسة" className="h-20 w-auto rounded-lg border border-gray-200 bg-white object-contain" />
            </div>
          )}
          {form.official_stamp_url && (
            <div>
              <p className="text-xs text-gray-500 mb-1">معاينة الختم</p>
              <img src={form.official_stamp_url} alt="الختم الرسمي" className="h-20 w-auto rounded-lg border border-gray-200 bg-white object-contain" />
            </div>
          )}
        </div>
      )}
    </form>
  );
}
