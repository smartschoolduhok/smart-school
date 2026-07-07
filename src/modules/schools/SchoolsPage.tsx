import { useState, useEffect } from 'react';
import { School, Plus, Search, MapPin, Calendar, Loader2, AlertCircle, Pencil, Archive, X, Save } from 'lucide-react';
import { toArabicDigits } from '../../lib/arabicDigits';
import { getSchools, createSchool, updateSchool, archiveSchool } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import type { School as SchoolType } from '../../types';

const SCHOOL_TYPES = [
  { value: 'public', label: 'حكومية' },
  { value: 'private', label: 'أهلية' },
  { value: 'international', label: 'دولية' },
];

const emptyForm = {
  name: '',
  name_en: '',
  school_type: '',
  city: '',
  province: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  principal_name: '',
  logo_url: '',
  official_stamp_url: '',
  status: 'active',
};

export default function SchoolsPage() {
  const { user } = useAuth();
  const [schools, setSchools] = useState<SchoolType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, any>>(emptyForm);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canManage = user?.role_key === 'system_admin';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: err } = await getSchools();
      if (!cancelled) {
        if (err) setError(err);
        else if (data) setSchools(data.map((s: any) => ({
          ...s,
          created_at: s.created_at ? new Date(s.created_at * 1000).toISOString().split('T')[0] : '',
        })) as SchoolType[]);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = schools.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.city.toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(school: SchoolType) {
    setEditingId(school.id);
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
      status: school.status || 'active',
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);
    try {
      if (editingId) {
        const { error: err } = await updateSchool(editingId, form);
        if (err) {
          setFormError(err);
        } else {
          setModalOpen(false);
          // reload list
          const { data } = await getSchools();
          if (data) setSchools(data.map((s: any) => ({
            ...s,
            created_at: s.created_at ? new Date(s.created_at * 1000).toISOString().split('T')[0] : '',
          })) as SchoolType[]);
        }
      } else {
        const { error: err } = await createSchool(form);
        if (err) {
          setFormError(err);
        } else {
          setModalOpen(false);
          const { data } = await getSchools();
          if (data) setSchools(data.map((s: any) => ({
            ...s,
            created_at: s.created_at ? new Date(s.created_at * 1000).toISOString().split('T')[0] : '',
          })) as SchoolType[]);
        }
      }
    } catch (e: any) {
      setFormError(e?.message || 'حدث خطأ');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleArchive(id: number) {
    if (!window.confirm('هل أنت متأكد من أرشفة هذه المدرسة؟')) return;
    setLoading(true);
    const { error: err } = await archiveSchool(id);
    if (err) {
      setError(err);
    } else {
      const { data } = await getSchools();
      if (data) setSchools(data.map((s: any) => ({
        ...s,
        created_at: s.created_at ? new Date(s.created_at * 1000).toISOString().split('T')[0] : '',
      })) as SchoolType[]);
    }
    setLoading(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">المدارس</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة المدارس المسجلة في النظام</p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={18} />
            <span>إضافة مدرسة</span>
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="بحث في المدارس..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pr-10 pl-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        {loading && (
          <div className="p-12 flex flex-col items-center justify-center gap-3 text-gray-500">
            <Loader2 size={28} className="animate-spin text-primary-600" />
            <p className="text-sm">جاري تحميل المدارس...</p>
          </div>
        )}

        {error && !loading && (
          <div className="p-8 flex flex-col items-center justify-center gap-3 text-red-600">
            <AlertCircle size={28} />
            <p className="text-sm">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-sm font-medium transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-12 text-center text-gray-500 text-sm">
            لا توجد نتائج للبحث
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-6 py-3 text-right font-semibold">اسم المدرسة</th>
                  <th className="px-6 py-3 text-right font-semibold">النوع</th>
                  <th className="px-6 py-3 text-right font-semibold">المحافظة</th>
                  <th className="px-6 py-3 text-right font-semibold">الحالة</th>
                  <th className="px-6 py-3 text-right font-semibold">تاريخ الإنشاء</th>
                  {canManage && <th className="px-6 py-3 text-right font-semibold">إجراءات</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((school) => (
                  <tr key={school.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-primary-100 text-primary-700 rounded-lg flex items-center justify-center font-bold text-sm">
                          {school.name.charAt(0)}
                        </div>
                        <span className="font-medium text-gray-900">{school.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{school.school_type}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-gray-600">
                        <MapPin size={14} />
                        <span>{school.city}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        school.status === 'active'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {school.status === 'active' ? 'نشط' : 'غير نشط'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-gray-500">
                        <Calendar size={14} />
                        <span>{toArabicDigits(school.created_at)}</span>
                      </div>
                    </td>
                    {canManage && (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEdit(school)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="تعديل"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => handleArchive(school.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="أرشفة"
                          >
                            <Archive size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                {editingId ? 'تعديل مدرسة' : 'إضافة مدرسة'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
                  <AlertCircle size={16} />
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">اسم المدرسة *</label>
                  <input
                    required
                    value={form.name || ''}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="مثال: مدرسة النور"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">الاسم بالإنجليزية</label>
                  <input
                    value={form.name_en || ''}
                    onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="Al-Noor School"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">النوع</label>
                  <select
                    value={form.school_type || ''}
                    onChange={e => setForm(f => ({ ...f, school_type: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="">اختر النوع</option>
                    {SCHOOL_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">المدينة</label>
                  <input
                    value={form.city || ''}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="مثال: أربيل"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">المحافظة</label>
                  <input
                    value={form.province || ''}
                    onChange={e => setForm(f => ({ ...f, province: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="مثال: أربيل"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">العنوان</label>
                  <input
                    value={form.address || ''}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="العنوان التفصيلي"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">الهاتف</label>
                  <input
                    value={form.phone || ''}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="0750 123 4567"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={form.email || ''}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="school@example.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">الموقع الإلكتروني</label>
                  <input
                    value={form.website || ''}
                    onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="https://school.example.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">اسم المدير</label>
                  <input
                    value={form.principal_name || ''}
                    onChange={e => setForm(f => ({ ...f, principal_name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="اسم المدير"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">رابط الشعار</label>
                  <input
                    value={form.logo_url || ''}
                    onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">رابط الختم</label>
                  <input
                    value={form.official_stamp_url || ''}
                    onChange={e => setForm(f => ({ ...f, official_stamp_url: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">الحالة</label>
                  <select
                    value={form.status || 'active'}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="active">نشط</option>
                    <option value="inactive">غير نشط</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {formLoading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  <span>{editingId ? 'حفظ التعديلات' : 'إنشاء'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
