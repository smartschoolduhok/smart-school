import {
  evaluateTimetableEntryPlacement, calculateTeacherAvailabilitySummary, activeTimetableLessonSlots, occupiedTimetableDays,
  type TimetableDay, type TimetableSlot, type TimetableEntry, type TimetableTeachingLoad,
  type TimetableTeacherAvailabilityOverride, type TimetableTeacherConstraints,
} from './timetable.ts';

export const MAX_WEEK_PERIODS = 30;
export const MAX_WEEK_BODY_BYTES = 32_768;
export const MAX_WEEK_UPDATE_LAYERS = 30;
export const STALE_WEEK_MESSAGE = 'تغيرت إعدادات الأسبوع بعد المعاينة. أعد تحميلها ثم حاول مرة أخرى.';
export const WEEK_LEAVE_MESSAGE = 'لديك إعدادات أسبوع غير محفوظة. هل تريد تجاهلها والمغادرة؟';
export class WeekSetupError extends Error {
  code: string; status: 400 | 404 | 409 | 413;
  constructor(code: string, message: string, status: 400 | 404 | 409 | 413 = 400) { super(message); this.code = code; this.status = status; }
}
export const staleWeek = () => new WeekSetupError('stale_week_setup', STALE_WEEK_MESSAGE, 409);
export type WeekPeriod = Pick<TimetableSlot, 'slot_index' | 'slot_type' | 'lesson_number' | 'label' | 'start_time' | 'end_time' | 'is_active'>;
export type WeekMode = 'fill_empty_days' | 'update_matching_keep_extra';
export interface WeekScope { school_id?: number; academic_year_id: number }
export interface WeekRequest extends WeekScope {
  expected_revision: number; mode: WeekMode; source_day_of_week: number | null;
  targets: Array<{ day_of_week: number; activate_day: boolean }>; template: WeekPeriod[];
  confirm_apply?: true; preview_digest?: string; acknowledge_availability_impact?: boolean;
}
export interface WeekReferences { slot_id: number; scheduled_entries: number; locked_entries: number; availability_overrides: number; historical_references: number }
export interface WeekContext {
  school_id: number; academic_year_id: number; revision: number;
  days: TimetableDay[]; slots: TimetableSlot[]; loads: TimetableTeachingLoad[]; entries: TimetableEntry[];
  availability: TimetableTeacherAvailabilityOverride[]; constraints: TimetableTeacherConstraints[];
  history: Array<{ slot_id: number; count: number }>;
}
export interface WeekSnapshot extends WeekScope {
  school_id: number; revision: number; days: TimetableDay[]; periods: TimetableSlot[];
  references: WeekReferences[]; summary: ReturnType<typeof summarizeWeekDay>[];
}
export interface WeekNotice {
  code: string; message: string; entry_id?: number; employee_id?: number;
  evidence?: { dimension: 'capacity_deficit' | 'working_days'; actual: number; limit: number; excess: number };
}
export interface WeekChange { day_of_week: number; id: number | null; before: WeekPeriod | null; after: WeekPeriod; action: 'create' | 'update' | 'unchanged' | 'retained' }
export interface WeekDayPlan {
  day_of_week: number; action: 'configure' | 'skipped_existing' | 'blocked'; activate_day: boolean;
  changes: WeekChange[]; before: ReturnType<typeof summarizeWeekDay>; after: ReturnType<typeof summarizeWeekDay>;
  impact: Omit<WeekReferences, 'slot_id'>; warnings: WeekNotice[]; blockers: WeekNotice[];
}
export interface WeekPlan {
  can_apply: boolean; revision: number; preview_digest: string; days: WeekDayPlan[];
  counts: { create: number; update: number; unchanged: number; retained: number; skipped: number; blocked: number; activated: number };
  warnings: WeekNotice[]; blockers: WeekNotice[]; requires_availability_acknowledgement: boolean;
  update_layers: number[][]; write_statement_count: number; no_change: boolean;
}
const fail = (message = 'بيانات إعداد الأسبوع غير صالحة.', code = 'invalid_week_setup'): never => { throw new WeekSetupError(code, message); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const integer = (v: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const periodKeys = ['slot_index', 'slot_type', 'lesson_number', 'label', 'start_time', 'end_time', 'is_active'];
export function minuteOfDay(value: unknown): number {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return fail('استخدم وقتًا صحيحًا بصيغة HH:mm دون تجاوز منتصف الليل.', 'invalid_period_time');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
export function bellTime(minutes: number): string {
  if (!integer(minutes, 0, 1439)) return fail('لا يدعم الإعداد عبور منتصف الليل أو 24:00.', 'cross_midnight');
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
export function periodValues(slot: WeekPeriod): WeekPeriod {
  return { slot_index: slot.slot_index, slot_type: slot.slot_type, lesson_number: slot.lesson_number,
    label: slot.label, start_time: slot.start_time, end_time: slot.end_time, is_active: slot.is_active };
}
export function validateWeekTemplate(raw: unknown): WeekPeriod[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_WEEK_PERIODS) return fail('يجب أن يحتوي اليوم على 1 إلى 30 فترة.', 'invalid_period_count');
  const slots = raw.map((p): WeekPeriod => {
    if (!object(p) || !keys(p, periodKeys) || !integer(p.slot_index)
      || (p.slot_type !== 'lesson' && p.slot_type !== 'break') || (p.is_active !== 0 && p.is_active !== 1)
      || typeof p.label !== 'string' || !p.label.trim() || p.label.length > 120
      || /[\u0000-\u001f]/.test(p.label)) return fail('تحقق من نوع الفترة وترتيبها واسمها وحالتها.');
    if (p.slot_type === 'lesson' ? !integer(p.lesson_number) : p.lesson_number !== null) return fail('رقم الحصة موجب؛ الاستراحة بلا رقم حصة.');
    if (minuteOfDay(p.start_time) >= minuteOfDay(p.end_time)) return fail('يجب أن تسبق بداية الفترة نهايتها.', 'invalid_period_time');
    return { slot_index: p.slot_index, slot_type: p.slot_type as WeekPeriod['slot_type'], lesson_number: p.lesson_number as number | null,
      label: p.label, start_time: p.start_time as string, end_time: p.end_time as string, is_active: p.is_active };
  }).sort((a, b) => a.slot_index - b.slot_index);
  if (!slots.some(p => p.slot_type === 'lesson')) return fail('يجب أن يحتوي اليوم على حصة واحدة على الأقل.');
  if (new Set(slots.map(p => p.slot_index)).size !== slots.length
    || new Set(slots.filter(p => p.slot_type === 'lesson').map(p => p.lesson_number)).size !== slots.filter(p => p.slot_type === 'lesson').length)
    return fail('ترتيب الفترة ورقم الحصة لا يتكرران في اليوم.', 'duplicate_period_identity');
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++)
    if (overlap(slots[i], slots[j])) return fail('تتداخل فترات اليوم، بما فيها الفترات المحفوظة غير النشطة.', 'period_overlap');
  return slots;
}
export function parseWeekRequest(raw: unknown, apply = false): WeekRequest {
  if (!object(raw) || !keys(raw, ['school_id', 'academic_year_id', 'expected_revision', 'mode', 'source_day_of_week', 'targets', 'template',
    ...(apply ? ['confirm_apply', 'preview_digest', 'acknowledge_availability_impact'] : [])])) return fail();
  if ((raw.school_id !== undefined && !integer(raw.school_id)) || !integer(raw.academic_year_id)
    || !integer(raw.expected_revision, 0) || (raw.mode !== 'fill_empty_days' && raw.mode !== 'update_matching_keep_extra')
    || (raw.source_day_of_week !== null && !integer(raw.source_day_of_week, 0, 6))) return fail();
  if (!Array.isArray(raw.targets) || !raw.targets.length || raw.targets.length > 7) return fail('اختر يومًا واحدًا على الأقل.', 'invalid_target_days');
  const targets = raw.targets.map(t => {
    if (!object(t) || !keys(t, ['day_of_week', 'activate_day']) || !integer(t.day_of_week, 0, 6) || typeof t.activate_day !== 'boolean') return fail();
    if (t.day_of_week === raw.source_day_of_week) return fail('لا يمكن اختيار يوم المصدر كوجهة للنسخ.', 'source_is_target');
    return {day_of_week: t.day_of_week, activate_day: t.activate_day};
  }).sort((a, b) => a.day_of_week - b.day_of_week);
  if (new Set(targets.map(t => t.day_of_week)).size !== targets.length) return fail('لا تكرر الأيام المستهدفة.', 'duplicate_target_day');
  if (apply && (raw.confirm_apply !== true || typeof raw.preview_digest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.preview_digest)
    || (raw.acknowledge_availability_impact !== undefined && typeof raw.acknowledge_availability_impact !== 'boolean'))) return fail('يلزم تأكيد معاينة صحيحة.', 'confirmation_required');
  return { ...(raw.school_id === undefined ? {} : {school_id: raw.school_id as number}), academic_year_id: raw.academic_year_id,
    expected_revision: raw.expected_revision, mode: raw.mode as WeekMode, source_day_of_week: raw.source_day_of_week as number | null,
    targets, template: validateWeekTemplate(raw.template), ...(apply ? {confirm_apply: true, preview_digest: raw.preview_digest as string,
      acknowledge_availability_impact: raw.acknowledge_availability_impact === true} : {}) };
}
export interface DayGenerator { start_time: string; lesson_count: number; lesson_minutes: number; desired_end_time?: string;
  breaks: Array<{ after_lesson: number; minutes: number; label?: string }> }
export function generateWeekTemplate(input: DayGenerator): WeekPeriod[] {
  if (!integer(input.lesson_count, 1, 30) || !integer(input.lesson_minutes) || !Array.isArray(input.breaks)
    || input.lesson_count + input.breaks.length > MAX_WEEK_PERIODS) return fail('عدد الحصص ومددها أعداد صحيحة موجبة ضمن حد 30 فترة.');
  if (input.desired_end_time) minuteOfDay(input.desired_end_time);
  const positions = new Set<number>();
  for (const rule of input.breaks) {
    if (!integer(rule.after_lesson, 1, input.lesson_count - 1) || !integer(rule.minutes) || positions.has(rule.after_lesson))
      return fail('ضع الاستراحة بين حصتين دون تكرار موضعها.', 'invalid_break_rule');
    positions.add(rule.after_lesson);
  }
  const periods: WeekPeriod[] = []; let cursor = minuteOfDay(input.start_time); let breaks = 0;
  const add = (type: 'lesson' | 'break', number: number | null, duration: number, label: string) => {
    const end = cursor + duration;
    periods.push({slot_index: periods.length + 1, slot_type: type, lesson_number: number, label,
      start_time: bellTime(cursor), end_time: bellTime(end), is_active: 1}); cursor = end;
  };
  for (let lesson = 1; lesson <= input.lesson_count; lesson++) {
    add('lesson', lesson, input.lesson_minutes, `الحصة ${lesson}`);
    const rule = input.breaks.find(b => b.after_lesson === lesson);
    if (rule) { breaks++; add('break', null, rule.minutes, rule.label?.trim() || `استراحة ${breaks}`); }
  }
  return validateWeekTemplate(periods);
}
export function recalculateWeekTimes(periods: WeekPeriod[], start: string): WeekPeriod[] {
  let cursor = minuteOfDay(start);
  return validateWeekTemplate([...periods].sort((a, b) => a.slot_index - b.slot_index).map(p => {
    const duration = minuteOfDay(p.end_time) - minuteOfDay(p.start_time);
    if (duration <= 0) return fail('صحح مدد الفترات قبل إعادة الحساب.');
    const next = {...p, start_time: bellTime(cursor), end_time: bellTime(cursor + duration)}; cursor += duration; return next;
  }));
}
export function summarizeWeekDay(dayOfWeek: number, periods: WeekPeriod[], active = false, orderIndex = dayOfWeek) {
  const duration = (p: WeekPeriod) => minuteOfDay(p.end_time) - minuteOfDay(p.start_time);
  const start = periods.length ? [...periods].sort((a, b) => a.start_time.localeCompare(b.start_time))[0].start_time : null;
  const end = periods.length ? [...periods].sort((a, b) => b.end_time.localeCompare(a.end_time))[0].end_time : null;
  return {day_of_week: dayOfWeek, order_index: orderIndex, is_active: active, saved_periods: periods.length,
    empty: periods.length === 0, lessons: periods.filter(p => p.is_active === 1 && p.slot_type === 'lesson').length,
    breaks: periods.filter(p => p.is_active === 1 && p.slot_type === 'break').length, inactive: periods.filter(p => p.is_active === 0).length,
    first_start: start, last_end: end, teaching_minutes: periods.filter(p => p.slot_type === 'lesson').reduce((s, p) => s + duration(p), 0),
    break_minutes: periods.filter(p => p.slot_type === 'break').reduce((s, p) => s + duration(p), 0),
    elapsed_minutes: start && end ? minuteOfDay(end) - minuteOfDay(start) : 0};
}
export function weekReferences(c: WeekContext): WeekReferences[] {
  return c.slots.map(slot => ({slot_id: slot.id, scheduled_entries: c.entries.filter(e => e.slot_id === slot.id).length,
    locked_entries: c.entries.filter(e => e.slot_id === slot.id && e.is_locked === 1).length,
    availability_overrides: c.availability.filter(a => a.slot_id === slot.id).length,
    historical_references: c.history.find(h => h.slot_id === slot.id)?.count ?? 0}));
}
export function publicWeekSnapshot(c: WeekContext): WeekSnapshot {
  return {school_id: c.school_id, academic_year_id: c.academic_year_id, revision: c.revision, days: c.days, periods: c.slots, references: weekReferences(c),
    summary: Array.from({length: 7}, (_, i) => summarizeWeekDay(i, c.slots.filter(s => s.day_of_week === i), c.days.some(d => d.day_of_week === i && d.is_active === 1), c.days.find(d => d.day_of_week === i)?.order_index ?? i)).sort((a, b) => a.order_index - b.order_index || a.day_of_week - b.day_of_week)};
}
const overlap = (a: WeekPeriod, b: WeekPeriod) => a.start_time < b.end_time && b.start_time < a.end_time;
const equal = (a: WeekPeriod, b: WeekPeriod) => periodKeys.every(k => a[k as keyof WeekPeriod] === b[k as keyof WeekPeriod]);

// Only rows with no old-interval dependencies share a layer. Their final
// intervals are already disjoint. SQL row visitation order is never relied on.
export function orderWeekUpdates(changes: WeekChange[], oldSlots: TimetableSlot[]): number[][] {
  const pending = changes.filter(c => c.action === 'update'); const layers: number[][] = []; const done = new Set<number>();
  while (done.size < pending.length) {
    const ready = pending.filter(c => !done.has(c.id!) && !oldSlots.some(old => old.day_of_week === c.day_of_week && old.id !== c.id
      && overlap(c.after, old) && pending.some(other => other.id === old.id) && !done.has(old.id)));
    if (!ready.length || layers.length >= MAX_WEEK_UPDATE_LAYERS) return fail('يتطلب تغيير الأوقات ترتيبًا دائريًا أو معقدًا غير مدعوم. استخدم تخصيص اليوم.', 'unsupported_update_order');
    layers.push(ready.map(c => c.id!).sort((a, b) => a - b)); ready.forEach(c => done.add(c.id!));
  }
  return layers;
}
function scheduleEvidence(c: WeekContext) {
  const evidence = new Map<string, {notice: WeekNotice; severity: number}>();
  for (const entry of c.entries) {
    const metrics: Record<string, number> = {};
    const evaluation = evaluateTimetableEntryPlacement({candidate: entry, ...c, teacherAvailability: c.availability, teacherConstraints: c.constraints,
      onConstraintMetric: (code, count) => { metrics[code] = count; }});
    // addsWorkingDay belongs to hypothetical single-entry placement. A week
    // projection must compare actual occupied days, once per teacher, below.
    for (const n of evaluation.hard_conflicts) if (n.code !== 'teacher_max_working_days')
      evidence.set(`entry:${entry.id}:${n.code}`, {notice: {...n, entry_id: entry.id}, severity: metrics[n.code] ?? 1});
  }
  const activeSlots = activeTimetableLessonSlots(c.days, c.slots);
  for (const constraint of c.constraints) {
    const teacherLoads = c.loads.filter(l => l.employee_id === constraint.employee_id);
    const demand = teacherLoads.filter(l => l.status === 'active').reduce((n, l) => n + l.weekly_periods, 0);
    const summary = calculateTeacherAvailabilitySummary({schoolId: c.school_id, academicYearId: c.academic_year_id, employeeId: constraint.employee_id,
      employeeName: '', assignedWeeklyPeriods: demand, days: c.days, slots: c.slots, overrides: c.availability, constraints: constraint});
    const shortage = Math.max(0, summary.assigned_weekly_periods - summary.hard_weekly_capacity);
    if (shortage > 0 && summary.blockers[0]) {
      // Diagnostic wording may change as capacity improves; constraint identity
      // and numerical severity must not. Demand is never reduced to fit capacity.
      evidence.set(`teacher:${constraint.employee_id}:capacity_deficit`, {severity: shortage, notice: {
        ...summary.blockers[0], employee_id: constraint.employee_id,
        message: `${summary.blockers[0].message} العجز المتبقي: ${shortage} حصة.`,
        evidence: {dimension: 'capacity_deficit', actual: summary.assigned_weekly_periods, limit: summary.hard_weekly_capacity, excess: shortage},
      }});
    }
    if (constraint.max_working_days != null) {
      const loadIds = new Set(teacherLoads.map(l => l.id));
      const workingDays = occupiedTimetableDays(c.entries.filter(e => loadIds.has(e.teaching_load_id)), activeSlots).size;
      const excess = Math.max(0, workingDays - constraint.max_working_days);
      if (excess > 0) evidence.set(`teacher:${constraint.employee_id}:working_days`, {severity: excess, notice: {
        code: 'teacher_max_working_days', employee_id: constraint.employee_id,
        message: `أيام عمل المدرس المشغولة فعليًا: ${workingDays}؛ الحد الأقصى: ${constraint.max_working_days}.`,
        evidence: {dimension: 'working_days', actual: workingDays, limit: constraint.max_working_days, excess},
      }});
    }
  }
  return evidence;
}
export async function planWeekSetup(context: WeekContext, input: WeekRequest): Promise<WeekPlan> {
  if (context.revision !== input.expected_revision) throw staleWeek();
  if (input.source_day_of_week !== null && !context.slots.some(s => s.day_of_week === input.source_day_of_week))
    throw new WeekSetupError('missing_or_not_in_scope', 'يوم المصدر غير متاح ضمن المدرسة والسنة المحددتين.', 404);
  const refs = weekReferences(context); let projectedId = -1;
  const projected: WeekContext = {...context, days: context.days.map(d => ({...d})), slots: context.slots.map(s => ({...s}))};
  let needsAck = false;
  const plans = input.targets.map((target): WeekDayPlan => {
    const day = context.days.find(d => d.day_of_week === target.day_of_week);
    const slots = context.slots.filter(s => s.day_of_week === target.day_of_week);
    const before = summarizeWeekDay(target.day_of_week, slots, day?.is_active === 1, day?.order_index ?? target.day_of_week);
    const p: WeekDayPlan = {day_of_week: target.day_of_week, action: 'configure', activate_day: false, changes: [], before, after: before,
      impact: {scheduled_entries: 0, locked_entries: 0, availability_overrides: 0, historical_references: 0}, warnings: [], blockers: []};
    if (input.mode === 'fill_empty_days' && slots.length) {
      p.action = 'skipped_existing'; p.warnings.push({code: 'skipped_existing', message: 'تم تخطي اليوم لوجود فترات محفوظة، بما فيها غير النشطة؛ لن تتغير حالته.'});
      p.changes = slots.map(s => ({day_of_week: target.day_of_week, id: s.id, before: periodValues(s), after: periodValues(s), action: 'retained'})); return p;
    }
    if (day?.is_active !== 1 && !target.activate_day) p.blockers.push({code: 'activation_required', message: 'اختر تفعيل هذا اليوم ضمن الحفظ بشكل صريح.'});
    p.activate_day = day?.is_active !== 1 && target.activate_day;
    const matched = new Set<number>();
    for (const template of input.template) {
      const old = slots.find(s => s.slot_index === template.slot_index);
      const change: WeekChange = {day_of_week: target.day_of_week, id: old?.id ?? null, before: old ? periodValues(old) : null,
        after: {...template}, action: old ? equal(old, template) ? 'unchanged' : 'update' : 'create'};
      p.changes.push(change);
      if (old) {
        matched.add(old.id);
        if (old.slot_type !== template.slot_type || old.lesson_number !== template.lesson_number)
          p.blockers.push({code: 'incompatible_period_identity', message: 'نوع أو رقم الفترة المتطابقة مختلف. استخدم تخصيص اليوم دون نقل هوية الفترة.'});
        if (old.is_active !== template.is_active) p.blockers.push({code: 'explicit_period_activation_required', message: 'تغيير حالة فترة محفوظة يتم من التحكم الفردي الصريح في تخصيص اليوم.'});
        const ref = refs.find(r => r.slot_id === old.id)!;
        if (change.action === 'update') {
          const timing = old.start_time !== template.start_time || old.end_time !== template.end_time;
          if (ref.scheduled_entries && (timing || old.slot_type !== template.slot_type || old.lesson_number !== template.lesson_number))
            p.blockers.push({code: 'slot_has_scheduled_entries', message: 'توجد حصص مجدولة مرتبطة بالفترة؛ لا يمكن تغيير أوقاتها أو هويتها. تبقى الحصص والأقفال دون تعديل.'});
          if (ref.availability_overrides && timing) {
            needsAck = true; p.warnings.push({code: 'availability_time_change', message: `ستبقى إعدادات التوفر (${ref.availability_overrides}) مرتبطة بمعرف الفترة نفسه بعد تعديل الوقت؛ يلزم الإقرار.`});
          }
          if (ref.historical_references && timing) p.warnings.push({code: 'history_kept', message: 'تبقى مراجع النسخ المحفوظة كما هي؛ استعادة مواقع نسخة لا تستعيد أوقات الجرس القديمة.'});
        }
        Object.assign(projected.slots.find(s => s.id === old.id)!, template);
      } else projected.slots.push({...template, id: projectedId--, school_id: context.school_id, academic_year_id: context.academic_year_id, day_of_week: target.day_of_week, created_at: 0, updated_at: 0});
    }
    for (const old of slots.filter(s => !matched.has(s.id))) p.changes.push({day_of_week: target.day_of_week, id: old.id, before: periodValues(old), after: periodValues(old), action: 'retained'});
    // A changed break or activated day can affect lessons in other periods.
    // Count all existing links on such a day, not just links on the edited row.
    const affectsDay = p.activate_day || p.changes.some(c => c.action === 'create' || (c.action === 'update'
      && (c.before?.start_time !== c.after.start_time || c.before?.end_time !== c.after.end_time)));
    for (const old of slots.filter(s => affectsDay || p.changes.some(c => c.id === s.id && c.action === 'update'))) {
      const ref = refs.find(r => r.slot_id === old.id)!;
      for (const key of Object.keys(p.impact) as Array<keyof typeof p.impact>) p.impact[key] += ref[key];
    }
    try { validateWeekTemplate(p.changes.map(c => c.after)); }
    catch (error) { if (!(error instanceof WeekSetupError)) throw error; p.blockers.push({code: error.code, message: error.message}); }
    if (p.activate_day) {
      if (day) projected.days.find(d => d.id === day.id)!.is_active = 1;
      else projected.days.push({id: projectedId--, school_id: context.school_id, academic_year_id: context.academic_year_id, day_of_week: target.day_of_week, is_active: 1, order_index: target.day_of_week, created_at: 0, updated_at: 0});
    }
    p.after = summarizeWeekDay(target.day_of_week, p.changes.map(c => c.after), day?.is_active === 1 || p.activate_day, before.order_index);
    if (p.blockers.length) p.action = 'blocked';
    return p;
  });
  const blockers: WeekNotice[] = []; const warnings: WeekNotice[] = [];
  const beforeEvidence = scheduleEvidence(context), afterEvidence = scheduleEvidence(projected);
  for (const [key, issue] of afterEvidence) {
    if (!beforeEvidence.has(key) || issue.severity > beforeEvidence.get(key)!.severity)
      blockers.push({...issue.notice, message: `الإعداد المقترح ينشئ أو يزيد مخالفة: ${issue.notice.message}`});
    else warnings.push({...issue.notice, code: `existing_${issue.notice.code}`, message: `ملاحظة إصلاح متبقية بعد الإعداد: ${issue.notice.message}`});
  }
  const changes = plans.filter(p => p.action === 'configure').flatMap(p => p.changes);
  let layers: number[][] = [];
  try { layers = orderWeekUpdates(changes, context.slots); }
  catch (error) { if (!(error instanceof WeekSetupError)) throw error; blockers.push({code: error.code, message: error.message}); }
  const counts = {create: 0, update: 0, unchanged: 0, retained: 0, skipped: 0, blocked: 0, activated: 0};
  for (const p of plans) {
    if (p.action === 'skipped_existing') { counts.skipped++; continue; }
    if (p.action === 'blocked') { counts.blocked++; continue; }
    for (const c of p.changes) counts[c.action]++;
    if (p.activate_day) counts.activated++;
  }
  const noChange = counts.create + counts.update + counts.activated === 0;
  const plan: WeekPlan = {can_apply: !blockers.length && !counts.blocked, revision: context.revision, preview_digest: '', days: plans, counts,
    warnings, blockers, requires_availability_acknowledgement: needsAck, update_layers: layers,
    write_statement_count: noChange ? 0 : 3 + layers.length + Number(counts.create > 0) + Number(counts.activated > 0), no_change: noChange};
  const {confirm_apply: _confirm, preview_digest: _digest, acknowledge_availability_impact: _ack, ...request} = input;
  const bytes = new TextEncoder().encode(canonicalWeekJSON({school_id: context.school_id, request, plan}));
  plan.preview_digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  return plan;
}
export function canonicalWeekJSON(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : object(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize(v[k])])) : v;
  return JSON.stringify(normalize(value));
}
