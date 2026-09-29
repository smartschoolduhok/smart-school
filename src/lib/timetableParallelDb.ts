import { evaluateTimetableEntryPlacement, isBlockingTimetableEntryConflict, type TimetableDay, type TimetableSlot, type TimetableTeachingLoad, type TimetableEntry, type TimetableTeacherAvailabilityOverride, type TimetableTeacherConstraints } from './timetable.ts';
import { parallelTimetableLoadGroup, validateTimetableParallelLoads } from './timetableParallel.ts';

export interface ParallelContext {
  days: TimetableDay[]; slots: TimetableSlot[]; loads: TimetableTeachingLoad[]; entries: TimetableEntry[];
  availability: TimetableTeacherAvailabilityOverride[]; constraints: TimetableTeacherConstraints[];
}
export class ParallelTimetableError extends Error {
  code:string;
  status:number;
  constructor(code: string, message: string, status = 409) { super(message); this.code=code; this.status=status; }
}
export function parallelEntryGroup(context: ParallelContext, entry: TimetableEntry): TimetableEntry[] {
  const current = context.entries.find(e => e.id === entry.id);
  if (!current) throw new ParallelTimetableError('stale_timetable_proposal','تغيّر الدرس أثناء التعديل. أعد تحميل الجدول.');
  entry = current;
  const load = context.loads.find(l => l.id === entry.teaching_load_id);
  const ids = new Set(load ? parallelTimetableLoadGroup(load, context.loads).map(l => l.id) : [entry.teaching_load_id]);
  return context.entries.filter(e => e.slot_id === entry.slot_id && ids.has(e.teaching_load_id));
}
export function parallelLoads(context: ParallelContext, loadId: number): TimetableTeachingLoad[] {
  const load = context.loads.find(l => l.id === loadId);
  return load ? parallelTimetableLoadGroup(load, context.loads) : [];
}
export function validateParallelEntryProjection(context: ParallelContext, before: TimetableEntry[], after: TimetableEntry[], allowTeacherCollision = false) {
  const removed = new Set(before.map(e => e.id));
  const entries = [...context.entries.filter(e => !removed.has(e.id)), ...after];
  const evaluations = after.map(candidate => evaluateTimetableEntryPlacement({ candidate, ...context, entries,
    teacherAvailability: context.availability, teacherConstraints: context.constraints, validateWholeSchedule: true }));
  const conflict = evaluations.flatMap(e => e.hard_conflicts).find(n => !allowTeacherCollision || isBlockingTimetableEntryConflict(n));
  if (conflict) throw new ParallelTimetableError(conflict.code, conflict.message);
  return { warnings: evaluations.flatMap(e => e.warnings), conflicts: evaluations.flatMap(e => e.hard_conflicts) };
}
export function assertParallelLoads(context: ParallelContext) {
  const issue = validateTimetableParallelLoads(context.loads)[0];
  if (issue) throw new ParallelTimetableError(issue.code, issue.message);
}
export function newParallelEntry(schoolId: number, academicYearId: number, slotId: number, loadId: number, temporaryId: number, userId: number): TimetableEntry {
  return { id: temporaryId, school_id: schoolId, academic_year_id: academicYearId, slot_id: slotId, teaching_load_id: loadId,
    is_locked: 0, created_by_user_id: userId, updated_by_user_id: userId, created_at: 0, updated_at: 0 };
}
// Delete/reinsert preserves IDs and snapshots while avoiding intermediate swap
// collisions. The revision assertion and every member share one D1 transaction.
export function parallelEntryStatements(db: D1Database, school: number, year: number, userId: number, revision: number,
  before: TimetableEntry[], after: TimetableEntry[], extra: D1PreparedStatement[] = [], newLoad?: {temporaryId:number;primaryId:number}) {
  const token = crypto.randomUUID();
  const ids = JSON.stringify(before.map(e => e.id));
  const statements = [db.prepare('INSERT INTO timetable_revision_assertions(token,school_id,academic_year_id,expected_revision) VALUES(?,?,?,?)').bind(token,school,year,revision), ...extra];
  if (before.some(e => e.is_locked === 1)) statements.push(db.prepare(`INSERT INTO timetable_locked_entry_overrides(token,entry_id,school_id,academic_year_id,action)
    SELECT ?1||':'||id,id,school_id,academic_year_id,'delete' FROM timetable_entries
    WHERE school_id=?2 AND academic_year_id=?3 AND is_locked=1 AND id IN(SELECT value FROM json_each(?4))`).bind(token,school,year,ids));
  if (before.length) statements.push(db.prepare(`DELETE FROM timetable_entries WHERE school_id=?1 AND academic_year_id=?2 AND id IN(SELECT value FROM json_each(?3))`).bind(school,year,ids));
  if (after.length) statements.push(db.prepare(`INSERT INTO timetable_entries(id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked,created_by_user_id,updated_by_user_id,created_at,updated_at)
    SELECT CASE WHEN json_extract(value,'$.id')>0 THEN json_extract(value,'$.id') END,?2,?3,json_extract(value,'$.slot_id'),
      CASE WHEN json_extract(value,'$.teaching_load_id')=?5 THEN (SELECT id FROM timetable_teaching_loads WHERE school_id=?2 AND academic_year_id=?3 AND parallel_with_load_id=?6 AND status='active') ELSE json_extract(value,'$.teaching_load_id') END,json_extract(value,'$.is_locked'),
      CASE WHEN json_extract(value,'$.id')>0 THEN json_extract(value,'$.created_by_user_id') ELSE ?4 END,?4,COALESCE(NULLIF(json_extract(value,'$.created_at'),0),unixepoch()),unixepoch()
    FROM json_each(?1) ORDER BY CAST(key AS INTEGER)`).bind(JSON.stringify(after),school,year,userId,newLoad?.temporaryId??null,newLoad?.primaryId??null));
  statements.push(db.prepare('DELETE FROM timetable_revision_assertions WHERE token=?').bind(token));
  return statements;
}

