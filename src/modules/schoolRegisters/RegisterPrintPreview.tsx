import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { useStaffPrint } from '../../components/staffDocuments/useStaffPrint';
import type { SchoolRegisterDefinition, SchoolRegisterEntry } from '../../lib/schoolRegisters';
import { extraFields } from './RegisterEditor';
import { emptyEvaluation, readEvaluation, TeacherEvaluationTable } from './TeacherEvaluationTable';
import { useRegisterDialog } from './useRegisterDialog';

export interface RegisterPrintSchool { id: number; name: string; logo_url?: string | null; }
export interface RegisterPrintSnapshot { school: RegisterPrintSchool; year: { id: number; name: string }; definition: SchoolRegisterDefinition; entries: SchoolRegisterEntry[]; blank: boolean; preparedDate: string; filterLabel: string; }
interface PrintBlock { id: string; entryIndex: number; type: 'field' | 'evaluation-identity' | 'evaluation' | 'signatures'; label?: string; value?: string; fieldType?: string; entry?: SchoolRegisterEntry; }
const MM = 96 / 25.4;

export function SchoolRegisterLogo({ school }: { school: RegisterPrintSchool }) {
  const [failed, setFailed] = useState(false);
  if (!school.logo_url || failed) return <div className="sr-school-logo sr-logo-fallback" aria-label={failed ? 'تعذر تحميل شعار المدرسة' : 'شعار المدرسة غير مسجل'}>{school.name.slice(0, 1)}</div>;
  return <img className="sr-school-logo" src={school.logo_url} alt={`شعار ${school.name}`} onError={() => setFailed(true)} />;
}
/** Split only for pagination; every original character remains in the output. */
export function splitPrintValue(value: string, length = 520): string[] {
  if (!value) return [''];
  const characters = Array.from(value), parts: string[] = [];
  for (let index = 0; index < characters.length; index += length) parts.push(characters.slice(index, index + length).join(''));
  return parts;
}
function blocksFor(snapshot: RegisterPrintSnapshot): PrintBlock[] {
  const rows: Array<SchoolRegisterEntry | undefined> = snapshot.blank ? [undefined] : snapshot.entries;
  return rows.flatMap((entry, entryIndex) => {
    const blocks: PrintBlock[] = [];
    const add = (label: string, value: unknown, fieldType = 'text') => splitPrintValue(value == null ? '' : String(value)).forEach((part, index) => blocks.push({ id: `${entryIndex}-${blocks.length}`, entryIndex, type: 'field', label: `${label}${index ? ' (تابع)' : ''}`, value: part, fieldType, entry }));
    if (snapshot.definition.key === 'teacher-evaluation') {
      blocks.push({ id: `${entryIndex}-${blocks.length}`, entryIndex, type: 'evaluation-identity', entry });
      // Keep the four visit signatures with the matrix, never on a page of their own.
      blocks.push({ id: `${entryIndex}-${blocks.length}`, entryIndex, type: 'evaluation', entry });
      snapshot.definition.fields.filter(field => field.key !== 'employee_id').forEach(field => {
        const value = entry?.data[field.key];
        if (typeof value === 'string' && value.trim() && (field.type === 'textarea' || Array.from(value).length > 100)) add(field.label, value, field.type);
      });
    } else snapshot.definition.fields.filter(field => field.key !== 'employee_id').forEach(field => add(field.label, entry?.data[field.key], field.type));
    extraFields(entry?.data || {}).forEach(field => add(field.label, field.value));
    if (entry?.status === 'voided') add('سبب الإبطال', entry.void_reason, 'textarea');
    if (snapshot.definition.key !== 'teacher-evaluation') blocks.push({ id: `${entryIndex}-${blocks.length}`, entryIndex, type: 'signatures', entry });
    return blocks;
  });
}
function PrintHeader({ snapshot, entry }: { snapshot: RegisterPrintSnapshot; entry?: SchoolRegisterEntry }) {
  return <header className="sr-print-header"><div className="sr-print-school"><SchoolRegisterLogo key={`${snapshot.school.id}-${snapshot.school.logo_url}`} school={snapshot.school} /><div><strong>{snapshot.school.name}</strong><span>العام الدراسي {snapshot.year.name}</span></div><div className="sr-print-register-number">السجل<span>{snapshot.definition.number.toString().padStart(2, '0')}</span></div></div><h1>{snapshot.definition.title}</h1><div className="sr-print-meta"><span>{snapshot.blank ? 'نموذج فارغ' : `القيد ${entry?.id} · الإصدار ${entry?.version}`}</span><span>{snapshot.blank ? 'تاريخ القيد: … / … / …' : `تاريخ القيد: ${entry?.entry_date}`}</span>{entry?.status === 'voided' && <strong>قيد مُبطل</strong>}</div><h2>{snapshot.blank ? 'عنوان القيد: ................................................................' : entry?.title}</h2></header>;
}
function PrintFooter({ snapshot, page, total }: { snapshot: RegisterPrintSnapshot; page: number; total: number }) {
  return <footer className="sr-print-footer"><span>{snapshot.definition.templateStatus === 'photo' ? 'مستند إلى نموذج المدرسة المصور؛ صياغة للمراجعة' : 'قالب مقترح للمراجعة مع المدرسة'}</span><div><span>أُعد في {snapshot.preparedDate}</span><span>صفحة {page} من {total}</span></div></footer>;
}
function Block({ block, snapshot }: { block: PrintBlock; snapshot: RegisterPrintSnapshot }) {
  if (block.type === 'evaluation-identity') return <dl className="sr-evaluation-identity">{snapshot.definition.fields.filter(field => field.key !== 'employee_id' && field.type !== 'textarea').map(field => {
    const value = block.entry?.data[field.key] == null ? '' : String(block.entry.data[field.key]);
    return <div key={field.key}><dt>{field.label}</dt><dd>{snapshot.blank ? '................................' : Array.from(value).length > 100 ? 'انظر التفصيل المرفق' : value || 'غير مسجل'}</dd></div>;
  })}</dl>;
  if (block.type === 'evaluation') return <div className="sr-evaluation-print-block"><TeacherEvaluationTable value={block.entry ? readEvaluation(block.entry.data) : emptyEvaluation()} blank={snapshot.blank} /><div className="sr-evaluation-signatures">{['الأولى', 'الثانية', 'الثالثة', 'الرابعة'].map(name => <div key={name}><strong>الزيارة {name}</strong><span>اسم وتوقيع المدرس</span><i /><span>اسم وتوقيع المدير</span><i /></div>)}</div></div>;
  if (block.type === 'signatures') return <div className="sr-print-signatures"><div>اسم وتوقيع منظم السجل<i /></div><div>اسم وتوقيع مدير المدرسة<i /></div><div>ختم المدرسة<i /></div></div>;
  return <div className={`sr-print-field${!block.value && snapshot.blank ? ' sr-print-empty' : ''}${block.fieldType === 'textarea' ? ' sr-print-textarea' : ''}`}><strong>{block.label}</strong><div>{block.value || (snapshot.blank ? '' : 'غير مسجل')}</div></div>;
}

