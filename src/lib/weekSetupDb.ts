import { WeekSetupError, staleWeek, MAX_WEEK_BODY_BYTES, type WeekContext, type WeekPlan } from './weekSetup.ts';

// One atomic read-only batch, no lazy initialization. No foreign names leave
// the server. All relation joins and history are scoped to school AND year.
export async function loadWeekSetup(db: D1Database, school: number, year: number): Promise<WeekContext> {
  const scoped = (sql: string) => db.prepare(sql).bind(school, year);
  const results = await db.batch([
    scoped('SELECT id FROM academic_years WHERE school_id = ? AND id = ?'),
    scoped('SELECT * FROM timetable_days WHERE school_id = ? AND academic_year_id = ? ORDER BY order_index, day_of_week'),
    scoped('SELECT * FROM timetable_slots WHERE school_id = ? AND academic_year_id = ? ORDER BY day_of_week, slot_index'),
    scoped(`SELECT load.*, class.status AS class_status, class.school_id AS class_school_id,
      (SELECT COUNT(*) FROM sections s WHERE s.school_id = load.school_id AND s.class_id = load.class_id AND s.status = 'active') AS active_section_count,
      section.status AS section_status, section.school_id AS section_school_id, section.class_id AS section_class_id,
      subject.status AS subject_status, subject.school_id AS subject_school_id, subject.class_id AS subject_class_id, subject.section_id AS subject_section_id,
      employee.status AS employee_status, employee.school_id AS employee_school_id, employee.role AS employee_role
      FROM timetable_teaching_loads load
      LEFT JOIN classes class ON class.id = load.class_id AND class.school_id = load.school_id
      LEFT JOIN sections section ON section.id = load.section_id AND section.school_id = load.school_id
      LEFT JOIN subjects subject ON subject.id = load.subject_id AND subject.school_id = load.school_id
      LEFT JOIN employees employee ON employee.id = load.employee_id AND employee.school_id = load.school_id
      WHERE load.school_id = ? AND load.academic_year_id = ? ORDER BY load.id`),
    scoped('SELECT * FROM timetable_entries WHERE school_id = ? AND academic_year_id = ? ORDER BY id'),
    scoped('SELECT * FROM timetable_teacher_availability WHERE school_id = ? AND academic_year_id = ? ORDER BY id'),
    scoped('SELECT * FROM timetable_teacher_constraints WHERE school_id = ? AND academic_year_id = ? ORDER BY id'),
    scoped(`SELECT entry.slot_id, COUNT(*) AS count FROM timetable_schedule_version_entries entry
      JOIN timetable_schedule_versions version ON version.id = entry.version_id AND version.school_id = entry.school_id AND version.academic_year_id = entry.academic_year_id
      WHERE entry.school_id = ? AND entry.academic_year_id = ? GROUP BY entry.slot_id ORDER BY entry.slot_id`),
    scoped('SELECT revision FROM timetable_revisions WHERE school_id = ? AND academic_year_id = ?'),
  ]);
  const rows = <T>(index: number) => (results[index].results ?? []) as T[];
  if (!rows(0).length) throw new WeekSetupError('missing_or_not_in_scope', 'السنة غير متاحة ضمن المدرسة المحددة.', 404);
  return {school_id: school, academic_year_id: year, days: rows(1), slots: rows(2), loads: rows(3), entries: rows(4), availability: rows(5), constraints: rows(6), history: rows(7), revision: rows<{revision: number}>(8)[0]?.revision ?? 0};
}

