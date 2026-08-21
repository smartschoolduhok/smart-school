import { useCallback, useEffect, useState } from 'react';
import { Calendar, CheckCircle, Edit3, GraduationCap, Loader2, Plus, X } from 'lucide-react';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import {
  activateAcademicYear,
  createAcademicYear,
  getAcademicYears,
  updateAcademicYear,
} from '../../lib/api';
import type { AcademicYearRecord } from '../../lib/academicYears';

interface Props {
  data: Record<string, any>;
  canEdit: boolean;
  schoolId: number;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

interface AcademicYearForm {
  name: string;
  starts_at: string;
  ends_at: string;
}

const EMPTY_FORM: AcademicYearForm = { name: '', starts_at: '', ends_at: '' };

function formatAcademicDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default function AcademicTab({ data, canEdit, schoolId, onSuccess, onError }: Props) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYearRecord | null>(null);
  const [form, setForm] = useState<AcademicYearForm>(EMPTY_FORM);

  const loadYears = useCallback(async () => {
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    const response = await getAcademicYears(schoolId);
    if (!isCurrent()) return;
    setLoading(false);
    if (response.error) {
      setYears([]);
      onError(response.error);
      return;
    }
    setYears(response.data || []);
  }, [schoolId]);

  useEffect(() => {
    setYears([]);
    setLoading(true);
    setSaving(false);
    setActivatingId(null);
    setModalOpen(false);
    setEditingYear(null);
    setForm(EMPTY_FORM);
    loadYears();
  }, [schoolId, loadYears]);

  const activeYear = years.find(year => year.is_active === 1) || null;

