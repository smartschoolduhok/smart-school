import { hasBetterTimetableScore, solveTimetable, validateTimetableSolverProposal, TimetableSolverSafetyLimitError, type TimetableSolverInput, type TimetableSolverPreview } from './timetableSolver.ts';
import { computeTimetableProposalDigest, type TimetableSolverProposalWithIntegrity } from './timetableAdoption.ts';
import { timetableLoadMatchesScope, type TimetableScope } from './timetableScope.ts';
import { minimumTimetableSubjectDoubles } from './timetableDailySubjects.ts';
import type { TimetableEntry } from './timetable.ts';
import type { TimetableProposalPlacement } from './timetableAdoption.ts';
import { timetableSearchBudget, type TimetableSearchDuration } from './timetablePreferences.ts';

export interface PreparedTimetableSolver {
  input: TimetableSolverInput;
  timetable_revision: number;
  generation_scope: TimetableScope;
  scope_load_ids?: number[];
  scope_token?: string;
  search_duration?: TimetableSearchDuration;
  keep_current?: boolean;
  baseline_entries?: TimetableProposalPlacement[];
  baseline_revision?: number;
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
  timeBudgetMs?: number;
  onProgress?: (progress: TimetableSearchProgress) => void;
}): Promise<TimetableSolverProposalWithIntegrity> {
  const {input, generation_scope: scope, timetable_revision: revision, scope_load_ids: loadIds} = prepared;
  const started = Date.now();
  const maxRuns = Math.max(1, Math.min(1000, Math.floor(options?.maxRuns || 1)));
  const timeBudgetMs = Math.max(2_000, Math.min(900_000, options?.timeBudgetMs || 90_000));
  let result: TimetableSolverPreview | undefined;
  let baseline: TimetableSolverPreview | undefined;
  const baselineEntries = prepared.baseline_revision === revision ? prepared.baseline_entries
    : prepared.keep_current ? input.currentEntries : undefined;
  const asEntries = (entries: readonly {slot_id: number; teaching_load_id: number; is_locked?: 0 | 1}[]): TimetableEntry[] => entries.map((entry, index) => ({
    id: index + 1, school_id: input.schoolId, academic_year_id: input.academicYearId,
    slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id, is_locked: entry.is_locked || 0,
    created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0,
  }));
  if (baselineEntries?.length) {
    const entries = asEntries(baselineEntries);
    const respectsFixed = (input.fixedEntries || []).every(fixed => entries.some(entry =>
      entry.slot_id === fixed.slot_id && entry.teaching_load_id === fixed.teaching_load_id));
    if (respectsFixed && validateTimetableSolverProposal({...input, allowConsecutiveSubjectDouble: true}, entries).length === 0) {
      baseline = solveTimetable({...input, allowConsecutiveSubjectDouble: true, searchSeedEntries: entries,
        limits: {time_budget_ms: 10_000, max_attempts: 0, max_backtracks: 0, max_local_improvement_attempts: 0}});
      baseline = {...baseline, warnings: baseline.warnings.filter(warning => !warning.includes('توقف البحث عند حد الأمان'))};
      result = baseline;
    }
  }
  let runs = 0, attempts = 0, backtracks = 0, improvements = 0;
  let fixedDoubleRequired = false;
  let fallbackStarted = false;
  let deadlineReached = false;
  let strictComplete = baseline?.status === 'complete' && baseline.scoring.penalties.daily_subject_doubles === 0;
  const requiredDouble = minimumTimetableSubjectDoubles(input) > 0;
  for (let run = 0; run < maxRuns; run += 1) {
    options?.onProgress?.({run: run + 1, total_runs: maxRuns, best_scheduled: result?.scheduled_periods || 0,
      best_required: result?.required_periods || 0, elapsed_ms: Date.now() - started});
    const remainingTime = timeBudgetMs - (Date.now() - started);
    if (remainingTime <= 0 || remainingTime < 2_000 && (run > 0 || result)) {deadlineReached = true; break;}
    runs += 1;
    // Search without any daily repeats first. Only an incomplete first phase
    // enables adjacent doubles; a complete strict result never triggers fallback.
    if (maxRuns > 1 && (fixedDoubleRequired || requiredDouble && run > 0 || run >= Math.max(1, Math.min(4, Math.floor(maxRuns / 2))))
      && !strictComplete) fallbackStarted = true;
    try {
      const candidate = solveTimetable(maxRuns === 1 ? input : {...input, searchVariant: run, allowConsecutiveSubjectDouble: fallbackStarted,
        searchDeadline: Date.now() + Math.min(8_000, remainingTime - 1_000),
        searchSeedEntries: run % 2 === 1 && result ? asEntries(result.entries) : undefined,
        limits: {time_budget_ms: Math.min(10_000, remainingTime), max_attempts: 400_000,
          max_backtracks: 24_000, max_local_improvement_attempts: 12_000},
      });
      attempts += candidate.statistics.attempts;
      backtracks += candidate.statistics.backtracks;
      improvements += candidate.statistics.local_improvement_attempts;
      if (!fallbackStarted && candidate.status === 'complete' && candidate.scoring.penalties.daily_subject_doubles === 0) strictComplete = true;
      // Coverage always wins; soft preferences never drop required lessons.
      if (!result || candidate.scheduled_periods > result.scheduled_periods
        || result.status === 'fixed_conflict' && candidate.status !== 'fixed_conflict'
        || candidate.scheduled_periods === result.scheduled_periods && hasBetterTimetableScore(candidate.scoring, result.scoring)) result = candidate;
      fixedDoubleRequired = candidate.status === 'fixed_conflict' && candidate.fixed_conflicts.length > 0
        && candidate.fixed_conflicts.every(conflict => conflict.code === 'fixed_subject_daily_repetition');
      if (candidate.status === 'fixed_conflict' && !input.linkSameTeacherSectionDays && (!fixedDoubleRequired || fallbackStarted)
        || result.status === 'complete' && result.scoring.total_penalty === 0) break;
    } catch (error) {
      if (!(error instanceof TimetableSolverSafetyLimitError) || maxRuns === 1) throw error;
      // Keep an earlier verified proposal if a later, more difficult start times out.
    }
  }
  if (!result) throw new TimetableSolverSafetyLimitError();
  if (maxRuns > 1) result = {...result, statistics: {...result.statistics, search_runs: runs,
    attempts, backtracks, local_improvement_attempts: improvements, elapsed_ms: Date.now() - started,
    time_budget_ms: timeBudgetMs, attempt_budget: 400_000 * runs, backtrack_budget: 24_000 * runs,
    stopped_by_limit: result.statistics.stopped_by_limit || deadlineReached}};
  const loads = new Map(input.loads.map(load => [load.id, load]));
  const preserved = new Set((input.currentEntries || []).filter(entry => {
    const load = loads.get(entry.teaching_load_id);
    return entry.is_locked === 1 || (load != null && !timetableLoadMatchesScope(load, scope));
  }).map(entry => `${entry.slot_id}:${entry.teaching_load_id}`));
  return {
    ...result,
    entries: result.entries.map(entry => ({...entry, is_preserved: preserved.has(`${entry.slot_id}:${entry.teaching_load_id}`)})),
    warnings: [...result.warnings, ...(deadlineReached ? ['انتهت مهلة البحث؛ يُعرض أفضل توزيع تم التحقق منه خلال المدة المختارة.'] : []),
      ...(baseline && result.entries.every(entry => baseline!.entries.some(old =>
      old.slot_id === entry.slot_id && old.teaching_load_id === entry.teaching_load_id)) && result.entries.length === baseline.entries.length
      ? ['احتفظنا بالجدول السابق لأن البحث لم يجد توزيعًا أفضل وفق الأولويات الحالية.'] : []),
      ...(baselineEntries?.length && !baseline ? ['الجدول السابق لا يحقق القيود الحالية؛ استُبعد من المقارنة وأُنشئ مقترح جديد.'] : []),
      ...(prepared.baseline_entries && prepared.baseline_revision !== revision ? ['تغيرت بيانات الجدول؛ المقترح السابق يحتاج معاينة جديدة ولا يمكن استخدامه أساسًا للتحسين.'] : []),
      ...(scope.kind !== 'school'
      ? ['اكتمال المقترح يعني اكتمال النطاق المختار. تشمل المعاينة الدروس المحفوظة خارجه لحساب التعارضات، دون إكمال أنصبة باقي النطاقات.'] : [])],
    timetable_revision: revision,
    generation_scope: scope,
    ...(loadIds ? {scope_load_ids: loadIds, scope_token: prepared.scope_token} : {}),
    proposal_digest: await computeTimetableProposalDigest({schoolId: input.schoolId, academicYearId: input.academicYearId,
      revision, entries: result.entries, generationScope: scope, scopeLoadIds: loadIds, linkSameTeacherSectionDays: input.linkSameTeacherSectionDays}),
  };
}

export function preparedTimetableSearchBudget(prepared: PreparedTimetableSolver) {
  return timetableSearchBudget(prepared.search_duration);
}
