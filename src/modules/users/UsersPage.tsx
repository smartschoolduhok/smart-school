import { useState, useEffect } from 'react';
import { Users, Plus, Search, Mail, Building2, Shield, Loader2, AlertCircle } from 'lucide-react';
import { toArabicDigits } from '../../lib/arabicDigits';
import { getUsers } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import type { UserWithSchoolAndRole } from '../../types';

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserWithSchoolAndRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // school_id filter placeholder for future multi-tenant auth
  const schoolId = user?.school_id ?? null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: err } = await getUsers(schoolId);
      if (!cancelled) {
        if (err) setError(err);
        else if (data) setUsers(data.map((u: any) => ({
          ...u,
          role_name: u.role_name || '---',
          school_name: u.school_name || (u.school_id ? `مدرسة #${u.school_id}` : '---'),
          created_at: u.created_at ? new Date(u.created_at * 1000).toISOString().split('T')[0] : '',
        })) as UserWithSchoolAndRole[]);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">المستخدمون</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة مستخدمي النظام والموظفين</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors">
          <Plus size={18} />
          <span>إضافة مستخدم</span>
        </button>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center font-bold text-sm">
                          {user.full_name.charAt(0)}
                        </div>
                        <span className="font-medium text-gray-900">{user.full_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-gray-600">
                        <Mail size={14} />
                        <span>{user.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">
                        <Shield size={12} />
                        {user.role_name}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-gray-600">
                        <Building2 size={14} />
                        <span>{user.school_name || '---'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        user.status === 'active'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {user.status === 'active' ? 'نشط' : 'غير نشط'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
