import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, ArrowLeftRight, CalendarRange, GripVertical, Lock, Plus, Trash2, Unlock, X } from 'lucide-react';
import {
  createTimetableEntry,
  deleteTimetableEntry,
  dropTimetableEntry,
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
  const onlyTeacherCollisions = conflicts.every((conflict) => conflict.code === 'teacher_collision');
  return (
    <div className={`mt-2 rounded-md border p-2 text-xs ${onlyTeacherCollisions
      ? 'border-rose-300 bg-rose-200/70 text-rose-950'
      : 'border-red-200 bg-red-100/70 text-red-900'}`} title={conflicts.map((conflict) => conflict.message).join(' • ')}>
      <p className="flex items-center gap-1 font-bold"><AlertTriangle size={13} />{onlyTeacherCollisions ? 'تعارض المدرّس' : 'تعارض صلب'}</p>
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
  const [operationConflicts, setOperationConflicts] = useState<TimetableEntryNotice[]>([]);
  const [draggedEntryId, setDraggedEntryId] = useState<number | null>(null);
  const [dragOverSlotId, setDragOverSlotId] = useState<number | null>(null);
  const [dropAnnouncement, setDropAnnouncement] = useState('');
  const draggedEntryRef = useRef<TimetableGridEntry | null>(null);
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
    setOperationConflicts([]);
    draggedEntryRef.current = null;
    setDraggedEntryId(null);
    setDragOverSlotId(null);
    setDropAnnouncement('');
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
    setOperationConflicts([]);
    draggedEntryRef.current = null;
    setDraggedEntryId(null);
    setDragOverSlotId(null);
    setDropAnnouncement('');
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
    setOperationConflicts([]);
    draggedEntryRef.current = null;
    setDraggedEntryId(null);
    setDragOverSlotId(null);
    setDropAnnouncement('');
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
    setOperationConflicts([]);
    draggedEntryRef.current = null;
    setDraggedEntryId(null);
    setDragOverSlotId(null);
    setDropAnnouncement('');
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
    conflicts: TimetableEntryNotice[] = [],
  ) {
    if (!mutationScopeIsCurrent(expectedScope, expectedGeneration)) return;
    setWarnings(notices);
    setOperationConflicts(conflicts);
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

  async function performEntryDrop(
    entry: TimetableGridEntry,
    targetSlotId: number,
    targetEntry: TimetableGridEntry | null,
  ) {
    if (!grid || saving || Number(entry.slot_id) === Number(targetSlotId)) return;
    if (entry.is_locked === 1) {
      setError('الحصة مثبتة. فك تثبيتها أولًا ثم أعد النقل.');
      setDropAnnouncement(`تعذر نقل حصة ${entry.subject_name} لأنها مثبتة.`);
      return;
    }
    if (targetEntry?.is_locked === 1) {
      setError('الحصة الموجودة في الموقع الهدف مثبتة. فك تثبيتها أولًا ثم أعد النقل.');
      setDropAnnouncement(`تعذر نقل حصة ${entry.subject_name} لأن الموقع الهدف مثبت.`);
      return;
    }
    const expectedScope = currentScopeRef.current;
    const expectedGeneration = requestGenerationRef.current;
    const expectedRevision = grid.revision;
    setSaving(true);
    setError('');
    setWarnings([]);
    setOperationConflicts([]);
    const response = await dropTimetableEntry(entry.id, {
      school_id: schoolId,
      academic_year_id: academicYearId,
      source_slot_id: entry.slot_id,
      target_slot_id: targetSlotId,
      target_entry_id: targetEntry?.id ?? null,
      expected_revision: expectedRevision,
    });
    if (!mutationScopeIsCurrent(expectedScope, expectedGeneration)) return;
    setSaving(false);
    if (response.error) {
      if (response.code === 'stale_timetable_drop') {
        await Promise.all([loadGrid(), onChanged()]);
        if (currentScopeRef.current !== expectedScope) return;
      }
      setError(response.error);
      setDropAnnouncement(`تعذر نقل حصة ${entry.subject_name}. لم يتغير الجدول.`);
      return;
    }
    setMoveDialog(null);
    const teacherCollision = response.meta?.conflicts?.some((notice) => notice.code === 'teacher_collision') === true;
    const successAnnouncement = response.data?.operation === 'swap'
      ? `تم تبديل حصة ${entry.subject_name} مع حصة ${targetEntry?.subject_name || 'أخرى'}.`
      : `تم نقل حصة ${entry.subject_name} إلى ${slotLabel(grid.slots.find((slot) => Number(slot.id) === Number(targetSlotId))!)}.`;
    setDropAnnouncement(teacherCollision
      ? `${successAnnouncement} يوجد تعارض للمدرّس في هذه الفترة.`
      : successAnnouncement);
    await refreshAfterMutation(
      expectedScope,
      expectedGeneration,
      response.meta?.warnings || [],
      response.meta?.conflicts || [],
    );
  }

  async function moveEntry(slotId: number) {
    if (!moveDialog || !grid) return;
    const targetEntries = grid.entries.filter((entry) => (
      Number(entry.slot_id) === Number(slotId) && Number(entry.id) !== Number(moveDialog.entry.id)
    ));
    if (targetEntries.length > 1) {
      setError('توجد عدة حصص في الموقع الهدف. أصلح التعارض قبل النقل.');
      return;
    }
    const targetEntry = targetEntries[0] || null;
    if (moveDialog.entry.is_locked !== 1) {
      await performEntryDrop(moveDialog.entry, slotId, targetEntry);
      return;
    }
    if (targetEntry != null) {
      setError('لا يمكن تبديل حصة مثبتة. فك تثبيتها أولًا ثم أعد النقل.');
      return;
    }
    if (!window.confirm('هذه الحصة مثبتة. هل تريد إلغاء التثبيت ونقلها؟')) return;
    const expectedScope = currentScopeRef.current;
    const expectedGeneration = requestGenerationRef.current;
    setSaving(true);
    setError('');
    const response = await moveTimetableEntry(moveDialog.entry.id, {
      school_id: schoolId,
      academic_year_id: academicYearId,
      slot_id: slotId,
      confirm_unlock_locked_entry: true,
    });
    if (!mutationScopeIsCurrent(expectedScope, expectedGeneration)) return;
    setSaving(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    setMoveDialog(null);
    setDropAnnouncement(`تم إلغاء تثبيت حصة ${moveDialog.entry.subject_name} ونقلها.`);
    await refreshAfterMutation(expectedScope, expectedGeneration, response.meta?.warnings || []);
  }

  function beginEntryDrag(event: DragEvent<HTMLButtonElement>, entry: TimetableGridEntry) {
    if (saving || entry.is_locked === 1) {
      event.preventDefault();
      setError('الحصة مثبتة. فك تثبيتها أولًا ثم ابدأ السحب.');
      return;
    }
    draggedEntryRef.current = entry;
    setDraggedEntryId(entry.id);
    setDragOverSlotId(null);
    setError('');
    setDropAnnouncement(`بدأ سحب حصة ${entry.subject_name}. أفلتها في فترة فارغة للنقل أو فوق حصة أخرى للتبديل.`);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-smart-school-timetable-entry', String(entry.id));
    event.dataTransfer.setData('text/plain', String(entry.id));
  }

  function finishEntryDrag() {
    draggedEntryRef.current = null;
    setDraggedEntryId(null);
    setDragOverSlotId(null);
  }

  function markDropTarget(event: DragEvent<HTMLTableCellElement>, slotId: number) {
    const entry = draggedEntryRef.current;
    if (!entry || saving || Number(entry.slot_id) === Number(slotId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverSlotId(slotId);
  }

  function leaveDropTarget(event: DragEvent<HTMLTableCellElement>, slotId: number) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragOverSlotId((current) => current === slotId ? null : current);
  }

  function dropEntryOnSlot(event: DragEvent<HTMLTableCellElement>, slotId: number) {
    event.preventDefault();
    const entry = draggedEntryRef.current;
    finishEntryDrag();
    if (!entry || saving || Number(entry.slot_id) === Number(slotId) || !grid) return;
    const targetEntries = grid.entries.filter((candidate) => (
      Number(candidate.slot_id) === Number(slotId) && Number(candidate.id) !== Number(entry.id)
    ));
    if (targetEntries.length > 1) {
      setError('توجد عدة حصص في الموقع الهدف. أصلح التعارض قبل التبديل.');
      setDropAnnouncement(`تعذر نقل حصة ${entry.subject_name}. لم يتغير الجدول.`);
      return;
    }
    void performEntryDrop(entry, slotId, targetEntries[0] || null);
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
      {operationConflicts.map((conflict) => (
        <div key={conflict.code} role="alert" className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-100 p-3 text-sm font-bold text-rose-950">
          <AlertTriangle size={18} />تعارض المدرّس: {conflict.message}
        </div>
      ))}
      {warnings.map((warning) => (
        <div key={warning.code} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          <AlertTriangle size={18} />{warning.message}
        </div>
      ))}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{dropAnnouncement}</p>

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
          <div id="timetable-drag-help" className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
            <GripVertical className="mt-0.5 shrink-0" size={19} />
            <div>
              <p className="font-bold">تغيير مكان الحصة بالسحب والإفلات</p>
              <p className="mt-0.5 text-blue-800">اسحب من المقبض إلى خانة فارغة للنقل، أو فوق مادة أخرى لتبديل الحصتين. إذا أصبح للمدرّس درسان في الفترة نفسها يتم النقل وتظهر الحصتان بالوردي المحمر مع تنبيه تعارض. الحصة المثبتة يجب فك تثبيتها أولًا. ويمكن النقر على زر النقل بدل السحب.</p>
            </div>
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
                        const targetIsLocked = entries.some((entry) => entry.is_locked === 1);
                        return (
                          <td
                            key={day.id}
                            data-timetable-drop-slot={slot.id}
                            onDragEnter={(event) => markDropTarget(event, slot.id)}
                            onDragOver={(event) => markDropTarget(event, slot.id)}
                            onDragLeave={(event) => leaveDropTarget(event, slot.id)}
                            onDrop={(event) => dropEntryOnSlot(event, slot.id)}
                            className={`border-r p-2 transition-colors ${dragOverSlotId === slot.id
                              ? targetIsLocked
                                ? 'bg-amber-50 ring-2 ring-inset ring-amber-400'
                                : 'bg-emerald-50 ring-2 ring-inset ring-emerald-400'
                              : ''}`}
                          >
                            <SlotIdentity slot={slot} />
                            {entries.length === 0 ? (
                              <button type="button" disabled={saving} onClick={() => setScheduleDialog({ slotId: slot.id })} className="flex min-h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary-300 text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60">
                                <Plus size={17} />جدولة حصة
                              </button>
                            ) : entries.map((entry) => {
                              const hasTeacherCollision = entry.hard_conflicts.some((conflict) => conflict.code === 'teacher_collision');
                              const hasBlockingHardConflicts = entry.hard_conflicts.some((conflict) => conflict.code !== 'teacher_collision');
                              return (
                                <div
                                  key={entry.id}
                                  data-timetable-entry={entry.id}
                                  data-timetable-teacher-conflict={hasTeacherCollision ? 'true' : 'false'}
                                  className={`mb-2 rounded-lg border p-2 transition-opacity last:mb-0 ${draggedEntryId === entry.id ? 'opacity-45' : ''} ${hasBlockingHardConflicts
                                    ? 'border-red-400 bg-red-50'
                                    : hasTeacherCollision
                                      ? 'border-rose-400 bg-rose-100 ring-1 ring-inset ring-rose-300'
                                      : 'border-primary-200 bg-primary-50'}`}
                                >
                                  <p className={`font-bold ${hasBlockingHardConflicts
                                    ? 'text-red-950'
                                    : hasTeacherCollision ? 'text-rose-950' : 'text-primary-900'}`}>{entry.subject_name}</p>
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
                                  <div className="mt-2 flex flex-wrap items-center gap-1">
                                    <button
                                      type="button"
                                      draggable={entry.is_locked !== 1 && !saving}
                                      data-timetable-drag-entry={entry.id}
                                      onDragStart={(event) => beginEntryDrag(event, entry)}
                                      onDragEnd={finishEntryDrag}
                                      onClick={() => setMoveDialog({ entry })}
                                      aria-label={`سحب أو نقل حصة ${entry.subject_name}`}
                                      aria-describedby="timetable-drag-help"
                                      title={entry.is_locked === 1 ? 'الحصة مثبتة؛ انقر لاختيار موقع أو فك تثبيتها قبل السحب' : 'اسحب لتغيير الموقع أو انقر لعرض قائمة الفترات'}
                                      className={`flex items-center gap-1 rounded px-2 py-1.5 text-xs font-semibold ${entry.is_locked === 1
                                        ? 'cursor-pointer bg-slate-100 text-slate-600'
                                        : 'cursor-grab bg-blue-100 text-blue-800 hover:bg-blue-200 active:cursor-grabbing'}`}
                                    >
                                      <GripVertical size={15} />سحب أو نقل
                                    </button>
                                    <button type="button" onClick={() => void toggleEntryLock(entry)} className="rounded p-1.5 text-slate-700 hover:bg-slate-100" aria-label={entry.is_locked === 1 ? 'إلغاء تثبيت الحصة' : 'تثبيت الحصة'} title={entry.is_locked === 1 ? 'حصة مثبتة' : 'تثبيت الحصة'}>{entry.is_locked === 1 ? <Lock size={15} /> : <Unlock size={15} />}</button>
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
            <p className="mt-1 text-sm text-gray-500">اختر فترة فعالة أخرى. الخانة الفارغة تنقل الحصة، والخانة المشغولة تبدّل الحصتين. سيعيد الخادم فحص جميع التعارضات والقيود.</p>
            <div className="mt-4 grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2">
              {lessonSlots.filter((slot) => Number(slot.id) !== Number(moveDialog.entry.slot_id)).map((slot) => {
                const targetEntry = grid.entries.find((entry) => Number(entry.slot_id) === Number(slot.id)) || null;
                const unavailable = targetEntry?.is_locked === 1 || (moveDialog.entry.is_locked === 1 && targetEntry != null);
                return (
                  <button key={slot.id} type="button" disabled={saving || unavailable} onClick={() => void moveEntry(slot.id)} className="rounded-lg border border-gray-200 p-3 text-right hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60">
                    <span className="block font-semibold">{slotLabel(slot)}</span>
                    <span className={`mt-1 block text-xs ${unavailable ? 'text-amber-700' : 'text-gray-500'}`}>
                      {targetEntry == null
                        ? 'خانة فارغة — نقل'
                        : unavailable
                          ? `حصة ${targetEntry.subject_name} مثبتة أو يتطلب المصدر فك التثبيت أولًا`
                          : `تبديل مع حصة ${targetEntry.subject_name}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
