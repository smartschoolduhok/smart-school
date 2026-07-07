import { useState, useEffect } from 'react';
import { Users, Plus, Search, Mail, Building2, Shield, Loader2, AlertCircle, Pencil, Lock, ToggleLeft, ToggleRight, X, Save } from 'lucide-react';
import { toArabicDigits } from '../../lib/arabicDigits';
import { getUsers, getSchools, getRoles, createUser, updateUser, updateUserStatus, resetUserPassword } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import type { UserWithSchoolAndRole } from '../../types';

interface RoleOption {
  id: number;
  key: string;
  name: string;
}

interface SchoolOption {
  id: number;
  name: string;
}

const emptyForm = {
  full_name: '',
  email: '',
  password: '',
  role_id: '',
  role_key: '',
  school_id: '',
  phone: '',
  status: 'active',
};

const ROLE_KEY_LABELS: Record<string, string> = {
  system_admin: 'مدير النظام',
  school_owner: 'مالك المدرسة',
  principal: 'مدير المدرسة',
  vice_principal: 'نائب المدير',
  teacher: 'معلم',
  accountant: 'محاسب',
  registrar: 'مسجل',
  parent: 'ولي أمر',
};

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserWithSchoolAndRole[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, any>>(emptyForm);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const canManage = user?.role_key === 'system_admin';
  const schoolId = user?.school_id ?? null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const [{ data: usersData, error: usersErr }, { data: rolesData, error: rolesErr }, { data: schoolsData, error: schoolsErr }] = await Promise.all([
        getUsers(schoolId),
        getRoles(),
        getSchools(),
      ]);
      if (!cancelled) {
        if (usersErr) setError(usersErr);
        else if (usersData) setUsers(usersData.map((u: any) => ({
          ...u,
          role_name: u.role_name || ROLE_KEY_LABELS[u.role_key] || '---',
          school_name: u.school_name || (u.school_id ? `مدرسة #${u.school_id}` : '---'),
          created_at: u.created_at ? new Date(u.created_at * 1000).toISOString().split('T')[0] : '',
        })) as UserWithSchoolAndRole[]);
        if (rolesData) setRoles(rolesData.map((r: any) => ({ id: r.id, key: r.key, name: r.name })));
        if (schoolsData) setSchools(schoolsData.map((s: any) => ({ id: s.id, name: s.name })));
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [schoolId]);

  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.role_name || '').toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, password: '' });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(u: UserWithSchoolAndRole) {
    setEditingId(u.id);
    const role = roles.find(r => r.key === u.role_key);
    setForm({
      full_name: u.full_name || '',
      email: u.email || '',
      password: '',
      role_id: role?.id ? String(role.id) : '',
      role_key: u.role_key || '',
      school_id: u.school_id ? String(u.school_id) : '',
      phone: u.phone || '',
      status: u.status || 'active',
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);
    try {
      const payload: Record<string, any> = {
        ...form,
        role_id: form.role_id ? Number(form.role_id) : undefined,
        school_id: form.school_id ? Number(form.school_id) : null,
      };
      if (editingId) {
        // Remove password from update payload if empty
        const updatePayload = { ...payload };
        if (!updatePayload.password) delete updatePayload.password;
        const { error: err } = await updateUser(editingId, updatePayload);
        if (err) setFormError(err);
        else {
          setModalOpen(false);
          reloadUsers();
        }
      } else {
        if (!payload.password) {
          setFormError('كلمة المرور مطلوبة عند الإنشاء');
          setFormLoading(false);
          return;
        }
        const { error: err } = await createUser(payload);
        if (err) setFormError(err);
        else {
          setModalOpen(false);
          reloadUsers();
        }
      }
    } catch (e: any) {
      setFormError(e?.message || 'حدث خطأ');
    } finally {
      setFormLoading(false);
    }
  }

  async function reloadUsers() {
    const { data } = await getUsers(schoolId);
    if (data) setUsers(data.map((u: any) => ({
      ...u,
      role_name: u.role_name || ROLE_KEY_LABELS[u.role_key] || '---',
      school_name: u.school_name || (u.school_id ? `مدرسة #${u.school_id}` : '---'),
      created_at: u.created_at ? new Date(u.created_at * 1000).toISOString().split('T')[0] : '',
    })) as UserWithSchoolAndRole[]);
  }

  async function handleToggleStatus(u: UserWithSchoolAndRole) {
    const newStatus = u.status === 'active' ? 'inactive' : 'active';
    if (!window.confirm(`هل أنت متأكد من ${newStatus === 'active' ? 'تفعيل' : 'تعطيل'} هذا المستخدم؟`)) return;
    setLoading(true);
    const { error: err } = await updateUserStatus(u.id, newStatus as 'active' | 'inactive');
    if (err) setError(err);
    else reloadUsers();
    setLoading(false);
  }

  function openResetPassword(userId: number) {
    setResetUserId(userId);
    setResetPassword('');
    setResetError(null);
    setResetModalOpen(true);
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetPassword || resetPassword.length < 6) {
      setResetError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    setResetLoading(true);
    setResetError(null);
    if (resetUserId) {
      const { error: err } = await resetUserPassword(resetUserId, resetPassword);
      if (err) setResetError(err);
      else {
        setResetModalOpen(false);
        setResetUserId(null);
        setResetPassword('');
      }
    }
    setResetLoading(false);
  }

  const selectedRoleKey = roles.find(r => String(r.id) === String(form.role_id))?.key || '';
  const requiresSchool = ['school_owner', 'principal', 'vice_principal', 'teacher', 'accountant', 'registrar', 'parent'].includes(selectedRoleKey);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">المستخدمون</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة مستخدمي النظام والموظفين</p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={18} />
            <span>إضافة مستخدم</span>
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="بحث في المستخدمين..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pr-10 pl-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        {loading && (
          <div className="p-12 flex flex-col items-center justify-center gap-3 text-gray-500">
            <Loader2 size={28} className="animate-spin text-primary-600" />
            <p className="text-sm">جاري تحميل المستخدمين...</p>
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
            {search ? 'لا توجد نتائج للبحث' : 'لا يوجد مستخدمون'}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-6 py-3 text-right font-semibold">الاسم</th>
                  <th className="px-6 py-3 text-right font-semibold">البريد الإلكتروني</th>
                  <th className="px-6 py-3 text-right font-semibold">الدور</th>
                  <th className="px-6 py-3 text-right font-semibold">المدرسة</th>
                  <th className="px-6 py-3 text-right font-semibold">الحالة</th>
                  {canManage && <th className="px-6 py-3 text-right font-semibold">إجراءات</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center font-bold text-sm">
                          {u.full_name.charAt(0)}
                        </div>
                        <span className="font-medium text-gray-900">{u.full_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-gray-600">
                        <Mail size={14} />
                        <span>{u.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">
                        <Shield size={12} />
                        {u.role_name}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-gray-600">
                        <Building2 size={14} />
                        <span>{u.school_name || '---'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        u.status === 'active'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {u.status === 'active' ? 'نشط' : 'غير نشط'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEdit(u)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="تعديل"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => openResetPassword(u.id)}
                            className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="إعادة تعيين كلمة المرور"
                          >
                            <Lock size={16} />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(u)}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title={u.status === 'active' ? 'تعطيل' : 'تفعيل'}
                          >
                            {u.status === 'active' ? <ToggleRight size={20} className="text-emerald-600" /> : <ToggleLeft size={20} className="text-gray-400" />}
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

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                {editingId ? 'تعديل مستخدم' : 'إضافة مستخدم'}
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
                  <label className="text-sm font-medium text-gray-700">الاسم الكامل *</label>
                  <input
                    required
                    value={form.full_name || ''}
                    onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="الاسم الثلاثي"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">البريد الإلكتروني *</label>
                  <input
                    type="email"
                    required
                    value={form.email || ''}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="example@school.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">{editingId ? 'كلمة المرور (اتركها فارغة للإبقاء على الحالية)' : 'كلمة المرور *'}</label>
                  <input
                    type="password"
                    required={!editingId}
                    value={form.password || ''}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    placeholder="••••••"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">الدور *</label>
                  <select
                    required
                    value={form.role_id || ''}
                    onChange={e => {
                      const roleId = e.target.value;
                      const role = roles.find(r => String(r.id) === roleId);
                      setForm(f => ({ ...f, role_id: roleId, role_key: role?.key || '' }));
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="">اختر الدور</option>
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">المدرسة {requiresSchool && '*'}</label>
                  <select
                    required={requiresSchool}
                    value={form.school_id || ''}
                    onChange={e => setForm(f => ({ ...f, school_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="">{requiresSchool ? 'اختر المدرسة' : 'بدون مدرسة'}</option>
                    {schools.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {selectedRoleKey === 'system_admin' && (
                    <p className="text-xs text-gray-400">يمكن ترك المدرسة فارغة لمدير النظام</p>
                  )}
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

      {/* Reset Password Modal */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">إعادة تعيين كلمة المرور</h2>
              <button onClick={() => setResetModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="p-6 space-y-4">
              {resetError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
                  <AlertCircle size={16} />
                  {resetError}
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">كلمة المرور الجديدة</label>
                <input
                  type="password"
                  required
                  value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  placeholder="••••••"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setResetModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {resetLoading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                  <span>تحديث</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
