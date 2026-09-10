import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Calendar, GraduationCap, Loader2, Puzzle, School, Users } from 'lucide-react';
import { formatArabicNumber, toArabicDigits } from '../../lib/arabicDigits';
import { useAuth } from '../../hooks/useAuth';
import { getDashboardStats, getStudents } from '../../lib/api';
import { getVisibleNavigationItems } from '../../components/Sidebar';

interface DashboardStats {
  active_schools: number;
  active_users: number;
  total_users: number;
  current_academic_year: string;
  total_modules: number;
  core_modules: number;
}

interface LinkedStudent {
  id: number;
  full_name: string;
  student_number: string;
  class_name?: string | null;
  section_name?: string | null;
}

const EMPTY_STATS: DashboardStats = {
  active_schools: 0,
  active_users: 0,
  total_users: 0,
  current_academic_year: '---',
  total_modules: 0,
  core_modules: 0,
};

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
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md sm:p-6">
      <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg ${colorClasses[color] || colorClasses.blue}`}>{icon}</div>
      <h3 className="mb-1 text-sm font-medium text-gray-500">{title}</h3>
      <p className="mb-1 text-3xl font-bold text-gray-900">{value}</p>
      {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [linkedStudents, setLinkedStudents] = useState<LinkedStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isSystemAdmin = user?.role_key === 'system_admin';
  const isParent = user?.role_key === 'parent';
  const quickActions = useMemo(() => getVisibleNavigationItems(user?.role_key)
    .filter(item => item.path !== '/')
    .slice(0, 6), [user?.role_key]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      if (isParent) {
        if (user?.school_id == null) {
          if (!cancelled) {
            setError('حساب ولي الأمر غير مرتبط بمدرسة');
            setLoading(false);
          }
          return;
        }
        const response = await getStudents(user.school_id);
        if (!cancelled) {
          if (response.error) setError(response.error);
          else setLinkedStudents((response.data || []) as LinkedStudent[]);
          setLoading(false);
        }
        return;
      }

      const response = await getDashboardStats();
      if (!cancelled) {
        if (response.error) setError(response.error);
        else if (response.data) setStats(response.data);
        setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [isParent, user?.school_id]);

  if (loading) {
    return <div className="flex flex-col items-center justify-center gap-3 p-12 text-gray-500"><Loader2 size={28} className="animate-spin text-primary-600" /><p className="text-sm">جاري تحميل لوحة التحكم...</p></div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-red-600">
        <AlertCircle size={28} />
        <p className="text-sm">{error}</p>
        <button onClick={() => window.location.reload()} className="rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100">إعادة المحاولة</button>
      </div>
    );
  }

  if (isParent) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">مرحباً {user?.full_name}</h1>
          <p className="mt-1 text-sm text-gray-500">متابعة الأبناء المرتبطين بحسابك</p>
        </div>
        {linkedStudents.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
            <GraduationCap className="mx-auto mb-3 text-amber-600" size={38} />
            <h2 className="font-bold text-gray-900">لا يوجد طالب مرتبط بالحساب</h2>
            <p className="mt-2 text-sm text-amber-800">اطلب من إدارة المدرسة ربط حسابك بملف الطالب.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {linkedStudents.map(student => (
              <button key={student.id} type="button" onClick={() => navigate(`/students/${student.id}`)} className="rounded-xl border border-gray-200 bg-white p-5 text-right transition hover:border-primary-300 hover:shadow-md">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700"><GraduationCap size={22} /></div>
                <h2 className="font-bold text-gray-900">{student.full_name}</h2>
                <p className="mt-1 text-xs text-gray-500">{toArabicDigits(student.student_number)}</p>
                <p className="mt-3 text-sm text-gray-600">{student.class_name || 'لا يوجد صف حالي'}{student.section_name ? ` / ${student.section_name}` : ''}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">لوحة التحكم</h1>
        <p className="mt-1 text-sm text-gray-500">مرحباً {user?.full_name}، نظرة عامة واختصارات حسب صلاحيتك</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 sm:gap-6">
        {isSystemAdmin && <DashboardCard title="عدد المدارس" value={formatArabicNumber(stats.active_schools)} icon={<School size={24} />} color="blue" subtitle="المدارس النشطة" />}
        <DashboardCard title="عدد المستخدمين" value={formatArabicNumber(stats.active_users)} icon={<Users size={24} />} color="green" subtitle="المستخدمون النشطون" />
        <DashboardCard title="السنة الدراسية الحالية" value={stats.current_academic_year || '---'} icon={<Calendar size={24} />} color="amber" subtitle="مفعّلة حالياً" />
        <DashboardCard title="الوحدات المفعلة" value={formatArabicNumber(stats.core_modules)} icon={<Puzzle size={24} />} color="purple" subtitle={`من أصل ${toArabicDigits(String(stats.total_modules))} وحدة`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-bold text-gray-900">ابدأ مهمة</h2>
          <p className="mt-1 text-sm text-gray-500">الصفحات الأكثر صلة بدورك</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {quickActions.map(item => (
              <button key={item.path} type="button" onClick={() => navigate(item.path)} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-right text-sm font-medium text-gray-700 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
                <span className="text-primary-600">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-bold text-gray-900">الحساب الحالي</h2>
          <div className="mt-4 rounded-lg bg-gray-50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-sm font-bold text-primary-700">{(user?.school_name || user?.full_name || 'م').charAt(0)}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{user?.school_name || 'الإدارة المركزية'}</p>
                <p className="truncate text-xs text-gray-500">{user?.role_name || '---'}</p>
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-gray-500">تعرض القائمة والاختصارات الوظائف المتاحة لحسابك فقط. لا تُعرض وحدات مستقبلية غير مفعّلة.</p>
        </section>
      </div>
    </div>
  );
}
