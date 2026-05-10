import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getClasses, getSections, createClass, updateClass, archiveClass, createSection, updateSection, archiveSection } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { Search, Plus, Filter, Archive, Edit2, X, Check, Layers, Users, BookOpen, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

interface ClassRecord {
  id: number;
  school_id: number;
  name: string;
  stage: string;
  order_index: number;
  status: 'active' | 'inactive' | 'archived';
  created_at: string;
  updated_at: string;
  sections_count?: number;
  students_count?: number;
}

interface SectionRecord {
  id: number;
  school_id: number;
  class_id: number;
  name: string;
  capacity: number;
  status: 'active' | 'inactive' | 'archived';
  created_at: string;
  updated_at: string;
  class_name?: string;
  students_count?: number;
}

const STAGES = ['رياض', 'ابتدائي', 'متوسط', 'إعدادي', 'ثانوي', 'جامعي'];

const emptyClassForm = { name: '', stage: 'ابتدائي' as string, order_index: 0 };
const emptySectionForm = { class_id: '' as string | number, name: '', capacity: 30 };

export default function ClassesPage() {
  const { user } = useAuth();
  const schoolId = user?.school_id;
  const canManage = user?.role_key === 'system_admin' || user?.role_key === 'principal' || user?.role_key === 'registrar';

  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [expandedClass, setExpandedClass] = useState<number | null>(null);

  const [classModal, setClassModal] = useState(false);
  const [classMode, setClassMode] = useState<'create' | 'edit'>('create');
  const [editingClassId, setEditingClassId] = useState<number | null>(null);
  const [classForm, setClassForm] = useState(emptyClassForm);
  const [classFormError, setClassFormError] = useState('');
  const [savingClass, setSavingClass] = useState(false);

  const [sectionModal, setSectionModal] = useState(false);
  const [sectionMode, setSectionMode] = useState<'create' | 'edit'>('create');
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [sectionForm, setSectionForm] = useState(emptySectionForm);
  const [sectionFormError, setSectionFormError] = useState('');
  const [savingSection, setSavingSection] = useState(false);

  useEffect(() => { loadData(); }, [schoolId]);

  async function loadData() {
    setLoading(true); setError('');
    const sid = schoolId ?? undefined;
    const [cRes, sRes] = await Promise.all([getClasses(sid), getSections(sid)]);
    if (cRes.data) setClasses(cRes.data as ClassRecord[]);
    else if (cRes.error) setError(cRes.error);
    if (sRes.data) setSections(sRes.data as SectionRecord[]);
    else if (sRes.error) setError(sRes.error);
    setLoading(false);
  }

  const filteredClasses = useMemo(() => {
    let list = classes;
    if (filterStatus) list = list.filter((c) => c.status === filterStatus);
    if (filterStage) list = list.filter((c) => c.stage === filterStage);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list;
  }, [classes, search, filterStage, filterStatus]);

  function sectionsOf(classId: number) {
    return sections.filter((s) => s.class_id === classId && (!filterStatus || s.status === filterStatus));
  }

  function openClassCreate() {
    setClassForm(emptyClassForm);
    setClassFormError('');
    setClassMode('create');
    setEditingClassId(null);
    setClassModal(true);
  }

  function openClassEdit(c: ClassRecord) {
    setClassForm({ name: c.name, stage: c.stage, order_index: c.order_index });
    setClassFormError('');
    setClassMode('edit');
    setEditingClassId(c.id);
    setClassModal(true);
  }

  async function handleSaveClass() {
    setClassFormError('');
    if (!classForm.name.trim() || !classForm.stage) { setClassFormError('الاسم والمرحلة مطلوبة'); return; }
    setSavingClass(true);
    const payload = { school_id: schoolId ?? 1, name: classForm.name.trim(), stage: classForm.stage, order_index: Number(classForm.order_index) || 0 };
    if (classMode === 'create') {
      const res = await createClass(payload);
      if (res.error) setClassFormError(res.error);
      else { setClassModal(false); loadData(); }
    } else if (editingClassId != null) {
      const res = await updateClass(editingClassId, { ...payload, status: 'active' });
      if (res.error) setClassFormError(res.error);
      else { setClassModal(false); loadData(); }
    }
    setSavingClass(false);
  }

  async function handleArchiveClass(id: number) {
    const secCount = sectionsOf(id).length;
    if (secCount > 0) { alert(`لا يمكن أرشفة الصف لأنه يحتوي على ${toArabicDigits(secCount)} شعب. أرشف الشعب أولاً.`); return; }
    if (!confirm('هل أنت متأكد من أرشفة هذا الصف؟')) return;
    const res = await archiveClass(id);
    if (res.error) alert(res.error);
    else loadData();
  }

  function openSectionCreate(classId?: number) {
    setSectionForm({ class_id: classId ?? '', name: '', capacity: 30 });
    setSectionFormError('');
    setSectionMode('create');
    setEditingSectionId(null);
    setSectionModal(true);
  }

  function openSectionEdit(s: SectionRecord) {
    setSectionForm({ class_id: s.class_id, name: s.name, capacity: s.capacity });
    setSectionFormError('');
    setSectionMode('edit');
    setEditingSectionId(s.id);
    setSectionModal(true);
  }

  async function handleSaveSection() {
    setSectionFormError('');
    if (!sectionForm.class_id || !sectionForm.name.trim()) { setSectionFormError('الصف والاسم مطلوبة'); return; }
    setSavingSection(true);
    const payload = { school_id: schoolId ?? 1, class_id: Number(sectionForm.class_id), name: sectionForm.name.trim(), capacity: Number(sectionForm.capacity) || 30 };
    if (sectionMode === 'create') {
      const res = await createSection(payload);
      if (res.error) setSectionFormError(res.error);
      else { setSectionModal(false); loadData(); }
    } else if (editingSectionId != null) {
      const res = await updateSection(editingSectionId, { ...payload, status: 'active' });
      if (res.error) setSectionFormError(res.error);
      else { setSectionModal(false); loadData(); }
    }
    setSavingSection(false);
  }

  async function handleArchiveSection(id: number) {
    if (!confirm('هل أنت متأكد من أرشفة هذه الشعبة؟')) return;
    const res = await archiveSection(id);
    if (res.error) alert(res.error);
    else loadData();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الصفوف والشعب</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة الصفوف الدراسية والشعب الأكاديمية</p>
        </div>
        {canManage && (
          <button onClick={openClassCreate} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Plus size={18} />
            <span>إضافة صف</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="البحث باسم الصف..." className="w-full pr-10 pl-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">كل المراحل</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
            <option value="archived">مؤرشف</option>
            <option value="">الكل</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600"><BookOpen size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">إجمالي الصفوف</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(classes.length)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600"><Layers size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">إجمالي الشعب</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(sections.length)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center text-green-600"><Users size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">الطلاب النشطون</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(classes.reduce((a, c) => a + (c.students_count || 0), 0))}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600"><AlertTriangle size={20} /></div>
          <div>
            <p className="text-xs text-gray-500">المؤرشفة</p>
            <p className="text-lg font-bold text-gray-900">{toArabicDigits(classes.filter((c) => c.status === 'archived').length + sections.filter((s) => s.status === 'archived').length)}</p>
          </div>
        </div>
      </div>

      {/* Classes List */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="w-10 h-10 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-500">جاري التحميل...</p>
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-red-600">
            <p className="font-medium">{error}</p>
            <button onClick={loadData} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">إعادة المحاولة</button>
          </div>
        ) : filteredClasses.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"><Search size={24} className="text-gray-400" /></div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">لا توجد نتائج</h3>
            <p className="text-sm text-gray-500">جرب تغيير معايير البحث أو أضف صفاً جديداً</p>
          </div>
        ) : (
          filteredClasses.map((cls) => {
            const secs = sectionsOf(cls.id);
            const isOpen = expandedClass === cls.id;
            return (
              <div key={cls.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setExpandedClass(isOpen ? null : cls.id)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                      {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                      <BookOpen size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-gray-900">{cls.name}</h3>
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">{cls.stage}</span>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          cls.status === 'active' ? 'bg-green-100 text-green-700' : cls.status === 'archived' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {cls.status === 'active' ? 'نشط' : cls.status === 'archived' ? 'مؤرشف' : 'غير نشط'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{toArabicDigits(secs.length)} شعبة · {toArabicDigits(cls.students_count || 0)} طالب</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManage && (
                      <>
                        <button onClick={() => openSectionCreate(cls.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                          <Plus size={14} />
                          <span>شعبة</span>
                        </button>
                        <button onClick={() => openClassEdit(cls)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="تعديل"><Edit2 size={16} /></button>
                        <button onClick={() => handleArchiveClass(cls.id)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="أرشفة"><Archive size={16} /></button>
                      </>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-gray-100">
                    {secs.length === 0 ? (
                      <div className="p-6 text-center text-gray-500 text-sm">لا توجد شعب مسجلة لهذا الصف</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-right">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-4 py-2.5 text-xs font-semibold text-gray-600">#</th>
                              <th className="px-4 py-2.5 text-xs font-semibold text-gray-600">اسم الشعبة</th>
                              <th className="px-4 py-2.5 text-xs font-semibold text-gray-600">السعة</th>
                              <th className="px-4 py-2.5 text-xs font-semibold text-gray-600">الطلاب</th>
                              <th className="px-4 py-2.5 text-xs font-semibold text-gray-600">الحالة</th>
                              <th className="px-4 py-2.5 text-xs font-semibold text-gray-600">الإجراءات</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {secs.map((s, idx) => (
                              <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-2.5 text-sm text-gray-500">{toArabicDigits(idx + 1)}</td>
                                <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{s.name}</td>
                                <td className="px-4 py-2.5 text-sm text-gray-600">{toArabicDigits(s.capacity)}</td>
                                <td className="px-4 py-2.5 text-sm text-gray-600">{toArabicDigits(s.students_count || 0)}</td>
                                <td className="px-4 py-2.5">
                                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                    s.status === 'active' ? 'bg-green-100 text-green-700' : s.status === 'archived' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
                                  }`}>
                                    {s.status === 'active' ? 'نشط' : s.status === 'archived' ? 'مؤرشف' : 'غير نشط'}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-2">
                                    {canManage && (
                                      <>
                                        <button onClick={() => openSectionEdit(s)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="تعديل"><Edit2 size={14} /></button>
                                        <button onClick={() => handleArchiveSection(s.id)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="أرشفة"><Archive size={14} /></button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Class Modal */}
      {classModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">{classMode === 'create' ? 'إضافة صف جديد' : 'تعديل الصف'}</h2>
              <button onClick={() => setClassModal(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              {classFormError && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{classFormError}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اسم الصف <span className="text-red-500">*</span></label>
                <input value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المرحلة <span className="text-red-500">*</span></label>
                <select value={classForm.stage} onChange={(e) => setClassForm({ ...classForm, stage: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الترتيب</label>
                <input type="number" value={classForm.order_index} onChange={(e) => setClassForm({ ...classForm, order_index: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
              <button onClick={() => setClassModal(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">إلغاء</button>
              <button onClick={handleSaveClass} disabled={savingClass} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium transition-colors">
                {savingClass ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={18} />}
                <span>{classMode === 'create' ? 'إضافة' : 'حفظ'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Section Modal */}
      {sectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">{sectionMode === 'create' ? 'إضافة شعبة جديدة' : 'تعديل الشعبة'}</h2>
              <button onClick={() => setSectionModal(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              {sectionFormError && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{sectionFormError}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الصف <span className="text-red-500">*</span></label>
                <select value={String(sectionForm.class_id)} onChange={(e) => setSectionForm({ ...sectionForm, class_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">اختر الصف</option>
                  {classes.filter((c) => c.status === 'active').map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اسم الشعبة <span className="text-red-500">*</span></label>
                <input value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">السعة</label>
                <input type="number" value={sectionForm.capacity} onChange={(e) => setSectionForm({ ...sectionForm, capacity: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
              <button onClick={() => setSectionModal(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">إلغاء</button>
              <button onClick={handleSaveSection} disabled={savingSection} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium transition-colors">
                {savingSection ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={18} />}
                <span>{sectionMode === 'create' ? 'إضافة' : 'حفظ'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
