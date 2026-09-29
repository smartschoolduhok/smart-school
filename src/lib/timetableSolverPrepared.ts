import { solveTimetable, type TimetableSolverInput } from './timetableSolver.ts';
import { computeTimetableProposalDigest, type TimetableSolverProposalWithIntegrity } from './timetableAdoption.ts';
import { timetableLoadMatchesScope, type TimetableScope } from './timetableScope.ts';

export interface PreparedTimetableSolver {
  input: TimetableSolverInput;
  timetable_revision: number;
  generation_scope: TimetableScope;
  scope_load_ids?: number[];
  scope_token?: string;
}

/** Run only in the dedicated worker; adoption still validates the proposal on the server. */
export async function solvePreparedTimetable(prepared: PreparedTimetableSolver): Promise<TimetableSolverProposalWithIntegrity> {
  const {input, generation_scope: scope, timetable_revision: revision, scope_load_ids: loadIds} = prepared;
  const result = solveTimetable(input);
  const loads = new Map(input.loads.map(load => [load.id, load]));
  const preserved = new Set((input.currentEntries || []).filter(entry => {
    const load = loads.get(entry.teaching_load_id);
    return entry.is_locked === 1 || (load != null && !timetableLoadMatchesScope(load, scope));
  }).map(entry => `${entry.slot_id}:${entry.teaching_load_id}`));
  return {
    ...result,
    entries: result.entries.map(entry => ({...entry, is_preserved: preserved.has(`${entry.slot_id}:${entry.teaching_load_id}`)})),
    warnings: [...result.warnings, ...(scope.kind !== 'school'
      ? ['اكتمال المقترح يعني اكتمال النطاق المختار. تشمل المعاينة الدروس المحفوظة خارجه لحساب التعارضات، دون إكمال أنصبة باقي النطاقات.'] : [])],
    timetable_revision: revision,
    generation_scope: scope,
    ...(loadIds ? {scope_load_ids: loadIds, scope_token: prepared.scope_token} : {}),
    proposal_digest: await computeTimetableProposalDigest({schoolId: input.schoolId, academicYearId: input.academicYearId,
      revision, entries: result.entries, generationScope: scope, scopeLoadIds: loadIds}),
  };
}
