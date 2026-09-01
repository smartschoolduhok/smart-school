import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, CalendarRange, Plus, Trash2, X } from 'lucide-react';
import {
  createTimetableEntry,
  deleteTimetableEntry,
  getTimetableGrid,
  moveTimetableEntry,
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
  }

  function changeSection(value: string) {
    requestGenerationRef.current += 1;
    setSelectedSectionId(value ? Number(value) : null);
    setGrid(null);
    setScheduleDialog(null);
    setMoveDialog(null);
    setWarnings([]);
  }

  async function refreshAfterMutation(expectedScope: string, notices: TimetableEntryNotice[] = []) {
    if (currentScopeRef.current !== expectedScope) return;
    setWarnings(notices);
    await Promise.all([loadGrid(), onChanged()]);
  }

  async function scheduleLoad(teachingLoadId: number) {
    if (!scheduleDialog) return;
    const expectedScope = currentScopeRef.current;
    setSaving(true);
    setError('');
    const response = await createTimetableEntry({
      school_id: schoolId,
      academic_year_id: academicYearId,
      slot_id: scheduleDialog.slotId,
      teaching_load_id: teachingLoadId,
    });
    if (currentScopeRef.current !== expectedScope) return;
    setSaving(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    setScheduleDialog(null);
    await refreshAfterMutation(expectedScope, response.meta?.warnings || []);
  }

  async function moveEntry(slotId: number) {
    if (!moveDialog) return;
    const expectedScope = currentScopeRef.current;
    setSaving(true);
    setError('');
    const response = await moveTimetableEntry(moveDialog.entry.id, {
      school_id: schoolId,
      academic_year_id: academicYearId,
      slot_id: slotId,
    });
    if (currentScopeRef.current !== expectedScope) return;
    setSaving(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    setMoveDialog(null);
    await refreshAfterMutation(expectedScope, response.meta?.warnings || []);
  }

  async function removeEntry(entry: TimetableGridEntry) {
    if (!window.confirm(`هل تريد حذف حصة ${entry.subject_name} من الجدول؟`)) return;
    const expectedScope = currentScopeRef.current;
    setSaving(true);
    setError('');
    const response = await deleteTimetableEntry(entry.id, schoolId, academicYearId);
    if (currentScopeRef.current !== expectedScope) return;
    setSaving(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    await refreshAfterMutation(expectedScope);
  }

  const orderedDays = useMemo(() => (
    [...(grid?.days || [])].sort((left, right) => left.order_index - right.order_index || left.day_of_week - right.day_of_week)
  ), [grid]);
  const rowIndexes = useMemo(() => (
    [...new Set((grid?.slots || []).map((slot) => slot.slot_index))].sort((left, right) => left - right)
  ), [grid]);
  const lessonSlots = useMemo(() => (grid?.slots || []).filter((slot) => slot.slot_type === 'lesson'), [grid]);

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
                <p className="mt-2 text-xs text-gray-600">المطلوب <bdi dir="ltr">{load.weekly_periods}</bdi> · المجدول <bdi dir="ltr">{load.scheduled_periods}</bdi> · المتبقي <bdi dir="ltr">{load.remaining_periods}</bdi></p>
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
                {rowIndexes.map((rowIndex) => {
                  const representative = grid.slots.find((slot) => slot.slot_index === rowIndex);
                  return (
                    <tr key={rowIndex} className="border-t align-top">
                      <th className="p-3 text-right font-medium text-gray-700">
                        {representative?.label || `الفترة ${rowIndex}`}
                        {representative && <bdi dir="ltr" className="mt-1 block text-xs font-normal text-gray-500">{representative.start_time}–{representative.end_time}</bdi>}
                      </th>
                      {orderedDays.map((day) => {
                        const slot = grid.slots.find((item) => item.day_of_week === day.day_of_week && item.slot_index === rowIndex);
                        if (!slot) return <td key={day.id} className="border-r bg-gray-50 p-3 text-center text-gray-400">—</td>;
                        if (slot.slot_type === 'break') return <td key={day.id} className="border-r bg-slate-100 p-3 text-center font-semibold text-slate-600">استراحة</td>;
                        const entries = grid.entries.filter((entry) => Number(entry.slot_id) === Number(slot.id));
                        return (
                          <td key={day.id} className="border-r p-2">
                            {entries.length === 0 ? (
                              <button type="button" onClick={() => setScheduleDialog({ slotId: slot.id })} className="flex min-h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary-300 text-primary-700 hover:bg-primary-50">
                                <Plus size={17} />جدولة حصة
                              </button>
                            ) : entries.map((entry) => (
                              <div key={entry.id} className="mb-2 rounded-lg border border-primary-200 bg-primary-50 p-2 last:mb-0">
                                <p className="font-bold text-primary-900">{entry.subject_name}</p>
                                <p className={`text-xs ${entry.employee_id == null ? 'font-semibold text-amber-700' : 'text-gray-600'}`}>{entry.employee_name || 'بدون مدرس'}</p>
                                {entry.warnings.length > 0 && (
                                  <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700" title={entry.warnings.map((warning) => warning.message).join(' • ')}>
                                    <AlertTriangle size={13} />تنبيه تفضيل
                                  </p>
                                )}
                                <div className="mt-2 flex gap-1">
                                  <button type="button" onClick={() => setMoveDialog({ entry })} className="rounded p-1.5 text-blue-700 hover:bg-blue-100" aria-label="نقل الحصة"><ArrowLeftRight size={15} /></button>
                                  <button type="button" onClick={() => void removeEntry(entry)} className="rounded p-1.5 text-red-700 hover:bg-red-100" aria-label="حذف الحصة"><Trash2 size={15} /></button>
                                </div>
                              </div>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {scheduleDialog && grid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="جدولة حصة">
          <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between"><h2 className="font-bold">اختيار نصاب الحصة</h2><button type="button" onClick={() => setScheduleDialog(null)}><X /></button></div>
            <p className="mt-1 text-sm text-gray-500">{slotLabel(grid.slots.find((slot) => slot.id === scheduleDialog.slotId)!)}</p>
            <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
              {grid.loads.length === 0 && <p className="p-6 text-center text-gray-500">لا توجد أنصبة فعالة لهذه المجموعة.</p>}
              {grid.loads.map((load) => (
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
