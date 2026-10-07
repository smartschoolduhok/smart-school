import { Fragment } from 'react';
import { EVALUATION_CRITERIA, EVALUATION_CRITERIA_NOTE, type TeacherEvaluation } from '../../lib/schoolRegisters';

export function emptyEvaluation(): TeacherEvaluation {
  return { visits: Array.from({ length: 4 }, () => ({ date: null, scores: Array.from({ length: 20 }, () => null) })) };
}
export function evaluationSummary(scores: (number | null)[]) {
  const completed = scores.filter(score => score !== null && Number.isInteger(score) && score >= 1 && score <= 5).length;
  return { completed, missing: 20 - completed, total: completed === 20 && scores.length === 20 ? scores.reduce<number>((total, score) => total + (score as number), 0) : null };
}
export function readEvaluation(data: Record<string, unknown>): TeacherEvaluation {
  const candidate = data.evaluation as TeacherEvaluation | undefined;
  if (!candidate || !Array.isArray(candidate.visits) || candidate.visits.length !== 4) return emptyEvaluation();
  return { visits: candidate.visits.map(visit => ({ date: typeof visit.date === 'string' ? visit.date : null, scores: Array.from({ length: 20 }, (_, index) => { const score = visit.scores?.[index]; return typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 5 ? score : null; }) })) };
}
const visitNames = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'];
export function TeacherEvaluationTable({ value, onChange, blank = false }: { value: TeacherEvaluation; onChange?: (next: TeacherEvaluation) => void; blank?: boolean }) {
  function update(visitIndex: number, scoreIndex: number | null, next: string) {
    onChange?.({ visits: value.visits.map((visit, index) => index !== visitIndex ? visit : scoreIndex === null ? { ...visit, date: next || null } : { ...visit, scores: visit.scores.map((score, position) => position === scoreIndex ? next === '' ? null : Number(next) : score) }) });
  }
  return <div className="sr-evaluation">
    <p className="sr-evaluation-note">{EVALUATION_CRITERIA_NOTE} الدرجة من 1 إلى 5؛ الخانة الفارغة تعني أنها لم تُقيّم.</p>
    <div className="sr-table-scroll"><table className="sr-evaluation-table">
      <caption className="sr-sr-only">تقييم أداء المدرس: 20 معيارًا وأربع زيارات</caption>
      <thead><tr><th scope="col">المعيار</th>{visitNames.map((name, index) => <th scope="col" key={name}>الزيارة {name}{onChange ? <input type="date" aria-label={`تاريخ الزيارة ${name}`} value={value.visits[index].date || ''} onChange={event => update(index, null, event.target.value)} /> : <small>{blank ? 'التاريخ: … / … / …' : value.visits[index].date || 'التاريخ غير مسجل'}</small>}</th>)}</tr></thead>
      <tbody>{EVALUATION_CRITERIA.map((criterion, index) => <Fragment key={criterion.key}>
        {(index === 0 || criterion.domain !== EVALUATION_CRITERIA[index - 1].domain) && <tr className="sr-evaluation-domain"><th colSpan={5} scope="colgroup">{criterion.domain}</th></tr>}
        <tr><th scope="row"><span className="sr-criterion-number">{index + 1}.</span> {criterion.label}</th>{value.visits.map((visit, visitIndex) => <td key={visitIndex}>{onChange ? <select aria-label={`درجة المعيار ${index + 1} — الزيارة ${visitNames[visitIndex]}`} value={visit.scores[index] ?? ''} onChange={event => update(visitIndex, index, event.target.value)}><option value="">—</option>{[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score}</option>)}</select> : blank ? '' : visit.scores[index] ?? '—'}</td>)}</tr>
      </Fragment>)}</tbody>
      <tfoot><tr><th scope="row">المعايير المقيمة</th>{value.visits.map((visit, index) => <td key={index}>{blank ? '' : <bdi dir="ltr">{`${evaluationSummary(visit.scores).completed} / 20`}</bdi>}</td>)}</tr><tr><th scope="row">مجموع التقدير العددي</th>{value.visits.map((visit, index) => { const summary = evaluationSummary(visit.scores); return <td key={index}>{blank ? '' : summary.total !== null ? <bdi dir="ltr">{`${summary.total} / 100`}</bdi> : <span className="sr-incomplete">غير مكتمل<small>{summary.missing} خانة متبقية</small></span>}</td>; })}</tr></tfoot>
    </table></div>
  </div>;
}
