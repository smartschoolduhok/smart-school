import { School, Users, Calendar, Puzzle, TrendingUp, Activity } from 'lucide-react';
import { toArabicDigits, formatArabicNumber } from '../../lib/arabicDigits';
import { useAuth } from '../../hooks/useAuth';
import { demoSchools, demoUsers, demoAcademicYears, demoModules } from '../../data/demoData';

function DashboardCard({ title, value, icon, color, subtitle }: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100',
    cyan: 'bg-cyan-50 text-cyan-600 border-cyan-100',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${colorClasses[color] || colorClasses.blue}`}>
          {icon}
        </div>
        <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">{toArabicDigits('٢٠٢٥')}</span>
      </div>
      <h3 className="text-sm font-medium text-gray-500 mb-1">{title}</h3>
      <p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>
      {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  const activeSchools = demoSchools.filter(s => s.status === 'active').length;
  const activeUsers = demoUsers.filter(u => u.status === 'active').length;
  const currentYear = demoAcademicYears.find(y => y.is_active);
  const enabledModules = demoModules.filter(m => m.id <= 5).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">لوحة التحكم</h1>
        <p className="text-sm text-gray-500 mt-1">
          مرحباً {user?.full_name}، نظرة عامة على النظام
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <DashboardCard
          title="عدد المدارس"
          value={formatArabicNumber(activeSchools)}
          icon={<School size={24} />}
          color="blue"
          subtitle="المدارس النشطة"
        />
        <DashboardCard
          title="عدد المستخدمين"
          value={formatArabicNumber(activeUsers)}
          icon={<Users size={24} />}
          color="green"
          subtitle="المستخدمون النشطون"
        />
        <DashboardCard
          title="السنة الدراسية الحالية"
          value={currentYear?.name || '---'}
          icon={<Calendar size={24} />}
          color="amber"
          subtitle="مفعّلة حالياً"
        />
        <DashboardCard
          title="الموديلات المفعلة"
          value={formatArabicNumber(enabledModules)}
          icon={<Puzzle size={24} />}
          color="purple"
          subtitle="من أصل ١٩ موديل"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">المدارس النشطة</h2>
            <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-medium">
              {formatArabicNumber(demoSchools.length)} مدرسة
            </span>
          </div>
          <div className="space-y-3">
            {demoSchools.map(school => (
              <div key={school.id} className="flex items-center justify-between p-4 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary-100 text-primary-700 rounded-lg flex items-center justify-center font-bold text-sm">
                    {school.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{school.name}</p>
                    <p className="text-xs text-gray-500">{school.city} · {school.school_type}</p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  school.status === 'active'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {school.status === 'active' ? 'نشط' : 'غير نشط'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">نشاطات حديثة</h2>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center shrink-0">
                <TrendingUp size={14} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">تم تفعيل مدرسة جديدة</p>
                <p className="text-xs text-gray-500">مدرسة الرافدين الدولية</p>
                <p className="text-xs text-gray-400 mt-1">منذ ٢ ساعة</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shrink-0">
                <Users size={14} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">مستخدم جديد تمت إضافته</p>
                <p className="text-xs text-gray-500">خالد العامري - مدرس</p>
                <p className="text-xs text-gray-400 mt-1">منذ ٥ ساعات</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center shrink-0">
                <Activity size={14} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">تحديث النظام</p>
                <p className="text-xs text-gray-500">تم تحديث إعدادات النظام</p>
                <p className="text-xs text-gray-400 mt-1">منذ يوم</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
