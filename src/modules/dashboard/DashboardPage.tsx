import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Calendar, ChevronDown, ChevronLeft, GraduationCap, Loader2, School, Users } from 'lucide-react';
import { formatArabicNumber, toArabicDigits } from '../../lib/arabicDigits';
import { useAuth } from '../../hooks/useAuth';
import { getDashboardStats, getStudents } from '../../lib/api';
import { getDailyNavigationItems, getVisibleNavigationGroups } from '../../components/navigation';

interface DashboardStats {
  active_schools: number;
  active_users: number;
  total_users: number;
  current_academic_year: string;
  total_modules: number;
  core_modules: number;
}
interface LinkedStudent { id: number; full_name: string; student_number: string; class_name?: string | null; section_name?: string | null; }
const EMPTY_STATS: DashboardStats = { active_schools: 0, active_users: 0, total_users: 0, current_academic_year: '---', total_modules: 0, core_modules: 0 };

function DashboardCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode; }) {
  return <div className="flex min-w-0 items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500">{icon}</span>
    <div className="min-w-0"><p className="text-xs text-slate-500">{title}</p><p className="mt-1 break-words text-xl font-bold text-slate-800 sm:text-2xl"><bdi dir="ltr">{value}</bdi></p></div>
  </div>;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [linkedStudents, setLinkedStudents] = useState<LinkedStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const isSystemAdmin = user?.role_key === 'system_admin';
  const isParent = user?.role_key === 'parent';
  const quickActions = useMemo(() => getDailyNavigationItems(user?.role_key), [user?.role_key]);
  const groups = useMemo(() => getVisibleNavigationGroups(user?.role_key), [user?.role_key]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setStats(EMPTY_STATS);
      setLinkedStudents([]);
      if (isParent) {
        if (user?.school_id == null) {
          setError('حساب ولي الأمر غير مرتبط بمدرسة');
          setLoading(false);
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
  }, [isParent, user?.id, user?.school_id, user?.role_key, retry]);

  if (loading) return <div role="status" className="flex flex-col items-center justify-center gap-3 p-12 text-slate-500"><Loader2 size={28} className="animate-spin text-primary-600" /><p className="text-sm">جاري تحميل لوحة التحكم...</p></div>;
  if (error) return <div className="rounded-xl border border-red-100 bg-white p-8 text-center"><AlertCircle className="mx-auto text-red-600" size={28} /><p role="alert" className="mt-3 text-sm text-red-700">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100">إعادة المحاولة</button></div>;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-slate-900">{isParent ? 'متابعة أبنائي' : 'لوحة التحكم'}</h1><p className="mt-2 text-sm leading-6 text-slate-500">مرحباً {user?.full_name}، {isParent ? 'تجد هنا ملفات الأبناء المرتبطين بحسابك.' : 'اختر مهمة للبدء، أو تصفّح أقسام المدرسة.'}</p></div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">{user?.role_name}</span>
      </div>

      {!isParent && <div className={`grid gap-3 sm:gap-4 ${isSystemAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {isSystemAdmin && <DashboardCard title="المدارس النشطة" value={formatArabicNumber(stats.active_schools)} icon={<School size={22} />} />}
        <DashboardCard title="المستخدمون النشطون" value={formatArabicNumber(stats.active_users)} icon={<Users size={22} />} />
        <DashboardCard title="السنة الدراسية الحالية" value={stats.current_academic_year || '---'} icon={<Calendar size={22} />} />
      </div>}

      {isParent && (linkedStudents.length === 0
        ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center"><GraduationCap className="mx-auto mb-3 text-amber-600" size={38} /><h2 className="font-bold text-slate-900">لا يوجد طالب مرتبط بالحساب</h2><p className="mt-2 text-sm text-amber-800">اطلب من إدارة المدرسة ربط حسابك بملف الطالب.</p></div>
        : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{linkedStudents.map(student => <Link key={student.id} to={`/students/${student.id}`} className="rounded-xl border border-slate-200 bg-white p-5 text-right hover:border-primary-300 hover:shadow-sm"><span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700"><GraduationCap size={22} /></span><h2 className="font-bold text-slate-900">{student.full_name}</h2><p className="mt-1 text-xs text-slate-500">{toArabicDigits(student.student_number)}</p><p className="mt-3 text-sm text-slate-600">{student.class_name || 'لا يوجد صف حالي'}{student.section_name ? ` / ${student.section_name}` : ''}</p></Link>)}</div>)}

      <section aria-labelledby="daily-actions-heading" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 id="daily-actions-heading" className="text-base font-bold text-slate-900">وصول سريع</h2>
        <p className="mt-1 text-xs leading-6 text-slate-500">اختصارات المهام اليومية</p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {quickActions.map(item => <Link key={item.path} to={item.path} className="group flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 px-3 py-3.5 text-sm font-semibold text-slate-700 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">{item.icon}</span><span className="min-w-0 flex-1">{item.label}</span><ChevronLeft size={16} className="shrink-0 text-slate-400 group-hover:text-primary-600" /></Link>)}
        </div>
      </section>

      {!isParent && <section aria-labelledby="school-sections-heading">
        <div className="mb-3"><h2 id="school-sections-heading" className="text-base font-bold text-slate-900">أقسام النظام</h2><p className="mt-1 text-xs leading-6 text-slate-500">افتح القسم للوصول إلى جميع صفحاته</p></div>
        <div className="grid items-start gap-3 md:grid-cols-2">
          {groups.map(group => <details key={group.key} name="dashboard-sections" className="group rounded-xl border border-slate-200 bg-white open:border-primary-200">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 [&::-webkit-details-marker]:hidden hover:bg-slate-50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">{group.icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">{group.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{group.description}</span></span><ChevronDown size={16} className="shrink-0 text-slate-400 group-open:rotate-180" />
            </summary>
            <div className="mx-4 flex flex-col border-t border-slate-100 py-2">{group.items.map(item => <Link key={item.path} to={item.path} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-primary-50 hover:text-primary-700">{item.label}<ChevronLeft size={14} className="shrink-0" /></Link>)}</div>
          </details>)}
        </div>
      </section>}
    </div>
  );
}