export function parallelLockStatements(db:D1Database, school:number, year:number, userId:number, revision:number, entries:TimetableEntry[], locked:0|1) {
  const token=crypto.randomUUID(), ids=JSON.stringify(entries.map(e=>e.id));
  const statements=[db.prepare('INSERT INTO timetable_revision_assertions(token,school_id,academic_year_id,expected_revision) VALUES(?,?,?,?)').bind(token,school,year,revision)];
  if(locked===0)statements.push(db.prepare(`INSERT INTO timetable_locked_entry_overrides(token,entry_id,school_id,academic_year_id,action)
    SELECT ?1||':'||id,id,school_id,academic_year_id,'unlock' FROM timetable_entries WHERE school_id=?2 AND academic_year_id=?3 AND is_locked=1 AND id IN(SELECT value FROM json_each(?4))`).bind(token,school,year,ids));
  statements.push(db.prepare(`UPDATE timetable_entries SET is_locked=?1,updated_by_user_id=?2,updated_at=unixepoch()
    WHERE school_id=?3 AND academic_year_id=?4 AND id IN(SELECT value FROM json_each(?5))`).bind(locked,userId,school,year,ids));
  statements.push(db.prepare('DELETE FROM timetable_locked_entry_overrides WHERE token LIKE ?').bind(token+':%'));
  statements.push(db.prepare('DELETE FROM timetable_revision_assertions WHERE token=?').bind(token));
  return statements;
}

