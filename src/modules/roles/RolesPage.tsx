import { Shield, Users, CheckCircle2, XCircle } from 'lucide-react';
import { getRolesWithPermissions } from '../../data/demoData';

export default function RolesPage() {
  const roles = getRolesWithPermissions();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">الأدوار والصلاحيات</h1>
        <p className="text-sm text-gray-500 mt-1">إدارة الأدوار وصلاحيات الوصول لكل مستوى</p>
      </div>

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
                  <p className="text-xs text-gray-500">{role.description}</p>
                </div>
              </div>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                {role.permissions.length} صلاحية
              </span>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">الصلاحيات</h4>
              <div className="flex flex-wrap gap-2">
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
    </div>
  );
}