export function buildWeekApplyStatements(db: D1Database, school: number, year: number, plan: WeekPlan) {
  if (!plan.can_apply || plan.no_change) throw new WeekSetupError('blocked_week_setup', 'لا توجد عملية تغيير قابلة للحفظ.', 409);
  const token = crypto.randomUUID();
  const statements = [db.prepare('INSERT INTO timetable_revision_assertions (token, school_id, academic_year_id, expected_revision) VALUES (?, ?, ?, ?)').bind(token, school, year, plan.revision)];
  const group = (sql: string, data: unknown[]) => db.prepare(sql).bind(JSON.stringify(data), school, year);
  let dayIndex: number | null = null, createsIndex: number | null = null; const updateIndexes: number[] = [];
  const activations = plan.days.filter(d => d.action === 'configure' && d.activate_day).map(d => d.day_of_week);
  if (activations.length) {
    dayIndex = statements.length;
    statements.push(group(`INSERT INTO timetable_days (school_id, academic_year_id, day_of_week, is_active, order_index)
      SELECT ?2, ?3, value, 1, value FROM json_each(?1) WHERE 1
      ON CONFLICT(school_id, academic_year_id, day_of_week) DO UPDATE SET is_active = 1, updated_at = unixepoch()
      WHERE timetable_days.is_active != 1 RETURNING id`, activations));
  }
  const changes = plan.days.filter(d => d.action === 'configure').flatMap(d => d.changes);
  for (const layer of plan.update_layers) {
    updateIndexes.push(statements.length);
    statements.push(group(`UPDATE timetable_slots SET
      label = json_extract(change.value, '$.label'), start_time = json_extract(change.value, '$.start_time'),
      end_time = json_extract(change.value, '$.end_time'), updated_at = unixepoch()
      FROM json_each(?1) AS change
      WHERE timetable_slots.id = json_extract(change.value, '$.id')
        AND school_id = ?2 AND academic_year_id = ?3
        AND day_of_week = json_extract(change.value, '$.day_of_week') RETURNING id`, layer.map(id => {
      const change = changes.find(c => c.id === id && c.action === 'update')!;
      return {id, day_of_week: change.day_of_week, label: change.after.label, start_time: change.after.start_time, end_time: change.after.end_time};
    })));
  }
  const creates = changes.filter(c => c.action === 'create');
  if (creates.length) {
    createsIndex = statements.length;
    statements.push(group(`INSERT INTO timetable_slots
      (school_id, academic_year_id, day_of_week, slot_index, slot_type, lesson_number, label, start_time, end_time, is_active)
      SELECT ?2, ?3, json_extract(value, '$.day_of_week'), json_extract(value, '$.slot_index'), json_extract(value, '$.slot_type'),
        json_extract(value, '$.lesson_number'), json_extract(value, '$.label'), json_extract(value, '$.start_time'),
        json_extract(value, '$.end_time'), json_extract(value, '$.is_active') FROM json_each(?1) ORDER BY CAST(key AS INTEGER) RETURNING id`,
      creates.map(c => ({day_of_week: c.day_of_week, ...c.after}))));
  }
  statements.push(db.prepare('DELETE FROM timetable_revision_assertions WHERE token = ?').bind(token));
  statements.push(db.prepare('SELECT revision FROM timetable_revisions WHERE school_id = ? AND academic_year_id = ?').bind(school, year));
  if (statements.length !== plan.write_statement_count || statements.length > 35) throw new WeekSetupError('week_query_budget', 'يتجاوز هذا التغيير ميزانية الحفظ الآمن؛ خصص أيامًا أقل.', 409);
  return {statements, dayIndex, createsIndex, updateIndexes};
}
export async function readWeekJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new WeekSetupError('invalid_week_setup', 'بيانات إعداد الأسبوع مطلوبة.');
  const decoder = new TextDecoder(); let text = '', size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_WEEK_BODY_BYTES) { await reader.cancel(); throw new WeekSetupError('week_payload_too_large', 'حجم إعداد الأسبوع أكبر من المسموح.', 413); }
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch { throw new WeekSetupError('invalid_week_setup', 'بيانات JSON غير صالحة.'); }
  } finally { reader.releaseLock(); }
}
export function weekDatabaseError(error: unknown): WeekSetupError | null {
  if (error instanceof WeekSetupError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/stale_timetable_proposal/.test(message)) return staleWeek();
  if (/timetable slot has scheduled entries/.test(message)) return new WeekSetupError('slot_has_scheduled_entries', 'توجد حصص مجدولة تمنع تعديل الفترة.', 409);
  if (/timetable|constraint failed/i.test(message)) return new WeekSetupError('week_constraint_conflict', 'تعارض في إعدادات الأسبوع؛ أعد التحميل وراجع تخصيص اليوم.', 409);
  return null;
}
