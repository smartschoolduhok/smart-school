import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { businessDate } from '../../lib/businessTime';
import { parseRegisterData, type RegisterExtraField, type SchoolRegisterDefinition, type SchoolRegisterEntry } from '../../lib/schoolRegisters';
import type { RegisterWrite } from '../../lib/schoolRegistersApi';
import { emptyEvaluation, readEvaluation, TeacherEvaluationTable } from './TeacherEvaluationTable';
import { useRegisterDialog } from './useRegisterDialog';

export interface RegisterEmployee { id: number; school_id: number; full_name: string; role?: string; status?: string; }
export function RegisterDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useRegisterDialog(ref, onClose, busy);
  return <div className="sr-dialog-backdrop"><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="sr-dialog"><header className="sr-dialog-header"><h2>{title}</h2><button type="button" className="sr-icon-button" aria-label="إغلاق النافذة" disabled={busy} onClick={onClose}><X size={20} /></button></header>{children}</div></div>;
}

export function extraFields(data: Record<string, unknown>): RegisterExtraField[] {
  return Array.isArray(data.extra_fields) ? data.extra_fields.filter((item): item is RegisterExtraField => !!item && typeof item === 'object' && typeof item.label === 'string' && typeof item.value === 'string') : [];
}
export function RegisterEditor({ definition, entry, employees, employeeLoading, employeeError, reloadEmployees, busy, error, conflict = false, onReloadConflict, onSave, onClose }: {
  definition: SchoolRegisterDefinition; entry: SchoolRegisterEntry | null; employees: RegisterEmployee[]; employeeLoading: boolean; employeeError: string;
  reloadEmployees: () => void; busy: boolean; error: string; conflict?: boolean; onReloadConflict?: () => Promise<void>; onSave: (input: RegisterWrite) => Promise<void>; onClose: () => void;
}) {
  const [title, setTitle] = useState(entry?.title || '');
  const [date, setDate] = useState(entry?.entry_date || businessDate());
  const [data, setData] = useState<Record<string, unknown>>(entry ? { ...entry.data } : definition.key === 'teacher-evaluation' ? { evaluation: emptyEvaluation() } : {});
  const [extras, setExtras] = useState<RegisterExtraField[]>(extraFields(entry?.data || {}));
  const [validation, setValidation] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardRef = useRef<HTMLDivElement>(null);
  const original = useRef(JSON.stringify({ title, date, data, extras }));
  const dirty = JSON.stringify({ title, date, data, extras }) !== original.current;
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty]);
  useEffect(() => { if (confirmDiscard) discardRef.current?.focus(); }, [confirmDiscard]);
  function requestClose() { if (!busy) { if (dirty) setConfirmDiscard(true); else onClose(); } }
  const isEvaluation = definition.key === 'teacher-evaluation';
  function setField(key: string, value: unknown) { setData(previous => ({ ...previous, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setValidation('');
    try {
      if (!title.trim()) throw new Error('أدخل عنوانًا واضحًا للقيد.');
      if (isEvaluation && (!data.employee_id || employeeLoading || employeeError)) throw new Error('اختر مدرسًا بعد اكتمال تحميل قائمة الكادر.');
      await onSave({ title: title.trim(), entry_date: date, data: parseRegisterData(definition.key, { ...data, extra_fields: extras }) });
    } catch (caught) { setValidation(caught instanceof Error ? caught.message : 'راجع بيانات القيد.'); }
  }
  return <RegisterDialog title={entry ? 'تعديل القيد' : 'إضافة قيد جديد'} onClose={requestClose} busy={busy}>
    <form onSubmit={submit} className="sr-editor"><p className="sr-muted">{definition.title} · {entry ? `الإصدار ${entry.version}` : 'يُحفظ في المدرسة والسنة المختارتين'}</p>
      {confirmDiscard && <div ref={discardRef} tabIndex={-1} role="alert" className="sr-discard-confirmation"><strong>توجد تعديلات لم تُحفظ</strong><p>يمكنك متابعة التحرير أو إغلاق النافذة دون حفظ هذه التعديلات.</p><div className="sr-actions"><button type="button" className="sr-button" disabled={busy} onClick={() => setConfirmDiscard(false)}>متابعة التحرير</button><button type="button" className="sr-button sr-button-secondary" disabled={busy} onClick={onClose}>تجاهل التعديلات وإغلاق</button></div></div>}
      {(error || validation) && <p role="alert" className="sr-error">{error || validation}</p>}
      {conflict && onReloadConflict && <div className="sr-conflict-reload"><p>حُفظت نسخة أحدث من هذا القيد. تبقى مسودتك هنا؛ تحميل أحدث نسخة سيستبدل تعديلاتك غير المحفوظة.</p><button type="button" className="sr-button sr-button-secondary" disabled={busy} onClick={() => void onReloadConflict()}>{busy ? 'جاري تحميل أحدث نسخة…' : 'استبدال مسودتي بأحدث نسخة'}</button></div>}
      <fieldset disabled={busy} className="sr-form-grid">
        <label className="sr-wide">عنوان القيد <span aria-hidden="true">*</span><input aria-label="عنوان القيد" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder={isEvaluation ? 'مثال: تقييم المدرس خلال العام الدراسي' : 'عنوان موجز يسهّل الرجوع إلى القيد'} /></label>
        <label>تاريخ القيد <span aria-hidden="true">*</span><input aria-label="تاريخ القيد" required type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        {definition.fields.map(field => field.key === 'employee_id' ? <label key={field.key} className="sr-wide">المدرس المرتبط بسجل الموظفين <span aria-hidden="true">*</span>
          <select required aria-label="المدرس المرتبط بسجل الموظفين" disabled={employeeLoading || !!employeeError} value={String(data.employee_id || '')} onChange={event => { const id = Number(event.target.value); const selected = employees.find(employee => employee.id === id); setData(previous => ({ ...previous, employee_id: id || '', teacher_name: selected?.full_name || '' })); }}>
            <option value="">{employeeLoading ? 'جاري تحميل الكادر…' : 'اختر المدرس'}</option>
            {!!data.employee_id && !employees.some(employee => employee.id === data.employee_id) && <option value={String(data.employee_id)}>{String(data.teacher_name || 'المدرس المرتبط بالقيد')} (قيد سابق)</option>}
            {employees.map(employee => <option value={employee.id} key={employee.id}>{employee.full_name}{employee.status === 'archived' ? ' — مؤرشف' : ''}</option>)}
          </select>{employeeError && <span role="alert" className="sr-error">{employeeError} <button type="button" onClick={reloadEmployees}>إعادة تحميل الكادر</button></span>}
        </label> : <label key={field.key} className={field.type === 'textarea' ? 'sr-wide' : ''}>{field.label}{field.required && <span aria-hidden="true"> *</span>}
          {field.type === 'textarea' ? <textarea aria-label={field.label} rows={3} maxLength={4000} required={field.required} value={String(data[field.key] ?? '')} onChange={event => setField(field.key, event.target.value)} /> : <input aria-label={field.label} type={field.type} min={field.type === 'number' ? 0 : undefined} max={field.type === 'number' ? 1_000_000_000 : undefined} step={field.type === 'number' ? 'any' : undefined} maxLength={500} required={field.required} readOnly={isEvaluation && field.key === 'teacher_name'} value={String(data[field.key] ?? '')} onChange={event => setField(field.key, field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />}
        </label>)}
      </fieldset>
      {isEvaluation && <fieldset disabled={busy}><TeacherEvaluationTable value={readEvaluation(data)} onChange={value => setField('evaluation', value)} /></fieldset>}
      <fieldset disabled={busy} className="sr-extra-fields"><legend>حقول إضافية <span>{extras.length} / 20</span></legend><p className="sr-muted">خصص هذا القيد بما يلائم نموذج المدرسة.</p>
        {extras.map((field, index) => <div className="sr-extra-row" key={index}><label>عنوان الحقل<input aria-label={`عنوان الحقل الإضافي ${index + 1}`} maxLength={120} required value={field.label} onChange={event => setExtras(previous => previous.map((item, position) => index === position ? { ...item, label: event.target.value } : item))} /></label><label>القيمة<textarea aria-label={`قيمة الحقل الإضافي ${index + 1}`} rows={2} maxLength={2000} value={field.value} onChange={event => setExtras(previous => previous.map((item, position) => index === position ? { ...item, value: event.target.value } : item))} /></label><button type="button" className="sr-icon-button" aria-label={`حذف الحقل الإضافي ${index + 1}`} onClick={() => setExtras(previous => previous.filter((_, position) => index !== position))}><X size={18} /></button></div>)}
        <button type="button" className="sr-button sr-button-secondary" disabled={extras.length >= 20} onClick={() => setExtras(previous => [...previous, { label: '', value: '' }])}><Plus size={16} />إضافة حقل</button>
      </fieldset>
      <footer className="sr-editor-actions"><span className="sr-draft-state" aria-live="polite">{dirty ? 'تعديلات غير محفوظة' : 'الحقول بعلامة * مطلوبة'}</span><button type="button" className="sr-button sr-button-secondary" disabled={busy} onClick={requestClose}>إلغاء</button><button type="submit" className="sr-button" disabled={busy || (isEvaluation && (employeeLoading || !!employeeError))}>{busy ? 'جاري الحفظ…' : entry ? 'حفظ التعديلات' : 'حفظ القيد'}</button></footer>
    </form>
  </RegisterDialog>;
}
