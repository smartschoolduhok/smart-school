import type { Class, Section } from '../../types';
import type { TimetableScope } from '../../lib/timetableScope';

export function TimetableScopeSelector({ classes, sections, value, onChange, disabled = false }: {
  classes: Class[]; sections: Section[]; value: TimetableScope; onChange: (value: TimetableScope) => void; disabled?: boolean;
}) {
  const activeClasses = classes.filter(item => item.status === 'active');
  const stages = [...new Set(activeClasses.map(item => item.stage))];
  const options: Array<{ key: string; label: string; value: TimetableScope }> = [
    { key: 'school', label: 'المدرسة كاملة', value: { kind: 'school' } },
    ...stages.map(stage => ({ key: `stage:${stage}`, label: `مرحلة ${stage}`, value: { kind: 'stage' as const, stage } })),
    ...activeClasses.flatMap(item => [
      { key: `class:${item.id}`, label: `الصف: ${item.name} — جميع شعبه`, value: { kind: 'class' as const, class_id: item.id } },
      ...sections.filter(section => section.class_id === item.id && section.status === 'active').map(section => ({
        key: `section:${section.id}`, label: `${item.name} / ${section.name}`, value: { kind: 'section' as const, class_id: item.id, section_id: section.id },
      })),
    ]),
  ];
  const selected = value.kind === 'school' ? 'school' : value.kind === 'stage' ? `stage:${value.stage}` : value.kind === 'class' ? `class:${value.class_id}` : `section:${value.section_id}`;
  return <label className="block text-sm font-bold text-slate-800">نطاق التوليد
    <select aria-label="نطاق التوليد" disabled={disabled} value={selected} onChange={event => onChange(options.find(option => option.key === event.target.value)!.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5">
      {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>
  </label>;
}
