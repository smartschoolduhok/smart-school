import { School, Plus, Search, MapPin, Calendar } from 'lucide-react';
import { toArabicDigits } from '../../lib/arabicDigits';
import { demoSchools } from '../../data/demoData';
import { useAuth } from '../../hooks/useAuth';

export default function SchoolsPage() {
  const { user } = useAuth();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">المدارس</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة المدارس المسجلة في النظام</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors">
          <Plus size={18} />
          <span>إضافة مدرسة</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="بحث في المدارس..."
              className="w-full pr-10 pl-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-6 py-3 text-right font-semibold">اسم المدرسة</th>
                <th className="px-6 py-3 text-right font-semibold">النوع</th>
                <th className="px-6 py-3 text-right font-semibold">المحافظة</th>
                <th className="px-6 py-3 text-right font-semibold">الحالة</th>
                <th className="px-6 py-3 text-right font-semibold">تاريخ الإنشاء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {demoSchools.map((school) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
