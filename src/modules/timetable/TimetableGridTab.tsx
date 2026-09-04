import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, CalendarRange, Lock, Plus, Trash2, Unlock, X } from 'lucide-react';
import {
  createTimetableEntry,
  deleteTimetableEntry,
  getTimetableGrid,
  moveTimetableEntry,
  setTimetableEntryLock,
} from '../../lib/api';
import {
  TIMETABLE_DAY_NAMES,
  type TimetableEntryNotice,
  type TimetableGridData,
  type TimetableGridEntry,
  type TimetableSlot,
} from '../../lib/timetable';
import type { Class, Section } from '../../types';

interface TimetableGridTabProps {
  schoolId: number;
  academicYearId: number;
  classes: Class[];
  sections: Section[];
  onChanged: () => Promise<void>;
}

type ScheduleDialog = { slotId: number } | null;
type MoveDialog = { entry: TimetableGridEntry } | null;

function scopeKey(schoolId: number, academicYearId: number, classId: number | null, sectionId: number | null) {
  return `${schoolId}:${academicYearId}:${classId ?? 'none'}:${sectionId ?? 'none'}`;
}

function slotLabel(slot: TimetableSlot) {
  return `${TIMETABLE_DAY_NAMES[slot.day_of_week]} — ${slot.label} (${slot.start_time}–${slot.end_time})`;
}

function SlotIdentity({ slot }: { slot: TimetableSlot }) {
  return (
    <div className="mb-2 text-center">
      <p className="font-semibold text-gray-800">{slot.label}</p>
      <bdi dir="ltr" className="mt-0.5 block text-xs text-gray-500">{slot.start_time}–{slot.end_time}</bdi>
    </div>
  );
}