export type ParallelExclusionSnapshot = Pick<ParallelContext,'days'|'slots'|'entries'|'loads'|'availability'>;
// Caller supplies its transaction's revision assertion and subsequent status
// update. This archive/remove phase never changes the surviving subject.
export function parallelExclusionArchiveStatements(db:D1Database,scope:{school_id:number;academic_year_id:number},userId:number,snapshot:ParallelExclusionSnapshot,expectedRevision:number):D1PreparedStatement[] {
  const {school_id:school,academic_year_id:year}=scope,entries=snapshot.entries;
  const statements:D1PreparedStatement[]=[],token=crypto.randomUUID();
  if(entries.length){
    statements.push(db.prepare(`INSERT INTO timetable_week_archives(archive_key,school_id,academic_year_id,source_revision,created_by_user_id,snapshot_json) VALUES(?,?,?,?,?,?)`).bind(token,school,year,expectedRevision,userId,JSON.stringify(snapshot)));
    const entryIds=JSON.stringify(entries.map(e=>e.id));
    if(entries.some(e=>e.is_locked===1))statements.push(db.prepare(`INSERT INTO timetable_locked_entry_overrides(token,entry_id,school_id,academic_year_id,action)
      SELECT ?1||':'||id,id,school_id,academic_year_id,'delete' FROM timetable_entries WHERE school_id=?2 AND academic_year_id=?3 AND is_locked=1 AND id IN(SELECT value FROM json_each(?4))`).bind(token,school,year,entryIds));
    statements.push(db.prepare('DELETE FROM timetable_entries WHERE school_id=?1 AND academic_year_id=?2 AND id IN(SELECT value FROM json_each(?3))').bind(school,year,entryIds));
  }
  return statements;
}
export function parallelLoadDeactivationStatements(db:D1Database,input:{context:ParallelContext;schoolId:number;academicYearId:number;userId:number;revision:number;loadIds:number[]}) {
  const {context,schoolId:school,academicYearId:year,userId,revision,loadIds}=input,selected=new Set(loadIds);
  const entries=context.entries.filter(e=>e.school_id===school&&e.academic_year_id===year&&selected.has(e.teaching_load_id));
  const slotIds=new Set(entries.map(e=>e.slot_id)),slots=context.slots.filter(s=>slotIds.has(s.id)),dayNumbers=new Set(slots.map(s=>s.day_of_week));
  const archivedLoadIds=new Set(loadIds.flatMap(id=>parallelLoads(context,id).map(l=>l.id)));
  const snapshot={days:context.days.filter(d=>dayNumbers.has(d.day_of_week)),slots,entries,availability:[],loads:context.loads.filter(l=>archivedLoadIds.has(l.id))};
  const statements=parallelExclusionArchiveStatements(db,{school_id:school,academic_year_id:year},userId,snapshot,revision);
  statements.push(db.prepare(`UPDATE timetable_teaching_loads SET status='inactive',updated_by_user_id=?1,updated_at=unixepoch() WHERE school_id=?2 AND academic_year_id=?3 AND id IN(SELECT value FROM json_each(?4))`).bind(userId,school,year,JSON.stringify(loadIds)));
  return {statements,removedEntries:entries};
}

export function linkedScheduleProjection(context: ParallelContext, changedLoadId: number): { before: TimetableEntry[]; after: TimetableEntry[] } {
  const group = parallelLoads(context, changedLoadId);
  if (group.length !== 2) return { before: [], after: [] };
  const before = context.entries.filter(e => group.some(l => l.id === e.teaching_load_id));
  const primaryEntries = before.filter(e => e.teaching_load_id === group[0].id);
  const companionEntries = before.filter(e => e.teaching_load_id === group[1].id);
  if (primaryEntries.length && companionEntries.length && primaryEntries.length !== companionEntries.length)
    throw new ParallelTimetableError('parallel_schedule_count_mismatch','يختلف عدد الدروس المجدولة للمادتين. سوِّ عدد الدروس قبل ربطهما للحفاظ على كل درس محفوظ.');
  const donor = primaryEntries.length ? primaryEntries : companionEntries;
  if (!donor.length) return { before: [], after: [] };
  const slots = [...new Set(donor.map(e => e.slot_id))].sort((a,b) => a-b);
  let temporary = -1;
  const after = group.flatMap(load => {
    const existing = before.filter(e => e.teaching_load_id === load.id).sort((a,b) => a.slot_id-b.slot_id);
    const used = new Set<number>();
    return slots.map(slotId => {
      const same = existing.find(e => e.slot_id === slotId);
      const source = same || existing.find(e => !used.has(e.id) && !slots.includes(e.slot_id));
      if (source) { used.add(source.id); return { ...source, slot_id: slotId }; }
      return newParallelEntry(load.school_id,load.academic_year_id,slotId,load.id,temporary--,donor[0].created_by_user_id ?? 0);
    });
  });
  if (before.some(old => old.is_locked === 1 && !after.some(next => next.id === old.id && next.slot_id === old.slot_id)))
    throw new ParallelTimetableError('locked_entry_requires_confirmation','ألغِ تثبيت الدروس التي ستتغير مواقعها قبل ربط المادتين.');
  validateParallelEntryProjection(context,before,after);
  return { before, after };
}
