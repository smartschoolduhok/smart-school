import type { AdmissionRules } from '../../lib/admissionRegulations';
import { DateText } from './DateText';

export function AgeRuleSummary({ rules }: { rules: AdmissionRules }) {
  return <div className="space-y-1 text-sm">
    <p>نطاق العمر: {rules.age_scope === 'continuing' ? 'القبول والاستمرار' : 'القبول فقط / نطاق غير مثبت'}</p>
    {rules.age_rule === 'birth_date' && rules.birth_date_bounds && <>
      {(['male', 'female'] as const).map(gender => {
        const bounds = rules.birth_date_bounds![gender];
        return <p key={gender}><DateText text={`${gender === 'male' ? 'الذكور' : 'الإناث'}: أقدم ميلاد ${bounds.earliest || 'غير محدد'} · أحدث ميلاد ${bounds.latest || 'غير محدد'}`} /></p>;
      })}
      <p>تاريخ عرض العمر: <bdi className="whitespace-nowrap">{rules.age_reference_date}</bdi>؛ المقارنة بحدود المواليد أعلاه.</p>
    </>}
    {rules.age_rule === 'bounded' && <p>العمر بالأشهر في <bdi className="whitespace-nowrap">{rules.age_reference_date}</bdi>: من {rules.min_age_months ?? 'غير محدد'} إلى {rules.max_age_months ?? 'غير محدد'}</p>}
    {rules.age_rule === 'review' && <p>حدود العمر تحتاج مراجعة.</p>}
    {rules.age_rule === 'not_applicable' && <p>شرط العمر لا ينطبق وفق اللائحة.</p>}
  </div>;
}
