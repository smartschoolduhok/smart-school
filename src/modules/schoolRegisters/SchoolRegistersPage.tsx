import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, FilePlus2, History, Loader2, Pencil, Printer, Search, ShieldCheck, Users, XCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { getAcademicYears, getEmployees, getSchoolSettings } from '../../lib/api';
import { SCHOOL_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import { businessDate, formatBusinessUnixDate } from '../../lib/businessTime';
import type { AcademicYearRecord } from '../../lib/academicYears';
import { SCHOOL_REGISTERS, type SchoolRegisterDefinition, type SchoolRegisterEntry } from '../../lib/schoolRegisters';
import { createSchoolRegisterEntry, getSchoolRegisterEntries, getSchoolRegisterHistory, matchesRegisterScope, updateSchoolRegisterEntry, voidSchoolRegisterEntry, type RegisterFilters, type RegisterHistoryList, type RegisterList, type RegisterScope, type RegisterWrite } from '../../lib/schoolRegistersApi';
import { extraFields, RegisterDialog, RegisterEditor, type RegisterEmployee } from './RegisterEditor';
import { RegisterPrintPreview, SchoolRegisterLogo, type RegisterPrintSchool, type RegisterPrintSnapshot } from './RegisterPrintPreview';
import { readEvaluation, TeacherEvaluationTable } from './TeacherEvaluationTable';
import './schoolRegisters.css';

export const schoolRegisterServices = {
  years: getAcademicYears, school: getSchoolSettings, employees: getEmployees,
  list: getSchoolRegisterEntries, create: createSchoolRegisterEntry, update: updateSchoolRegisterEntry, void: voidSchoolRegisterEntry, history: getSchoolRegisterHistory,
};
export type SchoolRegisterServices = typeof schoolRegisterServices;
function ErrorBox({ message, retry }: { message: string; retry?: () => void }) { return <div role="alert" className="sr-error">{message}{retry && <button type="button" onClick={retry}>إعادة المحاولة</button>}</div>; }
function Busy({ children }: { children: string }) { return <p role="status" className="sr-loading"><Loader2 size={19} className="animate-spin" />{children}</p>; }
function useLiveGuard(schoolId: number) {
  const schoolGuard = useSchoolRequestGuard(schoolId), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return () => { const isCurrent = schoolGuard(); return () => live.current && isCurrent(); };
}
function printableSchool(value: Record<string, unknown>, schoolId: number): RegisterPrintSchool | null {
  return Number(value.id) === schoolId && typeof value.name === 'string' && value.name.trim() ? { id: schoolId, name: value.name, logo_url: typeof value.logo_url === 'string' ? value.logo_url : null } : null;
}

export function SchoolRegisterIndex() {
  const [search, setSearch] = useState(''), [category, setCategory] = useState('');
  const normalize = (value: string) => value.replace(/[أإآ]/g, 'ا').replace(/[\u064B-\u065F]/g, '').replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).toLocaleLowerCase('ar');
  const filtered = SCHOOL_REGISTERS.filter(register => (!category || register.category === category) && normalize(`${register.number} ${register.title} ${register.category}`).includes(normalize(search.trim())));
  return <>
    <section className="sr-hero"><div><span className="sr-eyebrow">أعمال المدرسة · تنظيم ومتابعة</span><h1>السجلات المدرسية</h1><p>كل سجل في مكانه؛ قيود محفوظة، متابعة للتعديلات، ونماذج واضحة للطباعة.</p><div className="sr-hero-facts"><span><BookOpen size={17} />{SCHOOL_REGISTERS.length} سجلًا</span><span><ShieldCheck size={17} />سنة دراسية مستقلة</span><span><Printer size={17} />طباعة A4</span></div></div><div className="sr-hero-number">{SCHOOL_REGISTERS.length}<span>سجلًا في الفهرس</span></div></section>
    <div className="sr-linked-records"><Link to="/staff-register"><Users size={22} /><span><strong>سجل الكادر وملفات المدرسين</strong><small>البيانات الوظيفية والمؤهلات والصور</small></span><ChevronLeft size={19} /></Link><Link to="/print/staff-attendance"><CalendarDays size={22} /><span><strong>سجل حضور وتوقيع الكادر</strong><small>أسماء الكادر وخانات فارغة للتعبئة اليدوية</small></span><ChevronLeft size={19} /></Link><Link to="/print/student-attendance"><CalendarDays size={22} /><span><strong>سجل حضور الطلبة الورقي</strong><small>خانات لكل درس مع اسم المدرس وتوقيعه</small></span><ChevronLeft size={19} /></Link></div>
    <section className="sr-index-controls" aria-label="تصفية فهرس السجلات"><label className="sr-search"><Search size={18} /><input aria-label="البحث في فهرس السجلات" placeholder="ابحث باسم السجل أو رقمه…" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></label><div className="sr-categories"><button type="button" aria-pressed={!category} onClick={() => setCategory('')}>الكل</button>{[...new Set(SCHOOL_REGISTERS.map(register => register.category))].map(item => <button type="button" aria-pressed={category === item} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div></section>
    <p className="sr-catalog-note">حقول السجلات المقترحة قابلة للتخصيص في كل قيد. نموذج التقويم مستند إلى الصور، وتبقى مراجعة المدرسة مرجع الاعتماد.</p>
    <div className="sr-catalog-count" aria-live="polite">{filtered.length} من {SCHOOL_REGISTERS.length} سجلًا</div>
    <div className="sr-register-grid">{filtered.map(register => <Link className="sr-register-card" to={`/school-registers/${register.key}`} key={register.key}><div className="sr-card-top"><span className="sr-register-number">{String(register.number).padStart(2, '0')}</span><span className="sr-category-label">{register.category}</span></div><h2>{register.title}</h2><div className="sr-card-bottom"><span className={`sr-template-badge ${register.templateStatus === 'photo' ? 'sr-template-photo' : ''}`}>{register.templateStatus === 'photo' ? 'مستند إلى الصور' : 'قالب مقترح'}</span><span>فتح السجل <ChevronLeft size={15} /></span></div></Link>)}</div>
    {!filtered.length && <div role="status" className="sr-empty"><Search size={30} /><h2>لا توجد سجلات مطابقة</h2><p>جرّب كلمة أقصر أو اختر جميع الفئات.</p><button type="button" className="sr-button sr-button-secondary" onClick={() => { setSearch(''); setCategory(''); }}>عرض جميع السجلات</button></div>}
  </>;
}

export function SchoolRegistersWorkspace({ schoolId, registerKey, services = schoolRegisterServices }: { schoolId: number | null; registerKey?: string; services?: SchoolRegisterServices }) {
  if (schoolId == null) return <div className="school-registers" dir="rtl"><div className="sr-empty"><BookOpen size={32} /><h1>السجلات المدرسية</h1><p>اختر المدرسة لفتح سجلاتها.</p></div></div>;
  return <WorkspaceSchool key={schoolId} schoolId={schoolId} registerKey={registerKey} services={services} />;
}
function WorkspaceSchool({ schoolId, registerKey, services }: { schoolId: number; registerKey?: string; services: SchoolRegisterServices }) {
  const [years, setYears] = useState<AcademicYearRecord[]>([]), [yearId, setYearId] = useState<number | null>(null);
  const [school, setSchool] = useState<RegisterPrintSchool | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const capture = useLiveGuard(schoolId);
  useEffect(() => {
    let current = true;
    const matches = capture();
    setLoading(true); setError(''); setSchool(null); setYears([]); setYearId(null);
    void Promise.all([services.years(schoolId), services.school(schoolId)]).then(([yearResult, schoolResult]) => {
      if (!current || !matches()) return;
      const schoolInfo = schoolResult.data?.school ? printableSchool(schoolResult.data.school, schoolId) : null;
      if (yearResult.error || schoolResult.error || !schoolInfo) { setError(yearResult.error || schoolResult.error || 'تعذر التحقق من بيانات المدرسة.'); return; }
      const validYears = (yearResult.data || []).filter(year => year.school_id === schoolId);
      setYears(validYears); setSchool(schoolInfo); setYearId(validYears.find(year => year.is_active)?.id || validYears[0]?.id || null);
    }).catch(() => { if (current && matches()) setError('تعذر تحميل المدرسة والسنوات الدراسية.'); }).finally(() => { if (current && matches()) setLoading(false); });
    return () => { current = false; };
  }, [schoolId, services, reload]);
  const year = years.find(item => item.id === yearId), definition = SCHOOL_REGISTERS.find(item => item.key === registerKey);
  return <main className="school-registers" dir="rtl">
    {loading && <Busy>جاري تحميل بيانات المدرسة…</Busy>}
    {error && <ErrorBox message={error} retry={() => setReload(value => value + 1)} />}
    {school && <div className="sr-workspace-scope"><div className="sr-school-identity"><SchoolRegisterLogo key={`${school.id}-${school.logo_url}`} school={school} /><strong>{school.name}</strong></div><label><CalendarDays size={17} />السنة الدراسية<select aria-label="سنة السجلات الدراسية" value={yearId ?? ''} onChange={event => setYearId(Number(event.target.value) || null)}><option value="">اختر السنة الدراسية</option>{years.map(item => <option key={item.id} value={item.id}>{item.name}{item.is_active ? ' · الحالية' : ''}</option>)}</select></label></div>}
    {!registerKey ? <SchoolRegisterIndex /> : !definition ? <div className="sr-empty"><h1>السجل غير موجود</h1><Link to="/school-registers">العودة إلى الفهرس</Link></div> : school && year ? <RegisterManager key={`${schoolId}:${year.id}:${definition.key}`} scope={{ school_id: schoolId, academic_year_id: year.id, register_key: definition.key }} school={school} year={year} definition={definition} services={services} /> : !loading && !error ? <div className="sr-empty"><h1>{definition.title}</h1><p>اختر سنة دراسية لقراءة القيود أو إضافتها.</p><Link to="/school-registers">العودة إلى الفهرس</Link></div> : null}
  </main>;
}

export function RegisterManager({ scope, school, year, definition, services = schoolRegisterServices }: { scope: RegisterScope; school: RegisterPrintSchool; year: { id: number; name: string }; definition: SchoolRegisterDefinition; services?: SchoolRegisterServices }) {
  const [filters, setFilters] = useState<RegisterFilters>({ status: 'active', page: 1, page_size: 12 }), [search, setSearch] = useState('');
  const [list, setList] = useState<RegisterList | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<{ entry: SchoolRegisterEntry | null } | null>(null), [detail, setDetail] = useState<SchoolRegisterEntry | null>(null);
  const [busy, setBusy] = useState(false), [saveError, setSaveError] = useState(''), [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [voidEntry, setVoidEntry] = useState<SchoolRegisterEntry | null>(null), [reason, setReason] = useState('');
  const [employees, setEmployees] = useState<RegisterEmployee[]>([]), [employeeLoading, setEmployeeLoading] = useState(false), [employeeError, setEmployeeError] = useState(''), [employeeReload, setEmployeeReload] = useState(0);
  const [historyEntry, setHistoryEntry] = useState<SchoolRegisterEntry | null>(null), [historyPage, setHistoryPage] = useState(1), [history, setHistory] = useState<RegisterHistoryList | null>(null), [historyError, setHistoryError] = useState(''), [historyLoading, setHistoryLoading] = useState(false), [historyReload, setHistoryReload] = useState(0);
  const [printSnapshot, setPrintSnapshot] = useState<RegisterPrintSnapshot | null>(null), [printBusy, setPrintBusy] = useState(false);
  const capture = useLiveGuard(scope.school_id), requestId = useRef(0);
  const filterKey = JSON.stringify(filters), scopeKey = JSON.stringify(scope), currentScopeKey = useRef(scopeKey); currentScopeKey.current = scopeKey;
  const captureScope = () => { const matches = capture(), key = scopeKey; return () => matches() && currentScopeKey.current === key; };
  const currentFilter = useRef(filterKey); currentFilter.current = filterKey;
  useEffect(() => {
    const matches = captureScope(), id = ++requestId.current; let active = true;
    setLoading(true); setError(''); setList(null);
    void services.list(scope, filters).then(result => {
      if (!active || !matches() || id !== requestId.current) return;
      if (result.error || !result.data) { setError(result.error || 'تعذر تحميل السجل.'); return; }
      if (!result.data.entries.every(entry => matchesRegisterScope(entry, scope))) { setError('لم تتطابق بيانات السجل مع المدرسة والسنة المختارتين. أعد المحاولة.'); return; }
      if (!result.data.entries.length && result.data.total > 0 && (filters.page || 1) > 1) { setFilters(previous => ({ ...previous, page: 1 })); return; }
      setList(result.data);
    }).catch(() => { if (active && matches()) setError('تعذر الاتصال لتحميل السجل.'); }).finally(() => { if (active && matches() && id === requestId.current) setLoading(false); });
    return () => { active = false; };
  }, [filterKey, scopeKey, services, reload]);
  useEffect(() => {
    if (definition.key !== 'teacher-evaluation') return;
    const matches = captureScope(); let active = true;
    setEmployeeLoading(true); setEmployeeError(''); setEmployees([]);
    void services.employees(scope.school_id).then(result => {
      if (!active || !matches()) return;
      if (result.error) setEmployeeError(result.error);
      else setEmployees((result.data || []).filter(employee => employee.school_id === scope.school_id && employee.role === 'teacher') as RegisterEmployee[]);
    }).catch(() => { if (active && matches()) setEmployeeError('تعذر تحميل قائمة المدرسين.'); }).finally(() => { if (active && matches()) setEmployeeLoading(false); });
    return () => { active = false; };
  }, [scopeKey, definition.key, services, employeeReload]);
  useEffect(() => {
    if (!historyEntry) return;
    const matches = captureScope(); let active = true;
    setHistoryLoading(true); setHistoryError(''); setHistory(null);
    void services.history(historyEntry.id, scope, historyPage).then(result => {
      if (!active || !matches()) return;
      if (result.error || !result.data) setHistoryError(result.error || 'تعذر تحميل سجل التعديلات.');
      else if (result.data.history.some(item => item.entry_id !== historyEntry.id || item.after.id !== historyEntry.id || !matchesRegisterScope(item.after, scope) || (item.before && (item.before.id !== historyEntry.id || !matchesRegisterScope(item.before, scope))))) setHistoryError('تعذر التحقق من نطاق سجل التعديلات.');
      else setHistory(result.data);
    }).catch(() => { if (active && matches()) setHistoryError('تعذر الاتصال لتحميل سجل التعديلات.'); }).finally(() => { if (active && matches()) setHistoryLoading(false); });
    return () => { active = false; };
  }, [historyEntry, historyPage, scopeKey, services, historyReload]);
  async function save(input: RegisterWrite) {
    if (busy || !editor) return;
    const matches = captureScope(); setBusy(true); setSaveError('');
    try {
      const result = editor.entry ? await services.update(editor.entry.id, scope, editor.entry.version, input) : await services.create(scope, input);
      if (!matches()) return;
      if (result.error || !result.data) { setSaveError(result.error || 'لم يؤكد الخادم حفظ القيد.'); setConflict(result.status === 409); return; }
      if (!matchesRegisterScope(result.data, scope)) { setSaveError('تعذر التحقق من القيد المحفوظ. أعد تحميل السجل.'); return; }
      setEditor(null); setDetail(null); setNotice('حُفظ القيد بنجاح.'); setReload(value => value + 1);
    } catch { if (matches()) setSaveError('تعذر الاتصال. تحقق من السجل قبل إعادة الحفظ.'); }
    finally { if (matches()) setBusy(false); }
  }
  async function reloadConflictedEntry() {
    if (busy || !editor?.entry) return;
    const matches = captureScope(), id = editor.entry.id;
    setBusy(true); setSaveError('');
    try {
      // History is ordered by version descending; its first snapshot is the latest saved entry.
      const result = await services.history(id, scope, 1);
      if (!matches()) return;
      const latestChange = result.data?.history[0], latest = latestChange?.after;
      if (result.error || !latest || latestChange?.entry_id !== id || latestChange.version !== latest.version || latest.id !== id || !matchesRegisterScope(latest, scope)) {
        setSaveError(result.error || 'تعذر التحقق من أحدث نسخة. بقيت مسودتك دون تغيير.'); return;
      }
      if (latest.version <= editor.entry.version) { setSaveError('لم تتوفر نسخة أحدث بعد. بقيت مسودتك دون تغيير؛ أعد المحاولة.'); return; }
      setConflict(false); setReload(value => value + 1);
      if (latest.status === 'voided') { setEditor(null); setDetail(latest); setNotice('أُبطل القيد في النسخة الأحدث؛ يمكنك مراجعة بياناته وتاريخه.'); }
      else { setEditor({ entry: latest }); setNotice('حُمّلت أحدث نسخة من القيد.'); }
    } catch { if (matches()) setSaveError('تعذر تحميل أحدث نسخة. بقيت مسودتك دون تغيير.'); }
    finally { if (matches()) setBusy(false); }
  }
  async function confirmVoid() {
    if (busy || !voidEntry || !reason.trim()) return;
    const matches = captureScope(); setBusy(true); setSaveError('');
    try {
      const result = await services.void(voidEntry.id, scope, voidEntry.version, reason.trim());
      if (!matches()) return;
      if (result.error || !result.data || !matchesRegisterScope(result.data, scope)) { setSaveError(result.error || 'لم يؤكد الخادم إبطال القيد.'); if (result.status === 409) setReload(value => value + 1); return; }
      setVoidEntry(null); setDetail(null); setNotice('أُبطل القيد مع حفظ تاريخه وسبب الإبطال.'); setReload(value => value + 1);
    } catch { if (matches()) setSaveError('تعذر إبطال القيد. حاول مجددًا.'); }
    finally { if (matches()) setBusy(false); }
  }
  async function preview(kind: 'blank' | 'entry' | 'register', entry?: SchoolRegisterEntry) {
    if (printBusy) return;
    const matches = captureScope(), selectedFilter = filterKey;
    setPrintBusy(true); setError('');
    try {
      let entries: SchoolRegisterEntry[] = entry ? [entry] : [];
      if (kind === 'register') {
        let total: number | null = null, page = 1;
        while (total === null || entries.length < total) {
          const result = await services.list(scope, { ...filters, page, page_size: 100 });
          if (!matches() || selectedFilter !== currentFilter.current) return;
          if (result.error || !result.data) throw new Error(result.error || 'تعذر تحضير السجل للطباعة.');
          if (total !== null && result.data.total !== total) throw new Error('تغير عدد القيود أثناء التحضير؛ أعد المعاينة.');
          total = result.data.total;
          if (total > 3000) throw new Error('نتائج كثيرة للطباعة دفعة واحدة. ضيّق البحث ثم أعد المعاينة.');
          if (!result.data.entries.length && entries.length < total) throw new Error('لم يكتمل تحميل السجل. أعد المحاولة.');
          entries.push(...result.data.entries); page++;
        }
        if (!entries.length) throw new Error('لا توجد قيود مطابقة للطباعة.');
        if (new Set(entries.map(row => row.id)).size !== total || entries.length !== total) throw new Error('تغير ترتيب القيود أثناء التحضير؛ أعد المعاينة.');
      }
      if (!matches() || selectedFilter !== currentFilter.current) return;
      if (!entries.every(row => matchesRegisterScope(row, scope))) throw new Error('لم تتطابق بيانات الطباعة مع المدرسة والسنة.');
      setPrintSnapshot({ school, year, definition, entries, blank: kind === 'blank', preparedDate: businessDate(), filterLabel: kind === 'blank' ? 'نموذج للكتابة اليدوية' : kind === 'entry' ? 'معاينة القيد المحفوظ' : `جميع نتائج البحث (${entries.length}) · ${filters.status === 'active' ? 'القيود الفعالة' : filters.status === 'voided' ? 'القيود المبطلة' : 'كل الحالات'}${filters.search ? ` · البحث: ${filters.search}` : ''}` });
    } catch (caught) { if (matches()) setError(caught instanceof Error ? caught.message : 'تعذر تجهيز الطباعة.'); }
    finally { if (matches()) setPrintBusy(false); }
  }
  function startEdit(entry: SchoolRegisterEntry | null) { setSaveError(''); setConflict(false); setNotice(''); setDetail(null); setEditor({ entry }); }
  function closeEditor() { if (conflict) setReload(value => value + 1); setConflict(false); setEditor(null); }
  function startHistory(entry: SchoolRegisterEntry) { setHistoryPage(1); setHistoryEntry(entry); }
  function clearSearch() { setSearch(''); setFilters(previous => ({ ...previous, search: '', page: 1 })); }
  const totalPages = Math.max(1, Math.ceil((list?.total || 0) / 12));
  return <>
    <Link to="/school-registers" className="sr-back"><ArrowRight size={17} />فهرس السجلات</Link>
    <section className="sr-register-heading"><div className="sr-register-number">{String(definition.number).padStart(2, '0')}</div><div><div className="sr-heading-labels"><span className="sr-eyebrow">{definition.category}</span><span className={`sr-template-badge ${definition.templateStatus === 'photo' ? 'sr-template-photo' : ''}`}>{definition.templateStatus === 'photo' ? 'مستند إلى الصور' : 'قالب مقترح'}</span></div><h1>{definition.title}</h1><p>{definition.description}</p>{definition.referenceNote && <p className="sr-reference-note">{definition.referenceNote}</p>}</div></section>
    <div className="sr-register-toolbar"><div className="sr-actions"><button type="button" className="sr-button" onClick={() => startEdit(null)}><FilePlus2 size={17} />إضافة قيد</button><button type="button" className="sr-button sr-button-secondary" disabled={printBusy || loading || !list?.total} onClick={() => void preview('register')}><Printer size={17} />{printBusy ? 'جاري التحضير…' : 'طباعة السجل'}</button><button type="button" className="sr-button sr-button-secondary" disabled={printBusy} onClick={() => void preview('blank')}>نموذج فارغ</button></div>{definition.relatedPath && <Link className="sr-related" to={definition.relatedPath}>فتح الوحدة المرتبطة <ChevronLeft size={16} /></Link>}</div>
    {notice && <p className="sr-success" role="status"><Check size={17} />{notice}</p>}
    <form className="sr-list-filters" onSubmit={event => { event.preventDefault(); setFilters(previous => ({ ...previous, search: search.trim(), page: 1 })); }}><label className="sr-search"><Search size={18} /><input aria-label="البحث في قيود السجل" placeholder="ابحث في العنوان والبيانات…" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label><button type="submit" className="sr-button sr-button-secondary">بحث</button>{(search || filters.search) && <button type="button" className="sr-clear-search" onClick={clearSearch}>مسح البحث</button>}<label>الحالة<select aria-label="حالة قيد السجل" value={filters.status} onChange={event => setFilters(previous => ({ ...previous, status: event.target.value as RegisterFilters['status'], page: 1 }))}><option value="active">الفعالة</option><option value="voided">المبطلة</option><option value="all">كل الحالات</option></select></label>{filters.search && <p className="sr-applied-search">البحث المطبق على النتائج والطباعة: <strong>{filters.search}</strong></p>}</form>
    {error && <ErrorBox message={error} retry={() => setReload(value => value + 1)} />}
    {loading && <Busy>جاري تحميل القيود…</Busy>}
    {!loading && list && <><div className="sr-result-summary"><span>{list.total} قيدًا يطابق الاختيارات</span>{list.active_total != null && <span>الفعالة: {list.active_total} · المبطلة: {list.voided_total || 0}</span>}</div>{list.entries.length ? <div className="sr-entries">{list.entries.map(entry => <article key={entry.id} className={`sr-entry-card ${entry.status === 'voided' ? 'sr-entry-voided' : ''}`} data-entry-id={entry.id}><div className="sr-entry-main"><div className="sr-entry-date"><CalendarDays size={16} /><time>{entry.entry_date}</time></div><h2><button type="button" onClick={() => setDetail(entry)}>{entry.title}</button></h2><p className="sr-muted">قيد #{entry.id} · إصدار {entry.version}{entry.status === 'voided' && <span className="sr-void-label"> · مُبطل</span>}</p>{entry.status === 'voided' && <p className="sr-void-reason">{entry.void_reason}</p>}</div><div className="sr-entry-actions"><button type="button" onClick={() => setDetail(entry)}>عرض التفاصيل</button>{entry.status === 'active' && <button type="button" onClick={() => startEdit(entry)}><Pencil size={15} />تعديل</button>}<button type="button" onClick={() => startHistory(entry)}><History size={15} />التعديلات</button><button type="button" disabled={printBusy} onClick={() => void preview('entry', entry)}><Printer size={15} />طباعة</button>{entry.status === 'active' && <button type="button" className="sr-danger-button" onClick={() => { setReason(''); setSaveError(''); setVoidEntry(entry); }}><XCircle size={15} />إبطال</button>}</div></article>)}</div> : <div role="status" className="sr-empty"><BookOpen size={32} /><h2>{filters.search || filters.status !== 'active' ? 'لا توجد قيود مطابقة' : 'ابدأ أول قيد في هذا السجل'}</h2><p>يمكنك إضافة قيد أو طباعة نموذج فارغ لتعبئته يدويًا.</p></div>}<nav className="sr-pagination" aria-label="صفحات القيود"><button type="button" className="sr-button sr-button-secondary" disabled={(filters.page || 1) <= 1} onClick={() => setFilters(previous => ({ ...previous, page: (previous.page || 1) - 1 }))}><ChevronRight size={17} />السابق</button><span>صفحة {filters.page || 1} من {totalPages}</span><button type="button" className="sr-button sr-button-secondary" disabled={(filters.page || 1) >= totalPages} onClick={() => setFilters(previous => ({ ...previous, page: (previous.page || 1) + 1 }))}>التالي<ChevronLeft size={17} /></button></nav></>}
    {editor && <RegisterEditor key={editor.entry ? `${editor.entry.id}:${editor.entry.version}` : 'new'} definition={definition} entry={editor.entry} employees={employees} employeeLoading={employeeLoading} employeeError={employeeError} reloadEmployees={() => setEmployeeReload(value => value + 1)} busy={busy} error={saveError} conflict={conflict} onReloadConflict={reloadConflictedEntry} onSave={save} onClose={closeEditor} />}
    {detail && <RegisterDialog title={detail.title} onClose={() => setDetail(null)}><div className="sr-detail"><div className="sr-detail-meta"><span>تاريخ القيد: {detail.entry_date}</span><span>إصدار {detail.version}</span><span>{detail.status === 'active' ? 'فعال' : 'مُبطل'}</span></div><dl>{definition.fields.filter(field => field.key !== 'employee_id').map(field => <div key={field.key}><dt>{field.label}</dt><dd>{String(detail.data[field.key] ?? '') || 'غير مسجل'}</dd></div>)}{extraFields(detail.data).map((field, index) => <div key={`extra-${index}`}><dt>{field.label}</dt><dd>{field.value || 'غير مسجل'}</dd></div>)}</dl>{definition.key === 'teacher-evaluation' && <TeacherEvaluationTable value={readEvaluation(detail.data)} />}{detail.void_reason && <p className="sr-error">سبب الإبطال: {detail.void_reason}</p>}<div className="sr-actions"><button type="button" className="sr-button" disabled={printBusy} onClick={() => void preview('entry', detail)}><Printer size={17} />طباعة القيد</button><button type="button" className="sr-button sr-button-secondary" onClick={() => { startHistory(detail); setDetail(null); }}>سجل التعديلات</button></div></div></RegisterDialog>}
    {voidEntry && <RegisterDialog title="إبطال القيد" onClose={() => setVoidEntry(null)} busy={busy}><form className="sr-editor" onSubmit={event => { event.preventDefault(); void confirmVoid(); }}><p>سيُحتفظ بالقيد «{voidEntry.title}» وتاريخه، ويُميّز بأنه مُبطل.</p>{saveError && <ErrorBox message={saveError} />}<label>سبب الإبطال<textarea aria-label="سبب إبطال القيد" required maxLength={1000} rows={4} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label><footer className="sr-editor-actions"><button type="button" className="sr-button sr-button-secondary" disabled={busy} onClick={() => setVoidEntry(null)}>رجوع</button><button type="submit" className="sr-button sr-button-danger" disabled={busy || !reason.trim()}>{busy ? 'جاري الإبطال…' : 'تأكيد الإبطال'}</button></footer></form></RegisterDialog>}
    {historyEntry && <RegisterDialog title={`تاريخ القيد: ${historyEntry.title}`} onClose={() => setHistoryEntry(null)}><div className="sr-history">{historyLoading && <Busy>جاري تحميل التعديلات…</Busy>}{historyError && <ErrorBox message={historyError} retry={() => setHistoryReload(value => value + 1)} />}{history?.history.map(item => <article key={item.id}><strong>{item.action === 'created' ? 'إنشاء القيد' : item.action === 'updated' ? 'تعديل القيد' : 'إبطال القيد'} · الإصدار {item.version}</strong><p>{item.actor_name} · {formatBusinessUnixDate(item.changed_at)}</p><details><summary>عرض بيانات هذا الإصدار</summary><dl><div><dt>العنوان</dt><dd>{item.after.title}</dd></div><div><dt>تاريخ القيد</dt><dd>{item.after.entry_date}</dd></div>{definition.fields.filter(field => field.key !== 'employee_id').map(field => <div key={field.key}><dt>{field.label}</dt><dd>{String(item.after.data[field.key] ?? '') || 'غير مسجل'}{item.before && item.before.data[field.key] !== item.after.data[field.key] && <small>القيمة السابقة: {String(item.before.data[field.key] ?? '') || 'غير مسجل'}</small>}</dd></div>)}{extraFields(item.after.data).map((field, index) => <div key={`extra-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>{definition.key === 'teacher-evaluation' && <TeacherEvaluationTable value={readEvaluation(item.after.data)} />}{item.after.void_reason && <p>سبب الإبطال: {item.after.void_reason}</p>}</details></article>)}{history && !history.history.length && <p>لا توجد تعديلات محفوظة.</p>}{history && <nav className="sr-pagination" aria-label="صفحات التعديلات"><button type="button" className="sr-button sr-button-secondary" disabled={historyPage <= 1} onClick={() => setHistoryPage(page => page - 1)}>السابق</button><span>{historyPage} / {Math.max(1, Math.ceil(history.total / 20))}</span><button type="button" className="sr-button sr-button-secondary" disabled={historyPage * 20 >= history.total} onClick={() => setHistoryPage(page => page + 1)}>التالي</button></nav>}</div></RegisterDialog>}
    {printSnapshot && <RegisterPrintPreview snapshot={printSnapshot} onClose={() => setPrintSnapshot(null)} />}
  </>;
}

export default function SchoolRegistersPage() {
  const scope = useTenantSchool(), { registerKey } = useParams<{ registerKey: string }>(), { user } = useAuth();
  if (!hasRole(user?.role_key, SCHOOL_MANAGEMENT_ROLES)) return <p role="alert" className="sr-error">سجلات الإدارة متاحة لإدارة المدرسة فقط.</p>;
  return <><SystemAdminSchoolSelector {...scope} /><SchoolRegistersWorkspace schoolId={scope.schoolId} registerKey={registerKey} /></>;
}
