import { solveTimetable, TimetableSolverSafetyLimitError, type TimetableSolverInput, type TimetableSolverPreview } from './timetableSolver.ts';
import { computeTimetableProposalDigest, type TimetableSolverProposalWithIntegrity } from './timetableAdoption.ts';
import { timetableLoadMatchesScope, type TimetableScope } from './timetableScope.ts';

export interface PreparedTimetableSolver {
  input: TimetableSolverInput;
  timetable_revision: number;
  generation_scope: TimetableScope;
  scope_load_ids?: number[];
  scope_token?: string;
}

export interface TimetableSearchProgress {
  run: number;
  total_runs: number;
  best_scheduled: number;
  best_required: number;
  elapsed_ms: number;
}

/** Run only in the dedicated worker; adoption still validates the proposal on the server. */
export async function solvePreparedTimetable(prepared: PreparedTimetableSolver, options?: {
  maxRuns?: number;
  onProgress?: (progress: TimetableSearchProgress) => void;
}): Promise<TimetableSolverProposalWithIntegrity> {
  const {input, generation_scope: scope, timetable_revision: revision, scope_load_ids: loadIds} = prepared;
  const started = Date.now();
  const maxRuns = Math.max(1, Math.min(8, Math.floor(options?.maxRuns || 1)));
  let result: TimetableSolverPreview | undefined;
  let runs = 0, attempts = 0, backtracks = 0, improvements = 0;
  for (let run = 0; run < maxRuns; run += 1) {
    options?.onProgress?.({run: run + 1, total_runs: maxRuns, best_scheduled: result?.scheduled_periods || 0,
      best_required: result?.required_periods || 0, elapsed_ms: Date.now() - started});
    const remainingTime = 90_000 - (Date.now() - started);
    if (remainingTime < 2_000 && result) break;
    runs += 1;
    try {
      const candidate = solveTimetable(maxRuns === 1 ? input : {...input, searchVariant: run,
        searchDeadline: Date.now() + Math.min(8_000, remainingTime - 1_000),
        searchSeedEntries: run % 2 === 1 && result?.status === 'partial' ? result.entries.map((entry, index) => ({
          id: index + 1, school_id: input.schoolId, academic_year_id: input.academicYearId,
          slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id, is_locked: entry.is_locked,
          created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0,
        })) : undefined,
        limits: {time_budget_ms: Math.min(10_000, remainingTime), max_attempts: 400_000,
          max_backtracks: 24_000, max_local_improvement_attempts: 12_000},
      });
      attempts += candidate.statistics.attempts;
      backtracks += candidate.statistics.backtracks;
      improvements += candidate.statistics.local_improvement_attempts;
      // Coverage always wins; soft preferences never drop required lessons.
      if (!result || candidate.scheduled_periods > result.scheduled_periods
        || candidate.scheduled_periods === result.scheduled_periods && (
          (candidate.scoring.penalties.early_light_subjects || 0) < (result.scoring.penalties.early_light_subjects || 0)
          || (candidate.scoring.penalties.early_light_subjects || 0) === (result.scoring.penalties.early_light_subjects || 0)
            && candidate.scoring.total_penalty < result.scoring.total_penalty)) result = candidate;
      if (candidate.status === 'fixed_conflict' && !input.linkSameTeacherSectionDays
        || result.status === 'complete' && result.scoring.total_penalty === 0) break;
    } catch (error) {
      if (!(error instanceof TimetableSolverSafetyLimitError) || maxRuns === 1) throw error;
      // Keep an earlier verified proposal if a later, more difficult start times out.
    }
  }
  if (!result) throw new TimetableSolverSafetyLimitError();
  if (maxRuns > 1) result = {...result, statistics: {...result.statistics, search_runs: runs,
    attempts, backtracks, local_improvement_attempts: improvements, elapsed_ms: Date.now() - started,
    time_budget_ms: 90_000, attempt_budget: 400_000 * runs, backtrack_budget: 24_000 * runs}};
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
      revision, entries: result.entries, generationScope: scope, scopeLoadIds: loadIds, linkSameTeacherSectionDays: input.linkSameTeacherSectionDays}),
  };
}
