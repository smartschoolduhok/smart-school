import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  OFFICIAL_BOOK_STAFF_JOB_TITLE_MAX_LENGTH,
  OFFICIAL_BOOK_STAFF_NAME_MAX_LENGTH,
  OFFICIAL_BOOK_STAFF_ROW_LIMIT,
  type OfficialBookStaffRoster,
  type OfficialBookStaffRow,
} from '../../lib/officialBookStaff';

interface Props {
  value: OfficialBookStaffRoster;
  onChange: (value: OfficialBookStaffRoster) => void;
  onReload: () => void;
  disabled?: boolean;
}

export function StaffRosterEditor({ value, onChange, onReload, disabled = false }: Props) {
  const update = (index: number, patch: Partial<OfficialBookStaffRow>) => {
    onChange({ ...value, rows: value.rows.map((row, i) => i === index ? { ...row, ...patch } : row) });
  };
  const move = (index: number, direction: number) => {
    const rows = [...value.rows];
    [rows[index], rows[index + direction]] = [rows[index + direction], rows[index]];
    onChange({ ...value, rows });
  };

  return (
    <fieldset className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/30 p-4" disabled={disabled}>
      <legend className="px-2 text-sm font-bold text-blue-900">قائمة كادر المدرسة</legend>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">طريقة الطباعة</span>
        <select aria-label="طريقة طباعة كتاب الكادر" value={value.mode}
          onChange={event => onChange({ ...value, mode: event.target.value as OfficialBookStaffRoster['mode'] })}
          className="w-full rounded-lg border bg-white px-3 py-2 text-sm">
          <option value="letter_with_attachment">كتاب رسمي مع قائمة مرفقة</option>
          <option value="attachment_only">قائمة مرفقة فقط</option>
        </select>
      </label>
      <p className="text-xs leading-relaxed text-gray-600">
        تُحمَّل الأسماء من كادر المدرسة المختارة، مع المعاون في البداية. يمكنك تعديل الاسم والعنوان الوظيفي وإضافة أسماء وحذفها وتغيير ترتيبها لهذا الكتاب.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[560px] text-sm" aria-label="تعديل قائمة الكادر">
          <thead className="bg-gray-50 text-gray-700">
            <tr><th className="w-10 p-2">ت</th><th className="p-2 text-right">الاسم</th><th className="w-44 p-2 text-right">العنوان الوظيفي</th><th className="w-28 p-2">الترتيب والحذف</th></tr>
          </thead>
          <tbody>
            {value.rows.map((row, index) => (
              <tr key={`${row.employee_id ?? 'manual'}-${index}`} className="border-t border-gray-200">
                <td className="p-2 text-center text-gray-500">{index + 1}</td>
                <td className="p-2"><input aria-label={`اسم الكادر ${index + 1}`} value={row.name}
                  onChange={event => update(index, { name: event.target.value })} maxLength={OFFICIAL_BOOK_STAFF_NAME_MAX_LENGTH}
                  className="w-full rounded-md border px-2 py-2 font-normal" /></td>
                <td className="p-2"><input aria-label={`العنوان الوظيفي ${index + 1}`} value={row.job_title}
                  onChange={event => update(index, { job_title: event.target.value })} maxLength={OFFICIAL_BOOK_STAFF_JOB_TITLE_MAX_LENGTH}
                  className="w-full rounded-md border px-2 py-2" /></td>
                <td className="p-2"><div className="flex justify-center gap-1">
                  <button type="button" aria-label={`رفع الاسم ${index + 1}`} disabled={index === 0 || disabled} onClick={() => move(index, -1)} className="rounded p-1 text-gray-600 hover:bg-gray-100 disabled:opacity-30"><ArrowUp size={16} /></button>
                  <button type="button" aria-label={`خفض الاسم ${index + 1}`} disabled={index === value.rows.length - 1 || disabled} onClick={() => move(index, 1)} className="rounded p-1 text-gray-600 hover:bg-gray-100 disabled:opacity-30"><ArrowDown size={16} /></button>
                  <button type="button" aria-label={`حذف الاسم ${index + 1}`} onClick={() => onChange({ ...value, rows: value.rows.filter((_, i) => i !== index) })} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!value.rows.length && <p className="text-sm text-gray-500">أضف أسماء إلى القائمة أو حمّل كادر المدرسة.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={value.rows.length >= OFFICIAL_BOOK_STAFF_ROW_LIMIT || disabled}
          onClick={() => onChange({ ...value, rows: [...value.rows, { employee_id: null, name: '', job_title: 'مدرس' }] })}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16} />إضافة اسم</button>
        <button type="button" onClick={onReload} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"><RefreshCw size={16} />تحميل كادر المدرسة</button>
        <span className="text-xs text-gray-500">عدد الأسماء: {value.rows.length}</span>
      </div>
    </fieldset>
  );
}