  const openCreate = () => {
    setEditingYear(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (year: AcademicYearRecord) => {
    setEditingYear(year);
    setForm({ name: year.name, starts_at: year.starts_at, ends_at: year.ends_at });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingYear(null);
    setForm(EMPTY_FORM);
  };

  const saveForm = async (activateAfterCreate: boolean) => {
    if (!canEdit || saving) return;
    if (!editingYear && activateAfterCreate && activeYear && !window.confirm('سيتم إيقاف السنة الدراسية الحالية وتفعيل السنة المحددة.')) return;
    const wasEditing = editingYear != null;
    const isCurrent = captureSchoolRequest();
    setSaving(true);
    const response = editingYear
      ? await updateAcademicYear(editingYear.id, { school_id: schoolId, ...form })
      : await createAcademicYear({ school_id: schoolId, ...form, activate: activateAfterCreate });
    if (!isCurrent()) return;
    setSaving(false);
    if (response.error) {
      onError(response.error);
      return;
    }
    closeModal();
    await loadYears();
    onSuccess(wasEditing ? 'تم تعديل السنة الدراسية بنجاح' : activateAfterCreate ? 'تم إنشاء السنة الدراسية وتفعيلها' : 'تم إنشاء السنة الدراسية');
  };

  const handleActivate = async (year: AcademicYearRecord) => {
    if (!canEdit || year.is_active === 1 || activatingId != null) return;
    if (activeYear && !window.confirm('سيتم إيقاف السنة الدراسية الحالية وتفعيل السنة المحددة.')) return;
    const isCurrent = captureSchoolRequest();
    setActivatingId(year.id);
    const response = await activateAcademicYear(year.id, schoolId);
    if (!isCurrent()) return;
    setActivatingId(null);
    if (response.error) {
      onError(response.error);
      return;
    }
    await loadYears();
    onSuccess('تم تفعيل السنة الدراسية بنجاح');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <GraduationCap size={20} className="text-primary-600" />
          السنة الدراسية
        </h2>
        {canEdit && (
          <button type="button" onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700">
            <Plus size={16} />
            إضافة سنة دراسية
          </button>
        )}
      </div>

      <section className={`rounded-xl border p-5 ${activeYear ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <p className={`mb-2 text-sm font-medium ${activeYear ? 'text-emerald-700' : 'text-amber-700'}`}>السنة الدراسية الفعالة</p>
        {activeYear ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-2xl font-bold text-gray-900">{activeYear.name}</h3>
              <p className="mt-1 flex items-center gap-2 text-sm text-gray-600">
                <Calendar size={16} />
                {formatAcademicDate(activeYear.starts_at)} — {formatAcademicDate(activeYear.ends_at)}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
              <CheckCircle size={15} />
              فعالة
            </span>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-bold text-amber-900">لا توجد سنة دراسية فعالة</h3>
            <p className="mt-1 text-sm text-amber-700">أنشئ سنة دراسية وفعّلها كي تتمكن كارتات النتائج والوحدات المرتبطة من استخدامها.</p>
            {canEdit && <button type="button" onClick={openCreate} className="mt-4 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100">إدارة السنوات الدراسية</button>}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h3 className="font-bold text-gray-900">سجل السنوات الدراسية</h3>
            <p className="mt-0.5 text-xs text-gray-500">{data?.school?.name || 'المدرسة المحددة'}</p>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-gray-500"><Loader2 size={20} className="animate-spin" /> جاري تحميل السنوات الدراسية...</div>
        ) : years.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">لا توجد سنوات دراسية مسجلة</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr><th className="px-4 py-3 text-right">السنة</th><th className="px-4 py-3 text-right">البداية</th><th className="px-4 py-3 text-right">النهاية</th><th className="px-4 py-3 text-right">الحالة</th>{canEdit && <th className="px-4 py-3 text-right">الإجراءات</th>}</tr></thead>
              <tbody>
                {years.map(year => (
                  <tr key={year.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 font-semibold text-gray-900">{year.name}</td>
                    <td className="px-4 py-3 text-gray-600">{formatAcademicDate(year.starts_at)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatAcademicDate(year.ends_at)}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${year.is_active === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{year.is_active === 1 ? 'فعالة' : 'غير فعالة / سابقة'}</span></td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => openEdit(year)} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><Edit3 size={14} /> تعديل</button>
                          {year.is_active !== 1 && (
                            <button type="button" onClick={() => handleActivate(year)} disabled={activatingId != null} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                              {activatingId === year.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} تفعيل
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="academic-year-dialog-title">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 id="academic-year-dialog-title" className="text-lg font-bold text-gray-900">{editingYear ? 'تعديل السنة الدراسية' : 'إضافة سنة دراسية'}</h3>
              <button type="button" onClick={closeModal} disabled={saving} aria-label="إغلاق" className="rounded-md p-1 text-gray-500 hover:bg-gray-100"><X size={20} /></button>
            </div>
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); saveForm(false); }}>
              <div>
                <label htmlFor="academic-year-name" className="mb-1 block text-sm font-medium text-gray-700">اسم السنة الدراسية</label>
                <input id="academic-year-name" value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} required maxLength={100} placeholder="مثال: 2026-2027" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><label htmlFor="academic-year-start" className="mb-1 block text-sm font-medium text-gray-700">تاريخ البداية</label><input id="academic-year-start" type="date" dir="ltr" value={form.starts_at} onChange={event => setForm(previous => ({ ...previous, starts_at: event.target.value }))} required className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" /></div>
                <div><label htmlFor="academic-year-end" className="mb-1 block text-sm font-medium text-gray-700">تاريخ النهاية</label><input id="academic-year-end" type="date" dir="ltr" value={form.ends_at} onChange={event => setForm(previous => ({ ...previous, ends_at: event.target.value }))} required className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" /></div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
                <button type="button" onClick={closeModal} disabled={saving} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">إلغاء</button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />}{editingYear ? 'حفظ التعديلات' : 'إنشاء'}</button>
                {!editingYear && <button type="button" onClick={() => saveForm(true)} disabled={saving || !form.name || !form.starts_at || !form.ends_at} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />}إنشاء وتفعيل</button>}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