function HardConflictNotice({ conflicts }: { conflicts: TimetableEntryNotice[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="mt-2 rounded-md border border-red-200 bg-red-100/70 p-2 text-xs text-red-900" title={conflicts.map((conflict) => conflict.message).join(' • ')}>
      <p className="flex items-center gap-1 font-bold"><AlertTriangle size={13} />تعارض صلب</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {conflicts.map((conflict) => <li key={conflict.code}>{conflict.message}</li>)}
      </ul>
    </div>
  );
}

export function TimetableGridTab({
  schoolId,
  academicYearId,
  classes,
  sections,
  onChanged,
}: TimetableGridTabProps) {
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [grid, setGrid] = useState<TimetableGridData | null>(null);
  const [scheduleDialog, setScheduleDialog] = useState<ScheduleDialog>(null);
  const [moveDialog, setMoveDialog] = useState<MoveDialog>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<TimetableEntryNotice[]>([]);
  const requestGenerationRef = useRef(0);
  const currentScopeRef = useRef(scopeKey(schoolId, academicYearId, selectedClassId, selectedSectionId));
  currentScopeRef.current = scopeKey(schoolId, academicYearId, selectedClassId, selectedSectionId);

  const classSections = useMemo(() => sections.filter((section) => (
    selectedClassId != null && Number(section.class_id) === selectedClassId && section.status === 'active'
  )), [sections, selectedClassId]);
  const selectionReady = selectedClassId != null && (classSections.length === 0 || selectedSectionId != null);

  const loadGrid = useCallback(async () => {
    if (!selectionReady || selectedClassId == null) return;
    const expectedScope = scopeKey(schoolId, academicYearId, selectedClassId, selectedSectionId);
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError('');
    const response = await getTimetableGrid(
      schoolId,
      academicYearId,
      selectedClassId,
      selectedSectionId,
    );
    if (requestGeneration !== requestGenerationRef.current || currentScopeRef.current !== expectedScope) return;
    setLoading(false);
    if (response.error) {
      setGrid(null);
      setError(response.error);
      return;
    }
    setGrid(response.data || null);
  }, [academicYearId, schoolId, selectedClassId, selectedSectionId, selectionReady]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setSelectedClassId(null);
    setSelectedSectionId(null);
    setGrid(null);
    setScheduleDialog(null);
    setMoveDialog(null);
    setWarnings([]);
    setError('');
    setLoading(false);
    setSaving(false);
  }, [academicYearId, schoolId]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setGrid(null);
    setScheduleDialog(null);
    setMoveDialog(null);
    setWarnings([]);
    setError('');
    setLoading(false);
    setSaving(false);
    if (selectionReady) void loadGrid();
  }, [loadGrid, selectionReady]);

  function changeClass(value: string) {
    requestGenerationRef.current += 1;
    setSelectedClassId(value ? Number(value) : null);
    setSelectedSectionId(null);
    setGrid(null);
    setScheduleDialog(null);
    setMoveDialog(null);
    setWarnings([]);
    setError('');
    setSaving(false);
  }

  function changeSection(value: string) {
    requestGenerationRef.current += 1;
    setSelectedSectionId(value ? Number(value) : null);
    setGrid(null);
    setScheduleDialog(null);
    setMoveDialog(null);
    setWarnings([]);
    setError('');
    setSaving(false);
  }

  function mutationScopeIsCurrent(expectedScope: string, expectedGeneration: number) {
    return currentScopeRef.current === expectedScope
      && requestGenerationRef.current === expectedGeneration;
  }

  async function refreshAfterMutation(
    expectedScope: string,
    expectedGeneration: number,
    notices: TimetableEntryNotice[] = [],
  ) {
    if (!mutationScopeIsCurrent(expectedScope, expectedGeneration)) return;
    setWarnings(notices);
    await Promise.all([loadGrid(), onChanged()]);
  }

  async function scheduleLoad(teachingLoadId: number) {
    if (!scheduleDialog) return;
    const expectedScope = currentScopeRef.current;
    const expectedGeneration = requestGenerationRef.current;
    setSaving(true);
    setError('');
    const response = await createTimetableEntry({
      school_id: schoolId,
      academic_year_id: academicYearId,
      slot_id: scheduleDialog.slotId,
      teaching_load_id: teachingLoadId,
    });
    if (!mutationScopeIsCurrent(expectedScope, expectedGeneration)) return;
    setSaving(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    setScheduleDialog(null);
    await refreshAfterMutation(expectedScope, expectedGeneration, response.meta?.warnings || []);
  }

  async function moveEntry(slotId: number) {
    if (!moveDialog) return;
    const unlockConfirmed = moveDialog.entry.is_locked !== 1 || window.confirm('هذه الحصة مثبتة. هل تريد إلغاء التثبيت ونقلها؟');
    if (!unlockConfirmed) return;
    const expectedScope = currentScopeRef.current;
    const expectedGeneration = requestGenerationRef.current;
    setSaving(true);
    setError('');
    const response = await moveTimetableEntry(moveDialog.entry.id, {
      school_id: schoolId,
      academic_year_id: academicYearId,
      slot_id: slotId,
      ...(moveDialog.entry.is_locked === 1 ? { confirm_unlock_locked_entry: true as const } : {}),
    });
    if (!mutationScopeIsCurrent(expectedScope, expectedGeneration)) return;
    setSaving(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    setMoveDialog(null);
    await refreshAfterMutation(expectedScope, expectedGeneration, response.meta?.warnings || []);
  }

  async function removeEntry(entry: TimetableGridEntry) {
    const message = entry.is_locked === 1
      ? `هذه الحصة مثبتة. هل تريد إلغاء التثبيت وحذف حصة ${entry.subject_name}؟`
      : `هل تريد حذف حصة ${entry.subject_name} من الجدول؟`;
    if (!window.confirm(message)) return;
    const expectedScope = currentScopeRef.current;
    const expectedGeneration = requestGenerationRef.current;
    setSaving(true);
    setError('');
    const response = await deleteTimetableEntry(entry.id, schoolId, academicYearId, entry.is_locked === 1);
    if (!mutationScopeIsCurrent(expectedScope, expectedGeneration)) return;
    setSaving(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    await refreshAfterMutation(expectedScope, expectedGeneration);
  }

  async function toggleEntryLock(entry: TimetableGridEntry) {
    const expectedScope = currentScopeRef.current;
    const expectedGeneration = requestGenerationRef.current;
    setSaving(true);
    setError('');
    const response = await setTimetableEntryLock(entry.id, {
      school_id: schoolId,
      academic_year_id: academicYearId,
      is_locked: entry.is_locked === 1 ? 0 : 1,
    });
    if (!mutationScopeIsCurrent(expectedScope, expectedGeneration)) return;
    setSaving(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    await refreshAfterMutation(expectedScope, expectedGeneration);
  }

  const orderedDays = useMemo(() => (
    [...(grid?.days || [])].sort((left, right) => left.order_index - right.order_index || left.day_of_week - right.day_of_week)
  ), [grid]);
  const rowIndexes = useMemo(() => (
    [...new Set((grid?.slots || []).map((slot) => slot.slot_index))].sort((left, right) => left - right)
  ), [grid]);
  const lessonSlots = useMemo(() => (grid?.slots || []).filter((slot) => slot.slot_type === 'lesson'), [grid]);
  const schedulableLoads = useMemo(() => (grid?.loads || []).filter((load) => load.status === 'active'), [grid]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-gray-700">
          الصف
          <select value={selectedClassId ?? ''} onChange={(event) => changeClass(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
            <option value="">اختر الصف</option>
            {classes.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-gray-700">
          الشعبة
          <select
            value={selectedSectionId ?? ''}
            onChange={(event) => changeSection(event.target.value)}
            disabled={selectedClassId == null || classSections.length === 0}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 disabled:bg-gray-100"
          >
            <option value="">{classSections.length === 0 ? 'الصف بلا شعب' : 'اختر الشعبة'}</option>
            {classSections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div>}
      {warnings.map((warning) => (
        <div key={warning.code} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          <AlertTriangle size={18} />{warning.message}
        </div>
      ))}

      {!selectionReady && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-500">
          <CalendarRange className="mx-auto mb-3" />اختر الصف والشعبة لعرض الجدول الأسبوعي.
        </div>
      )}
      {loading && <div className="rounded-xl border border-gray-200 p-10 text-center text-gray-500">جارٍ تحميل الجدول الأسبوعي...</div>}
      {!loading && selectionReady && grid && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {grid.loads.map((load) => (
              <div key={load.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="font-semibold text-gray-900">{load.subject_name}</p>
                <p className={`text-xs ${load.employee_id == null ? 'font-semibold text-amber-700' : 'text-gray-500'}`}>{load.employee_name || 'بدون مدرس'}</p>
                <p className="mt-2 text-xs text-gray-600">المطلوب <bdi dir="ltr">{load.weekly_periods}</bdi> · المجدول الصحيح <bdi dir="ltr">{load.scheduled_periods}</bdi> · المتبقي <bdi dir="ltr">{load.remaining_periods}</bdi></p>
                <p className={`mt-1 text-xs ${load.invalid_placements > 0 ? 'font-semibold text-red-700' : 'text-gray-500'}`}>كل المواضع <bdi dir="ltr">{load.total_placements}</bdi> · تحتاج إصلاح <bdi dir="ltr">{load.invalid_placements}</bdi></p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[920px] table-fixed text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-36 p-3 text-right">الفترة</th>
                  {orderedDays.map((day) => <th key={day.id} className="p-3 text-center">{TIMETABLE_DAY_NAMES[day.day_of_week]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rowIndexes.map((rowIndex) => (
                    <tr key={rowIndex} className="border-t align-top">
                      <th className="p-3 text-right font-medium text-gray-700">
                        الفترة <bdi dir="ltr">{rowIndex}</bdi>
                      </th>
                      {orderedDays.map((day) => {
                        const slot = grid.slots.find((item) => item.day_of_week === day.day_of_week && item.slot_index === rowIndex);
                        if (!slot) return <td key={day.id} className="border-r bg-gray-50 p-3 text-center text-gray-400">—</td>;
                        if (slot.slot_type === 'break') return (
                          <td key={day.id} className="border-r bg-slate-100 p-3 text-center text-slate-600">
                            <SlotIdentity slot={slot} />
                            <p className="text-xs font-semibold">استراحة</p>
                          </td>
                        );
                        const entries = grid.entries.filter((entry) => Number(entry.slot_id) === Number(slot.id));
                        return (
                          <td key={day.id} className="border-r p-2">
                            <SlotIdentity slot={slot} />
                            {entries.length === 0 ? (
                              <button type="button" onClick={() => setScheduleDialog({ slotId: slot.id })} className="flex min-h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary-300 text-primary-700 hover:bg-primary-50">
                                <Plus size={17} />جدولة حصة
                              </button>
                            ) : entries.map((entry) => {
                              const hasHardConflicts = entry.hard_conflicts.length > 0;
                              return (
                                <div key={entry.id} className={`mb-2 rounded-lg border p-2 last:mb-0 ${hasHardConflicts ? 'border-red-300 bg-red-50' : 'border-primary-200 bg-primary-50'}`}>
                                  <p className={`font-bold ${hasHardConflicts ? 'text-red-950' : 'text-primary-900'}`}>{entry.subject_name}</p>
                                  <p className={`text-xs ${entry.employee_id == null ? 'font-semibold text-amber-700' : 'text-gray-600'}`}>{entry.employee_name || 'بدون مدرس'}</p>
                                  <HardConflictNotice conflicts={entry.hard_conflicts} />
                                  {entry.warnings.length > 0 && (
                                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800" title={entry.warnings.map((warning) => warning.message).join(' • ')}>
                                      <p className="flex items-center gap-1 font-semibold"><AlertTriangle size={13} />تنبيه تفضيل</p>
                                      <ul className="mt-1 list-inside list-disc space-y-0.5">
                                        {entry.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  <div className="mt-2 flex gap-1">
                                    <button type="button" onClick={() => void toggleEntryLock(entry)} className="rounded p-1.5 text-slate-700 hover:bg-slate-100" aria-label={entry.is_locked === 1 ? 'إلغاء تثبيت الحصة' : 'تثبيت الحصة'} title={entry.is_locked === 1 ? 'حصة مثبتة' : 'تثبيت الحصة'}>{entry.is_locked === 1 ? <Lock size={15} /> : <Unlock size={15} />}</button>
                                    <button type="button" onClick={() => setMoveDialog({ entry })} className="rounded p-1.5 text-blue-700 hover:bg-blue-100" aria-label="نقل الحصة"><ArrowLeftRight size={15} /></button>
                                    <button type="button" onClick={() => void removeEntry(entry)} className="rounded p-1.5 text-red-700 hover:bg-red-100" aria-label="حذف الحصة"><Trash2 size={15} /></button>
                                  </div>
                                </div>
                              );
                            })}
                          </td>
                        );
                      })}
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
          {grid.historical_entries.length > 0 && (
            <section className="rounded-xl border border-red-300 bg-red-50 p-4" aria-label="حصص تحتاج إصلاح">
              <h3 className="flex items-center gap-2 font-bold text-red-950"><AlertTriangle size={19} />حصص تحتاج إصلاح</h3>
              <p className="mt-1 text-sm text-red-800">هذه الحصص محفوظة تاريخيًا لكنها تقع في يوم أو فترة غير فعالة، ولا تُحتسب ضمن الحصص المجدولة الصحيحة.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {grid.historical_entries.map((entry) => (
                  <article key={entry.id} className="rounded-lg border border-red-300 bg-white p-3">
                    <p className="font-bold text-red-950">{entry.subject_name}</p>
                    <p className={`text-xs ${entry.employee_id == null ? 'font-semibold text-amber-700' : 'text-gray-600'}`}>{entry.employee_name || 'بدون مدرس'}</p>
                    {entry.slot ? (
                      <div className="mt-2 text-sm text-gray-700">
                        <p>{TIMETABLE_DAY_NAMES[entry.slot.day_of_week]} — {entry.slot.label}</p>
                        <bdi dir="ltr" className="mt-0.5 block text-xs text-gray-500">{entry.slot.start_time}–{entry.slot.end_time}</bdi>
                      </div>
                    ) : <p className="mt-2 text-sm text-gray-600">الفترة الأصلية غير متاحة</p>}
                    <HardConflictNotice conflicts={entry.hard_conflicts} />
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => void toggleEntryLock(entry)} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200">{entry.is_locked === 1 ? <Lock size={14} /> : <Unlock size={14} />}{entry.is_locked === 1 ? 'إلغاء التثبيت' : 'تثبيت'}</button>
                      <button type="button" onClick={() => setMoveDialog({ entry })} className="flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"><ArrowLeftRight size={14} />نقل إلى فترة فعالة</button>
                      <button type="button" onClick={() => void removeEntry(entry)} className="flex items-center gap-1 rounded-md bg-red-100 px-2 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-200"><Trash2 size={14} />حذف</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {scheduleDialog && grid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="جدولة حصة">
          <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between"><h2 className="font-bold">اختيار نصاب الحصة</h2><button type="button" onClick={() => setScheduleDialog(null)}><X /></button></div>
            <p className="mt-1 text-sm text-gray-500">{slotLabel(grid.slots.find((slot) => slot.id === scheduleDialog.slotId)!)}</p>
            <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
              {schedulableLoads.length === 0 && <p className="p-6 text-center text-gray-500">لا توجد أنصبة فعالة لهذه المجموعة.</p>}
              {schedulableLoads.map((load) => (
                <button key={load.id} type="button" disabled={saving || load.remaining_periods <= 0} onClick={() => void scheduleLoad(load.id)} className="flex w-full items-center justify-between rounded-lg border border-gray-200 p-3 text-right hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <span><span className="block font-semibold">{load.subject_name}</span><span className="text-xs text-gray-500">{load.employee_name || 'بدون مدرس'}</span></span>
                  <span className="text-xs">المتبقي <bdi dir="ltr">{load.remaining_periods}</bdi></span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {moveDialog && grid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="نقل الحصة">
          <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between"><h2 className="font-bold">نقل حصة {moveDialog.entry.subject_name}</h2><button type="button" onClick={() => setMoveDialog(null)}><X /></button></div>
            <p className="mt-1 text-sm text-gray-500">اختر حصة فعالة أخرى. سيعيد الخادم فحص جميع التعارضات والقيود.</p>
            <div className="mt-4 grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2">
              {lessonSlots.filter((slot) => Number(slot.id) !== Number(moveDialog.entry.slot_id)).map((slot) => (
                <button key={slot.id} type="button" disabled={saving} onClick={() => void moveEntry(slot.id)} className="rounded-lg border border-gray-200 p-3 text-right hover:bg-gray-50 disabled:opacity-50">{slotLabel(slot)}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
