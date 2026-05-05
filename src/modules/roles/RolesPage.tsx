import { useState, useEffect } from 'react';
import { Shield, Users, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { toArabicDigits } from '../../lib/arabicDigits';
import { getRoles, getRolePermissions } from '../../lib/api';
import type { Role, Permission } from '../../types';

interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const [{ data: rolesData, error: rolesErr }, { data: rpData, error: rpErr }] = await Promise.all([
        getRoles(),
        getRolePermissions(),
      ]);
      if (!cancelled) {
        if (rolesErr || rpErr) {
          setError(rolesErr || rpErr || 'فشل في جلب البيانات');
          setLoading(false);
          return;
        }
        if (rolesData && rpData) {
          const permissionsMap = new Map<number, Permission[]>();
          for (const rp of rpData) {
            const list = permissionsMap.get(rp.role_id) || [];
            list.push({
              id: rp.permission_id,
              key: rp.permission_key,
              name: rp.permission_name,
              description: '',
            });
            permissionsMap.set(rp.role_id, list);
          }
          const rolesWithPerms: RoleWithPermissions[] = rolesData.map((r: any) => ({
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description || '',
            permissions: permissionsMap.get(r.id) || [],
          }));
          setRoles(rolesWithPerms);
        }
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">الأدوار والصلاحيات</h1>
        <p className="text-sm text-gray-500 mt-1">إدارة الأدوار وصلاحيات الوصول لكل مستوى</p>
      </div>

      {loading && (
        <div className="p-12 flex flex-col items-center justify-center gap-3 text-gray-500">
          <Loader2 size={28} className="animate-spin text-primary-600" />
          <p className="text-sm">جاري تحميل الأدوار...</p>
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

      {!loading && !error && roles.length === 0 && (
        <div className="p-12 text-center text-gray-500 text-sm">
          لا توجد أدوار
        </div>
      )}

      {!loading && !error && roles.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {roles.map((role) => (
            <div key={role.id} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary-50 text-primary-600 rounded-lg flex items-center justify-center">
                    <Shield size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">{role.name}</h3>
                    <p className="text-xs text-gray-500">{role.description || '---'}</p>
                  </div>
                </div>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                  {toArabicDigits(role.permissions.length.toString())} صلاحية
                </span>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">الصلاحيات</h4>
                <div className="flex flex-wrap gap-2">
                  {role.permissions.length === 0 && (
                    <span className="text-xs text-gray-400">لا توجد صلاحيات</span>
                  )}
                  {role.permissions.map((permission) => (
                    <span
                      key={permission.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium border border-emerald-100"
                    >
                      <CheckCircle2 size={12} />
                      {permission.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Users size={16} />
                  <span>مستخدمون: <span className="font-semibold text-gray-700">--</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                    role.key === 'system_admin'
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                  }`}>
                    {role.key === 'system_admin' ? (
                      <>
                        <CheckCircle2 size={12} />
                        صلاحيات كاملة
                      </>
                    ) : (
                      <>
                        <XCircle size={12} />
                        صلاحيات محدودة
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
