import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { fetchApi } from '../../lib/api';
import { baghdadDate } from '../../lib/admissionDates';
import { AGE_STATUS_LABELS, formatAge, type AgeStatus } from '../../lib/studentAge';
import type { StudentAgeReviewPage as ReviewPage, StudentAgeReviewRow } from '../../lib/studentAgeDb';
import { useSchoolOptions, workflowInput as input, workflowButton as button } from './useSchoolOptions';
import { AgeRuleSummary } from './AgeRuleSummary';
import { DateText } from './DateText';

const needsAttention = (row: StudentAgeReviewRow) => !['within_limits', 'not_applicable', 'documented_exception'].includes(row.age_check.status);
export default function StudentAgeReviewPage() {
  const scope = useTenantSchool(), { schoolId } = scope, options = useSchoolOptions(schoolId, false);
  const [year, setYear] = useState(''), [classId, setClass] = useState(''), [section, setSection] = useState('');
  const [date, setDate] = useState(baghdadDate), [status, setStatus] = useState('all');
  const [loaded, setLoaded] = useState<{ key: string; rows: StudentAgeReviewRow[]; next: number | null } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const requestId = useRef(0), currentKey = useRef('');
  const key = JSON.stringify([schoolId, year, classId, section, date, refresh]); currentKey.current = key;
  const current = loaded?.key === key ? loaded : null;
  const rows = current?.rows ?? [], attention = rows.filter(needsAttention).length;
  const visible = rows.filter(row => status === 'all' || (status === 'attention' ? needsAttention(row) : row.age_check.status === status));
  useEffect(() => { setYear(''); setClass(''); setSection(''); setStatus('all'); }, [schoolId]);
  useEffect(() => { if (!year && options.years.length) setYear(String((options.years.find(y => y.is_active) ?? options.years[0]).id)); }, [options.years, year]);

  async function load(after?: number) {
    if (!schoolId || !year || !date) return;
    const captured = key, token = ++requestId.current;
    setBusy(true); setError('');
    const query = new URLSearchParams({ school_id: String(schoolId), academic_year_id: year, review_date: date });
    if (classId) query.set('class_id', classId);
    if (section) query.set('section_id', section);
    if (after) query.set('after', String(after));
    const result = await fetchApi<ReviewPage>(`/api/student-age-review?${query}`);
    if (currentKey.current !== captured || requestId.current !== token) return;
    setBusy(false);
    if (result.error || !result.data) { setError(result.error || 'تعذر تحميل التقرير'); return; }
    const page = result.data;
    setLoaded(previous => ({ key: captured, rows: after && previous?.key === captured ? [...previous.rows, ...page.rows] : page.rows, next: page.next_cursor }));
  }
  useEffect(() => {
    setLoaded(null); setError(''); setBusy(false); void load();
    return () => { requestId.current++; };
  }, [key]);

  return <div dir="rtl" className="space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">مراجعة أعمار الطلاب</h1>
      <Link className="text-primary-700 underline" to="/regulations">اللوائح والقوالب الرسمية</Link>
    </div>
    <p className="text-sm text-gray-600">مقارنة طلاب القيد السنوي النشط بحدود العمر المعتمدة للصف والسنة. التنبيه يحتاج مراجعة الوثائق والاستثناءات، ولا يغيّر قيد الطالب أو بياناته.</p>
    <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      {scope.isSystemAdmin && <label>المدرسة<select className={input} value={schoolId || ''} onChange={e => scope.selectSchool(e.target.value ? Number(e.target.value) : null)}><option value="">اختر المدرسة</option>{scope.schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      <label>السنة الدراسية<select className={input} value={year} onChange={e => setYear(e.target.value)}><option value="">اختر السنة</option>{options.years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
      <label>الصف<select className={input} value={classId} onChange={e => { setClass(e.target.value); setSection(''); }}><option value="">كل الصفوف</option>{options.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>الشعبة<select className={input} value={section} onChange={e => setSection(e.target.value)}><option value="">كل الشعب</option>{options.sections.filter(s => !classId || String(s.class_id) === classId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>تاريخ التحقق من السريان<input className={input} type="date" max={baghdadDate()} value={date} onChange={e => setDate(e.target.value)} /></label>
    </div>
    <p className="text-xs text-gray-600">يستخدم التقرير الإصدار المعتمد حاليًا إذا كان ساريًا في التاريخ المختار؛ لا يعيد بناء سجل الاعتمادات السابق. الطلاب دون قيد سنوي نشط لا يدخلون في هذا التقرير.</p>
    {(error || options.error) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error || options.error}</p>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1">الحالة ضمن النتائج المحمّلة<select className={input} value={status} onChange={e => setStatus(e.target.value)}><option value="all">كل الحالات</option><option value="attention">الحالات التي تحتاج متابعة</option>{Object.entries(AGE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className={button} disabled={busy || !schoolId || !year || !date} onClick={() => setRefresh(n => n + 1)}>تحديث التقرير</button>
    </div>
    <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm">{busy ? 'جارٍ تحميل التقرير…' : current ? `تم تحميل ${rows.length} طالبًا؛ ${attention} يحتاجون متابعة عمر أو بيانات. المعروض حسب المرشح: ${visible.length}. ${current.next ? 'توجد نتائج إضافية؛ الأعداد ليست إجمالي المدرسة.' : 'اكتمل تحميل النطاق المختار.'}` : 'اختر المدرسة والسنة لبدء المراجعة.'}</p>
    <div className="space-y-3">
      {visible.map(row => <article key={row.enrollment_id} className="space-y-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap justify-between gap-2">
          <div><Link to={`/students/${row.student_id}`} className="font-bold text-primary-700 underline">{row.full_name}</Link><p className="text-sm text-gray-600">{row.student_number} · {row.class_name} · {row.section_name || 'دون شعبة'}</p></div>
          <span className={`self-start rounded-lg px-3 py-1 text-sm ${needsAttention(row) ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-800'}`}>{AGE_STATUS_LABELS[row.age_check.status as AgeStatus]}</span>
        </div>
        <p className="text-sm">الميلاد: <bdi className="whitespace-nowrap">{row.birth_date || 'غير مسجل'}</bdi> · {row.gender === 'male' ? 'ذكر' : row.gender === 'female' ? 'أنثى' : 'الجنس غير مثبت'} · العمر في <bdi className="whitespace-nowrap">{row.age_check.reference_date || 'تاريخ غير محدد'}</bdi>: <span className="whitespace-nowrap">{formatAge(row.age_check.age_months)}</span></p>
        {row.age_check.issues.length > 0 && <ul className="list-inside list-disc text-sm text-amber-900">{row.age_check.issues.map((issue, i) => <li key={i}><DateText text={issue} /></li>)}</ul>}
        {row.age_rules && <details className="text-sm"><summary className="cursor-pointer text-primary-700">الحدود والمصدر والاستثناءات</summary><div className="mt-2 space-y-2"><AgeRuleSummary rules={row.age_rules} /><p>{row.regulation_title} — إصدار {row.regulation_version}</p><p>{row.source_reference}</p>{row.source_url && <a href={row.source_url} target="_blank" rel="noreferrer" className="underline">فتح المصدر</a>}{row.context_notes.map((note, i) => <p key={i}>{note}</p>)}</div></details>}
        {!row.age_rules && row.context_notes.map((note, i) => <p className="text-sm" key={i}>{note}</p>)}
      </article>)}
      {current && !busy && visible.length === 0 && <p className="p-4 text-gray-600">لا توجد نتائج محمّلة تطابق الاختيار.{current.next ? ' حمّل المزيد لمتابعة بقية الطلاب.' : ''}</p>}
    </div>
    {current?.next && <button className={button} disabled={busy} onClick={() => void load(current.next!)}>تحميل 100 طالب إضافي</button>}
  </div>;
}