export function RegisterPrintPreview({ snapshot, onClose }: { snapshot: RegisterPrintSnapshot; onClose: () => void }) {
  const blocks = useMemo(() => blocksFor(snapshot), [snapshot]);
  const measureRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [pagination, setPagination] = useState<{ pages: PrintBlock[][]; error: string } | null>(null);
  const initialPages = useMemo(() => snapshot.blank ? [blocks] : snapshot.entries.map((_, index) => blocks.filter(block => block.entryIndex === index)), [blocks, snapshot]);
  const pages = pagination?.pages || initialPages;
  useLayoutEffect(() => {
    let live = true;
    async function measure() {
      if (document.fonts) await document.fonts.ready;
      if (!live || !measureRef.current) return;
      const root = measureRef.current;
      const footerHeight = root.querySelector('.sr-print-footer')?.getBoundingClientRect().height || 17 * MM;
      const nextPages: PrintBlock[][] = [];
      let error = '';
      for (const group of initialPages) {
        const header = root.querySelector<HTMLElement>(`[data-measure-entry="${group[0]?.entryIndex}"] .sr-print-header`);
        const available = 267 * MM - (header?.getBoundingClientRect().height || 55 * MM) - footerHeight - 8 * MM;
        let page: PrintBlock[] = [], height = 0;
        for (const block of group) {
          const element = root.querySelector<HTMLElement>(`[data-print-block="${block.id}"]`);
          const measured = element?.getBoundingClientRect().height || (block.type === 'evaluation' ? 140 * MM : block.type === 'signatures' ? 32 * MM : 15 * MM);
          if (measured > available) error = 'أحد الحقول أكبر من مساحة الصفحة. قصّر عنوان القيد أو الحقل قبل الطباعة.';
          if (page.length && height + measured + 3 * MM > available) { nextPages.push(page); page = []; height = 0; }
          page.push(block); height += measured + 3 * MM;
        }
        if (page.length) nextPages.push(page);
      }
      if (live) setPagination({ pages: nextPages, error });
    }
    void measure();
    return () => { live = false; };
  }, [initialPages]);
  const ready = !!pagination && !pagination.error && !!snapshot.school.name && !!snapshot.year.name;
  const { handlePrint, isPrinting, error } = useStaffPrint(ready ? snapshot : null, '.school-register-document', `${snapshot.definition.title} — ${snapshot.school.name}`);
  useRegisterDialog(dialogRef, onClose, isPrinting);
  return createPortal(<div ref={dialogRef} tabIndex={-1} className="school-register-print-preview" dir="rtl" lang="ar" role="dialog" aria-modal="true" aria-label="معاينة طباعة السجل" data-ready={ready}>
    <div className="sr-print-controls"><div><strong>{snapshot.definition.title}</strong><p>{snapshot.filterLabel} · {pages.length} صفحة · A4 عمودي</p></div><div className="sr-actions"><button type="button" className="sr-button" disabled={!ready || isPrinting} onClick={handlePrint}><Printer size={17} />{isPrinting ? 'جاري التجهيز…' : 'طباعة / حفظ PDF'}</button><button type="button" className="sr-button sr-button-secondary" disabled={isPrinting} onClick={onClose}><X size={17} />إغلاق المعاينة</button></div>{(error || pagination?.error) && <p role="alert" className="sr-error">{error || pagination?.error}</p>}</div>
    <p className="sr-print-not-ready">تحتاج هذه المعاينة إلى اكتمال التحضير قبل الطباعة.</p>
    <div ref={measureRef} className="sr-print-measure" aria-hidden="true">{initialPages.map((group, index) => <div key={index} data-measure-entry={index}><PrintHeader snapshot={snapshot} entry={group[0]?.entry} />{group.map(block => <div key={block.id} data-print-block={block.id}><Block block={block} snapshot={snapshot} /></div>)}</div>)}<PrintFooter snapshot={snapshot} page={1} total={1} /></div>
    <div className="school-register-document sr-print-pages">{pages.map((page, index) => <article className="sr-print-page staff-document-page" key={index}><PrintHeader snapshot={snapshot} entry={page[0]?.entry} /><div className="sr-print-content">{page.map(block => <div className="sr-print-block" key={block.id}><Block block={block} snapshot={snapshot} /></div>)}</div><PrintFooter snapshot={snapshot} page={index + 1} total={pages.length} /></article>)}</div>
  </div>, document.body);
}
