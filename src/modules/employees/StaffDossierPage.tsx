import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Eye, Pencil, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { StaffDossierDocument } from '../../components/staffDocuments/StaffDossierDocument';
import { usePrintExport } from '../../components/print';
import { getEmployeeProfile } from '../../lib/employeeRecordsApi';
import { getStaffDossier, saveStaffDossier } from '../../lib/staffDossierApi';
import { DOSSIER_BLOOD_GROUPS, DOSSIER_HISTORY_KINDS, DOSSIER_MARITAL_STATUSES, DOSSIER_PERSONAL_FIELDS, DOSSIER_SERVICE_FIELDS, validateStaffDossier, type DossierField, type StaffDossierData, type StaffDossierResponse } from '../../lib/staffDossier';
import { SCHOOL_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import type { EmployeeProfile } from '../../types/employees';
import type { RoleKey } from '../../types';

export function StaffDossierEditor({ schoolId, employeeId, role, loadProfile = getEmployeeProfile, loadDossier = getStaffDossier, saveDossier = saveStaffDossier }: {
  schoolId: number | null; employeeId: number | null; role: RoleKey | undefined;
  loadProfile?: typeof getEmployeeProfile; loadDossier?: typeof getStaffDossier; saveDossier?: typeof saveStaffDossier;
}) {
  const [loaded, setLoaded] = useState<{ profile: EmployeeProfile; dossier: StaffDossierResponse } | null>(null);
  const [draft, setDraft] = useState<StaffDossierData | null>(null), [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(''), [reload, setReload] = useState(0);
  const generation = useRef(0), scope = useRef('');
  const errorRef = useRef<HTMLDivElement>(null);
  const scopeKey = `${schoolId}:${employeeId}:${role}`;
  if (scope.current !== scopeKey) { scope.current = scopeKey; generation.current++; }
  const canManage = hasRole(role, SCHOOL_MANAGEMENT_ROLES);
  const current = canManage && loaded?.dossier.school_id === schoolId && loaded.dossier.employee_id === employeeId ? loaded : null;
  const dirty = !!current && !!draft && JSON.stringify(draft) !== JSON.stringify(current.dossier.data);
  const printReady = useRef(false); printReady.current = !!current && !!draft && preview && !dirty && !busy;
  useEffect(() => {
    let active = true; const request = ++generation.current;
    setLoaded(null); setDraft(null); setError(''); setSuccess(''); setPreview(false); setBusy(false);
    if (!schoolId || !employeeId || !canManage) return;
    setBusy(true);
    void Promise.all([loadProfile(employeeId, { school_id: schoolId }), loadDossier(employeeId, schoolId)]).then(([p, d]) => {
      if (!active || request !== generation.current) return;
      if (p.error || d.error || !p.data || !d.data) throw new Error(p.error || d.error || 'تعذر تحميل السجل');
      if (p.data.employee.id !== employeeId || p.data.employee.school_id !== schoolId || d.data.employee_id !== employeeId || d.data.school_id !== schoolId || !p.data.can_view_private) throw new Error('تعذر مطابقة السجل مع المدرسة');
      if (JSON.stringify(p.data.qualifications.map(q => q.id).sort((a,b) => a-b)) !== JSON.stringify(d.data.qualification_links.map(q => q.qualification_id).sort((a,b) => a-b))) throw new Error('تغيرت المؤهلات أثناء تحميل السجل؛ أعد التحميل');
      setLoaded({ profile: p.data, dossier: d.data }); setDraft(structuredClone(d.data.data));
    }).catch(failure => { if (active && request === generation.current) setError(failure instanceof Error ? failure.message : 'تعذر تحميل السجل'); })
      .finally(() => { if (active && request === generation.current) setBusy(false); });
    return () => { active = false; generation.current++; };
  }, [schoolId, employeeId, role, canManage, loadProfile, loadDossier, reload]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const print = usePrintExport({ documentTitle: `سجل جماعة المدرسين — ${current?.profile.employee.full_name || ''}`, onBeforePrint: async () => {
    const request = generation.current;
    if (!printReady.current) throw new Error('احفظ التعديلات وافتح المعاينة قبل الطباعة');
    if (document.fonts) await document.fonts.ready;
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.staff-dossier-document img')).map(async image => {
      if (image.decode) await image.decode().catch(() => undefined);
      else if (!image.complete) await new Promise<void>(resolve => { image.addEventListener('load', () => resolve(), { once: true }); image.addEventListener('error', () => resolve(), { once: true }); });
    }));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (!printReady.current || request !== generation.current) throw new Error('تغير السجل أثناء تجهيز الطباعة');
  }});
  async function save() {
    if (!current || !draft || !schoolId || !employeeId || busy) return;
    const request = generation.current; setError(''); setSuccess('');
    try {
      const data = validateStaffDossier(draft); setBusy(true);
      const result = await saveDossier(employeeId, schoolId, current.dossier.version, data);
      if (request !== generation.current) return;
      if (result.error || !result.data) throw new Error(result.error || 'تعذر الحفظ');
      if (result.data.school_id !== schoolId || result.data.employee_id !== employeeId) throw new Error('تعذر مطابقة السجل المحفوظ');
      if (JSON.stringify(current.profile.qualifications.map(q => q.id).sort((a,b) => a-b)) !== JSON.stringify(result.data.qualification_links.map(q => q.qualification_id).sort((a,b) => a-b))) {
        // A core edit can replace qualification IDs while this editor is open. Re-read both sources before rendering.
        setReload(value => value + 1); return;
      }
      setLoaded({ ...current, dossier: result.data }); setDraft(structuredClone(result.data.data)); setSuccess('حُفظ سجل جماعة المدرسين');
    } catch (failure) { if (request === generation.current) setError(failure instanceof Error ? failure.message : 'تعذر الحفظ'); }
    finally { if (request === generation.current) setBusy(false); }
  }
  const change = (key: DossierField, value: string) => { if (draft) setDraft({ ...draft, [key]: value || null }); };
  function fields(definitions: readonly (readonly [DossierField, string, number])[]) {
    if (!draft) return null;
    return <div className="dossier-form-grid">{definitions.map(([key, label, max]) => <label key={key}>{label}
      {key === 'blood_group' || key === 'marital_status' ? <select name={key} dir={key === 'blood_group' ? 'ltr' : undefined} value={draft[key] || ''} onChange={event => change(key, event.target.value)}><option value="">غير مسجل</option>{(key === 'blood_group' ? DOSSIER_BLOOD_GROUPS : DOSSIER_MARITAL_STATUSES).map(value => <option key={value}>{value}</option>)}</select>
        : <input name={key} type={key.endsWith('_date') ? 'date' : 'text'} min={key.endsWith('_date') ? '1900-01-01' : undefined} max={key.endsWith('_date') ? '2200-12-31' : undefined} maxLength={max} value={draft[key] || ''} onChange={event => change(key, event.target.value)} />}
    </label>)}</div>;
  }
  if (!canManage) return <p role="alert">هذا السجل متاح لإدارة المدرسة فقط.</p>;
  return <div className="staff-dossier-page" dir="rtl">
    <div className="dossier-no-print dossier-control-panel"><div className="dossier-toolbar"><div><p className="dossier-eyebrow">ملف المدرس · البيانات والسجلات</p><h1 className="text-2xl font-bold">سجل جماعة المدرسين</h1><p className="dossier-hint">{current?.profile.employee.full_name || 'بيانات المدرس وتاريخه الوظيفي'}</p>{current && <span className={`dossier-save-state${dirty ? ' dossier-save-state-dirty' : ''}`}>{busy ? 'جارٍ التجهيز…' : dirty ? 'تغييرات غير محفوظة' : current.dossier.version ? 'التعديلات محفوظة' : 'سجل جديد'}</span>}</div>
      <div className="dossier-actions"><a className="dossier-button" href={`/employees/${employeeId}?school_id=${schoolId}`}>ملف الموظف</a>
        <button className="dossier-button" disabled={!current || busy} onClick={() => setPreview(!preview)}>{preview ? <Pencil size={16}/> : <Eye size={16}/>} {preview ? 'تعديل السجل' : 'معاينة'}</button>
        <button className="dossier-button dossier-button-primary" disabled={!current || busy || !dirty} onClick={() => void save()}><Save size={16}/> حفظ</button>
        {preview && <button className="dossier-button" disabled={!printReady.current || print.isPrinting} onClick={() => void print.handlePrint()}><Printer size={16}/> طباعة / PDF</button>}
      </div></div>
      {(error || print.error) && <div role="alert" ref={errorRef} tabIndex={-1} className="dossier-alert">{error || print.error} <button className="underline" onClick={() => { if (!dirty || window.confirm('إعادة التحميل ستستبدل التعديلات غير المحفوظة. متابعة؟')) setReload(value => value + 1); }}>إعادة التحميل</button></div>}
      {success && !dirty && <p role="status" className="dossier-success">{success}</p>}
      {!schoolId && <p className="dossier-hint">اختر المدرسة أولاً.</p>}{busy && <p role="status" className="dossier-hint">جارٍ تجهيز السجل…</p>}
      {dirty && <p className="dossier-alert">توجد تعديلات غير محفوظة. احفظ السجل لتفعيل الطباعة.</p>}
    </div>
    {current && draft && (preview ? <div className="dossier-preview-scroll"><StaffDossierDocument profile={current.profile} dossier={{ ...current.dossier, data: draft }} draft={dirty}/></div> : <div className="dossier-editor-layout dossier-no-print">
      <nav className="dossier-section-nav" aria-label="أقسام سجل جماعة المدرسين"><p>انتقل إلى القسم</p>
        <a href="#dossier-personal"><span>البيانات الشخصية</span></a><a href="#dossier-qualifications"><span>تفاصيل المؤهلات</span><b>{current.profile.qualifications.length}</b></a><a href="#dossier-service"><span>الخدمة والتكليفات</span></a>
        {DOSSIER_HISTORY_KINDS.map(([kind, label]) => <a key={kind} href={`#dossier-${kind}`}><span>{label}</span><b>{draft.history[kind].length}</b></a>)}
        <a href="#dossier-notes"><span>ملاحظات عامة</span></a>
        <button type="button" className="dossier-button dossier-button-primary dossier-nav-save" disabled={busy || !dirty} onClick={() => void save()}><Save size={16}/> حفظ التعديلات</button>
      </nav>
      <fieldset disabled={busy} className="dossier-editor-fields">
      <p className="dossier-hint">الاسم والصورة والتواصل والراتب والشهادات تؤخذ من <a className="underline" href={`/employees/${employeeId}?school_id=${schoolId}`}>ملف الموظف</a>. اترك المعلومات غير المعروفة فارغة.</p>
      <section id="dossier-personal" className="dossier-form-panel"><h2><span className="dossier-section-number">01</span> البيانات الشخصية</h2>{fields(DOSSIER_PERSONAL_FIELDS)}</section>
      <section id="dossier-qualifications" className="dossier-form-panel"><h2><span className="dossier-section-number">02</span> تفاصيل المؤهلات</h2><p className="dossier-hint">القسم مستقل عن الكلية. تُدخل السنة وحدها عند عدم توفر تاريخ التخرج الكامل.</p>
        {current.dossier.qualification_links.map(link => {
          const q = current.profile.qualifications.find(item => item.id === link.qualification_id); if (!q) return null;
          if (current.dossier.qualification_links.filter(item => item.qualification_key === link.qualification_key).length > 1) return <p key={link.qualification_id} className="dossier-alert">{q.degree}: توجد مؤهلات متطابقة؛ راجع ملف الموظف قبل ربط التفاصيل.</p>;
          const supplement = draft.qualifications.find(item => item.qualification_key === link.qualification_key);
          const update = (field: 'department' | 'graduation_year', value: string) => setDraft({ ...draft, qualifications: [...draft.qualifications.filter(item => item.qualification_key !== link.qualification_key), { qualification_key: link.qualification_key, department: supplement?.department || null, graduation_year: supplement?.graduation_year || null, [field]: field === 'graduation_year' ? value ? Number(value) : null : value || null }] });
          return <div className="dossier-history-editor" key={link.qualification_key}><h3 className="font-semibold">{q.degree} · {q.institution} · {q.college}</h3><div className="dossier-form-grid"><label>القسم<input value={supplement?.department || ''} maxLength={250} onChange={event => update('department', event.target.value)}/></label>
            {link.has_graduation_date ? <p className="dossier-hint">تاريخ التخرج في الملف: {q.graduation_date}</p> : <label>سنة التخرج<input type="number" min={1900} max={2200} step={1} value={supplement?.graduation_year ?? ''} onChange={event => update('graduation_year', event.target.value)}/></label>}
          </div></div>;
        })}
        {!current.profile.qualifications.length && <p className="dossier-hint">أضف الشهادات إلى ملف الموظف أولاً.</p>}
        {draft.qualifications.filter(q => !current.dossier.qualification_links.some(link => link.qualification_key === q.qualification_key)).map(q => <div className="dossier-alert" key={q.qualification_key}><p>تفاصيل محفوظة لمؤهل تغير أو حُذف: القسم {q.department || '—'}؛ سنة التخرج {q.graduation_year || '—'}.</p>
          <label>إعادة ربط بمؤهل حالي<select value="" onChange={event => { if (!event.target.value) return; const link = current.dossier.qualification_links.find(item => item.qualification_key === event.target.value)!; setDraft({ ...draft, qualifications: draft.qualifications.map(item => item === q ? { ...q, qualification_key: link.qualification_key, graduation_year: link.has_graduation_date ? null : q.graduation_year } : item) }); }}><option value="">اختر المؤهل</option>{current.dossier.qualification_links.filter(link => !draft.qualifications.some(item => item.qualification_key === link.qualification_key) && current.dossier.qualification_links.filter(item => item.qualification_key === link.qualification_key).length === 1).map(link => <option key={link.qualification_id} value={link.qualification_key}>{current.profile.qualifications.find(item => item.id === link.qualification_id)?.degree}</option>)}</select></label>
          <button className="dossier-button" onClick={() => setDraft({ ...draft, qualifications: draft.qualifications.filter(item => item !== q) })}>حذف التفاصيل غير المرتبطة</button>
        </div>)}
      </section>
      <section id="dossier-service" className="dossier-form-panel"><h2><span className="dossier-section-number">03</span> أوامر الخدمة والتكليفات</h2><p className="dossier-hint">تاريخ أمر التعيين أو المباشرة هو تاريخ صدور الكتاب؛ تاريخ التعيين والمباشرة الفعليان موجودان في ملف الموظف.</p>{fields(DOSSIER_SERVICE_FIELDS)}</section>
      {DOSSIER_HISTORY_KINDS.map(([kind, label], kindIndex) => <section id={`dossier-${kind}`} className="dossier-form-panel" key={kind}><div className="dossier-toolbar"><h2><span className="dossier-section-number">{String(kindIndex + 4).padStart(2, '0')}</span> {label}<span className="dossier-count">{draft.history[kind].length} قيد</span></h2><button type="button" className="dossier-button" disabled={draft.history[kind].length >= 50} onClick={() => setDraft({ ...draft, history: { ...draft.history, [kind]: [...draft.history[kind], { date: null, title: '', reference: null, notes: null }] } })}><Plus size={16}/> إضافة قيد</button></div>
        {!draft.history[kind].length && <p className="dossier-hint">لا توجد قيود مسجلة.</p>}
        {draft.history[kind].map((row, index) => <div className="dossier-history-editor" key={index}><p className="dossier-row-label">القيد {index + 1}</p><div className="dossier-form-grid">{(['title','date','reference','notes'] as const).map((key, i) => <label key={key}>{['العنوان / الموضوع *','التاريخ','رقم الكتاب أو المرجع','ملاحظات'][i]}{key === 'notes' ? <textarea rows={3} maxLength={1500} value={row[key] || ''} onChange={event => setDraft({ ...draft, history: { ...draft.history, [kind]: draft.history[kind].map((item, n) => n === index ? { ...item, [key]: event.target.value || null } : item) } })}/> : <input type={key === 'date' ? 'date' : 'text'} min={key === 'date' ? '1900-01-01' : undefined} max={key === 'date' ? '2200-12-31' : undefined} maxLength={key === 'title' ? 300 : 150} value={row[key] || ''} onChange={event => setDraft({ ...draft, history: { ...draft.history, [kind]: draft.history[kind].map((item, n) => n === index ? { ...item, [key]: event.target.value || (key === 'title' ? '' : null) } : item) } })}/>}</label>)}</div><button className="dossier-button mt-3" onClick={() => setDraft({ ...draft, history: { ...draft.history, [kind]: draft.history[kind].filter((_, n) => n !== index) } })}><Trash2 size={15}/> حذف القيد</button></div>)}
      </section>)}
      <section id="dossier-notes" className="dossier-form-panel"><h2><span className="dossier-section-number">09</span> ملاحظات عامة</h2><label>ملاحظات إضافية<textarea rows={5} maxLength={4000} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value || null })}/></label></section>
      <div className="dossier-bottom-actions"><span className="dossier-hint">{dirty ? 'احفظ التعديلات قبل الطباعة.' : 'يمكنك معاينة السجل وطباعته.'}</span><button type="button" className="dossier-button dossier-button-primary" disabled={busy || !dirty} onClick={() => void save()}><Save size={16}/> حفظ التعديلات</button></div>
    </fieldset></div>)}
  </div>;
}
const positiveId = (value: string | null | undefined) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export default function StaffDossierPage() {
  const { user } = useAuth(), school = useTenantSchool(), { id } = useParams<{ id: string }>(), [params] = useSearchParams();
  const requested = positiveId(params.get('school_id'));
  const mismatch = params.has('school_id') && (requested === null || (school.schoolId != null && requested !== school.schoolId));
  return <div><div className="dossier-no-print"><SystemAdminSchoolSelector {...school}/></div>{mismatch ? <p role="alert">اختر المدرسة المطابقة للرابط.</p> : <StaffDossierEditor schoolId={school.schoolId} employeeId={positiveId(id)} role={user?.role_key}/>}</div>;
}
