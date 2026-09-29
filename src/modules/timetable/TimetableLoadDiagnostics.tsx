import type { TimetableInvalidLoadDetail, TimetableReadinessSummary } from '../../lib/timetable';

function LoadDetails({ loads, archived = false }: { loads: TimetableInvalidLoadDetail[]; archived?: boolean }) {
  return <ul className="mt-3 space-y-3 text-sm">
    {loads.map(load => <li key={load.teaching_load_id} className="rounded-lg border border-current/15 bg-white/70 p-3">
      <p className="font-bold">{load.subject_name} — {load.class_name}{load.section_name ? ` / ${load.section_name}` : ''}</p>
      <p className="mt-1 text-xs">نصاب رقم <bdi>{load.teaching_load_id}</bdi>{load.employee_name ? ` · ${load.employee_name}` : ''} · دروس محفوظة: <bdi>{load.scheduled_entry_count}</bdi></p>
      <ul className="mt-2 space-y-1">
        {load.reasons.map(reason => <li key={reason.code}>
          <span className="font-semibold">{reason.message}</span>{' '}
          {archived && (reason.code === 'class_archived' || reason.code === 'section_archived')
            ? 'يُراجع هذا النصاب مجددًا عند إعادة تفعيل الصف أو الشعبة.'
            : reason.action}
        </li>)}
      </ul>
    </li>)}
  </ul>;
}

export function TimetableLoadDiagnostics({ readiness }: { readiness?: TimetableReadinessSummary | null }) {
  if (!readiness) return null;
  const invalid = readiness.invalid_load_details || [], archived = readiness.archived_load_details || [];
  return <>
    {invalid.length > 0 && <details open className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
      <summary className="cursor-pointer font-bold">أنصبة تحتاج إلى تصحيح: <bdi>{invalid.length}</bdi></summary>
      <p className="mt-2 text-sm">تظهر هنا أيضًا الأنصبة التي لا تظهر ضمن الشعب الفعالة، مع السبب والإجراء المطلوب.</p>
      <LoadDetails loads={invalid} />
    </details>}
    {archived.length > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <summary className="cursor-pointer font-bold">أنصبة محفوظة لصفوف أو شعب مؤرشفة: <bdi>{readiness.archived_load_count ?? archived.length}</bdi></summary>
      <p className="mt-2 text-sm">لا تدخل هذه الأنصبة في التوليد أو السعة الحالية لأنها تخص صفوفًا أو شعبًا مؤرشفة ولا تملك دروسًا محفوظة في الجدول الحالي. تبقى إعداداتها محفوظة وتُفحص مجددًا عند إعادة التفعيل.</p>
      <LoadDetails loads={archived} archived />
    </details>}
  </>;
}
