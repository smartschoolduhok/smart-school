import { useState, useEffect } from 'react';
import { Shield, Lock, Eye, Loader2, AlertCircle } from 'lucide-react';
import { getRoles, getRolePermissions } from '../../lib/api';
import type { AuthUser } from '../../types';

interface PermissionRow {
  id: number;
  key: string;
  name: string;
  resource: string;
  action: string;
}

interface RoleRow {
  id: number;
  key: string;
  name: string;
  permissions: number[];
}

export default function SecurityTab({ user }: { user: AuthUser | null }) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [{ data: rolesData, error: rolesErr }, { data: rpData, error: rpErr }] = await Promise.all([
          getRoles(),
          getRolePermissions(),
        ]);
        if (cancelled) return;
        if (rolesErr || rpErr) {
          setError(rolesErr || rpErr || 'فشل في جلب البيانات');
          setLoading(false);
          return;
        }

        // Unique permissions
        const permMap = new Map<number, PermissionRow>();
        if (rpData) {
          for (const rp of rpData) {
            if (!permMap.has(rp.permission_id)) {
              permMap.set(rp.permission_id, {
                id: rp.permission_id,
                key: rp.permission_key,
                name: rp.permission_name,
                resource: rp.resource || rp.permission_key.split('_')[0] || 'عام',
                action: rp.action || rp.permission_key.split('_')[1] || 'عرض',
              });
            }
          }
        }
        const allPerms = Array.from(permMap.values());

        // Roles with their permission ids
        const roleMap = new Map<number, number[]>();
        if (rpData) {
          for (const rp of rpData) {
            const list = roleMap.get(rp.role_id) || [];
            list.push(rp.permission_id);
            roleMap.set(rp.role_id, list);
          }
        }

        const rolesRows: RoleRow[] = (rolesData || []).map((r: any) => ({
          id: r.id,
          key: r.key,
          name: r.name,
          permissions: roleMap.get(r.id) || [],
        }));

        setRoles(rolesRows);
        setPermissions(allPerms);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'فشل في جلب البيانات');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-gray-500">
        <Loader2 size={20} className="animate-spin" />
        <span>جاري تحميل بيانات الأمان والصلاحيات...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-700">
        <AlertCircle size={20} />
        <p className="font-medium">{error}</p>
      </div>
    );
  }

  const currentRole = roles.find(r => r.key === user?.role_key);

  return (
    <div className="space-y-8">
      {/* My Role */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Shield size={20} className="text-primary-600" />
          دورك الحالي في النظام
        </h3>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center">
            <Lock size={20} className="text-primary-600" />
          </div>
          <div>
            <p className="text-base font-bold text-gray-900">{currentRole?.name || user?.role_name || 'غير معروف'}</p>
            <p className="text-sm text-gray-500">المعرف: <span className="font-mono text-xs">{user?.role_key || '-'}</span></p>
          </div>
          <div className="mr-auto">
            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-sm font-medium px-3 py-1.5 rounded-lg">
              <Eye size={14} />
              وضع عرض فقط
            </span>
          </div>
        </div>
      </div>

      {/* Roles table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">الأدوار وعدد الصلاحيات</h3>
          <p className="text-sm text-gray-500 mt-1">عرض لجميع الأدوار المُعرّفة في النظام وعدد الصلاحيات المرتبطة بكل دور</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-right px-6 py-3 font-semibold text-gray-700">الدور</th>
                <th className="text-right px-6 py-3 font-semibold text-gray-700">المعرف</th>
                <th className="text-right px-6 py-3 font-semibold text-gray-700">عدد الصلاحيات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {roles.map(role => (
                <tr key={role.id} className={role.key === user?.role_key ? 'bg-primary-50' : ''}>
                  <td className="px-6 py-3 font-medium text-gray-900">
                    {role.name}
                    {role.key === user?.role_key && (
                      <span className="inline-block mr-2 bg-primary-100 text-primary-700 text-xs font-bold px-2 py-0.5 rounded-full">
                        أنت
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-500 font-mono text-xs">{role.key}</td>
                  <td className="px-6 py-3 text-gray-700">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-900 font-bold text-xs">
                      {role.permissions.length}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permissions matrix */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">مصفوفة الصلاحيات</h3>
          <p className="text-sm text-gray-500 mt-1">عرض جميع الصلاحيات المُعرّفة في النظام</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-right px-6 py-3 font-semibold text-gray-700">المورد</th>
                <th className="text-right px-6 py-3 font-semibold text-gray-700">الإجراء</th>
                <th className="text-right px-6 py-3 font-semibold text-gray-700">اسم الصلاحية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {permissions.map(p => (
                <tr key={p.id}>
                  <td className="px-6 py-3 text-gray-700">{p.resource}</td>
                  <td className="px-6 py-3 text-gray-700">{p.action}</td>
                  <td className="px-6 py-3 text-gray-900 font-medium">{p.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {permissions.length === 0 && (
          <div className="px-6 py-8 text-center text-gray-500">
            لا توجد صلاحيات مُعرّفة في النظام حالياً
          </div>
        )}
      </div>

      {/* Read-only notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 text-amber-800">
        <AlertCircle size={20} />
        <div>
          <p className="font-medium">إدارة الأدوار والصلاحيات تتم من خلال صفحة الأدوار</p>
          <p className="text-sm mt-0.5">لتعديل الأدوار أو الصلاحيات، انتقل إلى <a href="/roles" className="underline font-semibold hover:text-amber-900">إدارة الأدوار</a> من القائمة الجانبية</p>
        </div>
      </div>
    </div>
  );
}
