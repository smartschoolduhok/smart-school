import { useState } from 'react';
import { REGULATION_TEMPLATES, copyRegulationTemplate, matchesTemplateYear, type RegulationTemplate } from '../../lib/policyTemplates';

export function RegulationTemplatePicker({ yearName, disabled, onApply }: {
  yearName: string; disabled: boolean; onApply: (template: RegulationTemplate) => void;
}) {
  const [id, setId] = useState('');
  const template = REGULATION_TEMPLATES.find(item => item.id === id);
  const yearMatches = template && matchesTemplateYear(yearName, template.school_year);
  return <section className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
    <label className="block font-medium">البدء من قالب موثق
      <select disabled={disabled} value={id} onChange={event => setId(event.target.value)} className="mt-2 w-full min-w-0 rounded-lg border bg-white p-2">
        <option value="">اختر قالبًا اختياريًا</option>
        {REGULATION_TEMPLATES.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </label>
    {template && <>
      <p className="text-sm">{template.applicability}</p>
      <p className="text-sm">{template.notes}</p>
      <p className="text-sm">القالب للصف: <b>{template.class_label}</b> — طابقه مع الصف الذي اخترته.</p>
      <a href={template.source_url} target="_blank" rel="noreferrer" className="text-sm text-blue-800 underline">فتح الكتاب الرسمي — {template.source_date}</a>
      {!yearMatches && <p className="text-sm text-amber-900">اختر السنة {template.school_year} لاستخدام هذا القالب؛ لا تُنقل حدود المواليد تلقائيًا إلى سنة أخرى.</p>}
      <button type="button" disabled={disabled || !yearMatches} className="block rounded-lg bg-blue-700 px-3 py-2 text-white disabled:opacity-50"
        onClick={() => { const copy = copyRegulationTemplate(id); if (copy && yearMatches) onApply(copy); }}>تعبئة مسودة قابلة للتخصيص</button>
      <p className="text-xs">تعبئة الحقول لا تحفظ أو تعتمد اللائحة. تخصيصها يخص هذه المدرسة فقط؛ الإصدارات السابقة تبقى محفوظة.</p>
    </>}
  </section>;
}
