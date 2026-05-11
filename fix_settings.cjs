const fs = require('fs');
let g = fs.readFileSync('src/modules/grades/GradesPage.tsx', 'utf8');

// Find the entire SettingsTab function and replace it
const oldSettingsTab = `function SettingsTab() {
  const { user } = useAuth();
  const schoolId = user?.school_id;
  const [settings, setSettings] = useState<GradeSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [form, setForm] = useState({
    max_grade: '100',
    passing_grade: '50',
    exemption_grade: '90',
    general_exemption_average_grade: '85',
    general_exemption_min_subject_grade: '75',
  });

  useEffect(() => {
    loadSettings();
  }, [schoolId]);

  async function loadSettings() {
    setLoading(true);
    const res = await getGradeSettings();
    setLoading(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
      return;
    }
    const data = Array.isArray(res.data) ? res.data[0] : res.data;
    if (data) {
      setSettings(data as GradeSettings);
      setForm({
        max_grade: String(data.max_grade ?? 100),
        passing_grade: String(data.passing_grade ?? 50),
        exemption_grade: String(data.exemption_grade ?? 90),
        general_exemption_average_grade: String(data.general_exemption_average_grade ?? 85),
        general_exemption_min_subject_grade: String(data.general_exemption_min_subject_grade ?? 75),
      });
    }
  }

  async function handleSave() {
    const maxGrade = Number(form.max_grade);
    const passingGrade = Number(form.passing_grade);
    const exemptionGrade = Number(form.exemption_grade);
    const generalAvg = Number(form.general_exemption_average_grade);
    const generalMin = Number(form.general_exemption_min_subject_grade);

    if ([maxGrade, passingGrade, exemptionGrade, generalAvg, generalMin].some((n) => isNaN(n))) {
      setMessage({ text: 'جميع القيم يجب أن تكون أرقامًا صالحة', type: 'error' });
      return;
    }
    if (maxGrade <= 0) { setMessage({ text: 'الدرجة العظمى يجب أن تكون أكبر من ٠', type: 'error' }); return; }
    if (passingGrade < 0 || passingGrade > maxGrade) { setMessage({ text: 'درجة النجاح يجب أن تكون بين ٠ والدرجة العظمى', type: 'error' }); return; }
    if (exemptionGrade < passingGrade) { setMessage({ text: 'درجة الإعفاء يجب أن تكون ≥ درجة النجاح', type: 'error' }); return; }
    if (exemptionGrade > maxGrade) { setMessage({ text: 'درجة الإعفاء يجب أن تكون ≤ الدرجة العظمى', type: 'error' }); return; }
    if (generalAvg < passingGrade) { setMessage({ text: 'متوسط الإعفاء العام يجب أن يكون ≥ درجة النجاح', type: 'error' }); return; }
    if (generalAvg > maxGrade) { setMessage({ text: 'متوسط الإعفاء العام يجب أن يكون ≤ الدرجة العظمى', type: 'error' }); return; }
    if (generalMin < passingGrade) { setMessage({ text: 'أدنى درجة للإعفاء العام يجب أن تكون ≥ درجة النجاح', type: 'error' }); return; }
    if (generalMin > generalAvg) { setMessage({ text: 'أدنى درجة للإعفاء العام يجب أن تكون ≤ متوسط الإعفاء العام', type: 'error' }); return; }

    setSaving(true);
    const payload: Record<string, any> = {
      max_grade: maxGrade,
      passing_grade: passingGrade,
      exemption_grade: exemptionGrade,
      general_exemption_average_grade: generalAvg,
      general_exemption_min_subject_grade: generalMin,
    };
    const res = await updateGradeSettings(payload);
    setSaving(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: 'تم حفظ الإعدادات بنجاح', type: 'success' });
      const data = Array.isArray(res.data) ? res.data[0] : res.data;
      if (data) setSettings(data as GradeSettings);
    }
    setTimeout(() => setMessage(null), 4000);
  }`;

const newSettingsTab = `function SettingsTab() {
  const { user } = useAuth();
  const isAdmin = user?.role_key === 'system_admin';
  const isTeacher = user?.role_key === 'teacher';
  const canEdit = isAdmin || ['school_owner', 'principal', 'vice_principal'].includes(user?.role_key || '');
  const jwtSchoolId = user?.school_id;
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(jwtSchoolId ?? null);
  const [schools, setSchools] = useState<Array<Record<string, any>>>([]);
  const [settings, setSettings] = useState<GradeSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [form, setForm] = useState({
    max_grade: '100',
    passing_grade: '50',
    exemption_grade: '90',
    general_exemption_average_grade: '85',
    general_exemption_min_subject_grade: '75',
  });

  useEffect(() => {
    if (isAdmin) {
      getSchools().then((res) => { if (res.data) setSchools(res.data as any); });
    }
  }, [isAdmin]);

  useEffect(() => {
    loadSettings();
  }, [selectedSchoolId, jwtSchoolId]);

  async function loadSettings() {
    setLoading(true);
    const schoolIdForApi = isAdmin ? selectedSchoolId : jwtSchoolId;
    const res = await getGradeSettings(schoolIdForApi ?? null);
    setLoading(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
      return;
    }
    const data = Array.isArray(res.data) ? res.data[0] : res.data;
    if (data) {
      setSettings(data as GradeSettings);
      setForm({
        max_grade: String(data.max_grade ?? 100),
        passing_grade: String(data.passing_grade ?? 50),
        exemption_grade: String(data.exemption_grade ?? 90),
        general_exemption_average_grade: String(data.general_exemption_average_grade ?? 85),
        general_exemption_min_subject_grade: String(data.general_exemption_min_subject_grade ?? 75),
      });
    }
  }

  async function handleSave() {
    const maxGrade = Number(form.max_grade);
    const passingGrade = Number(form.passing_grade);
    const exemptionGrade = Number(form.exemption_grade);
    const generalAvg = Number(form.general_exemption_average_grade);
    const generalMin = Number(form.general_exemption_min_subject_grade);

    if ([maxGrade, passingGrade, exemptionGrade, generalAvg, generalMin].some((n) => isNaN(n))) {
      setMessage({ text: 'جميع القيم يجب أن تكون أرقامًا صالحة', type: 'error' });
      return;
    }
    if (maxGrade <= 0) { setMessage({ text: 'الدرجة العظمى يجب أن تكون أكبر من ٠', type: 'error' }); return; }
    if (passingGrade < 0 || passingGrade > maxGrade) { setMessage({ text: 'درجة النجاح يجب أن تكون بين ٠ والدرجة العظمى', type: 'error' }); return; }
    if (exemptionGrade < passingGrade) { setMessage({ text: 'درجة الإعفاء يجب أن تكون ≥ درجة النجاح', type: 'error' }); return; }
    if (exemptionGrade > maxGrade) { setMessage({ text: 'درجة الإعفاء يجب أن تكون ≤ الدرجة العظمى', type: 'error' }); return; }
    if (generalAvg < passingGrade) { setMessage({ text: 'متوسط الإعفاء العام يجب أن يكون ≥ درجة النجاح', type: 'error' }); return; }
    if (generalAvg > maxGrade) { setMessage({ text: 'متوسط الإعفاء العام يجب أن يكون ≤ الدرجة العظمى', type: 'error' }); return; }
    if (generalMin < passingGrade) { setMessage({ text: 'أدنى درجة للإعفاء العام يجب أن تكون ≥ درجة النجاح', type: 'error' }); return; }
    if (generalMin > generalAvg) { setMessage({ text: 'أدنى درجة للإعفاء العام يجب أن تكون ≤ متوسط الإعفاء العام', type: 'error' }); return; }

    setSaving(true);
    const payload: Record<string, any> = {
      max_grade: maxGrade,
      passing_grade: passingGrade,
      exemption_grade: exemptionGrade,
      general_exemption_average_grade: generalAvg,
      general_exemption_min_subject_grade: generalMin,
    };
    const schoolIdForApi = isAdmin ? selectedSchoolId : jwtSchoolId;
    const res = await updateGradeSettings(payload, schoolIdForApi ?? null);
    setSaving(false);
    if (res.error) {
      setMessage({ text: res.error, type: 'error' });
    } else {
      setMessage({ text: 'تم حفظ إعدادات الدرجات بنجاح', type: 'success' });
      const data = Array.isArray(res.data) ? res.data[0] : res.data;
      if (data) setSettings(data as GradeSettings);
    }
    setTimeout(() => setMessage(null), 4000);
  }`;

if (!g.includes(oldSettingsTab)) {
  console.error('Could not find old SettingsTab pattern');
  process.exit(1);
}
g = g.replace(oldSettingsTab, newSettingsTab);

// Now replace the save button area to add admin selector + teacher read-only message
const oldSaveArea = `          <div className="flex items-center gap-3 pt-2">
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              حفظ الإعدادات
            </button>
          </div>`;

const newSaveArea = `          <div className="flex flex-col gap-3 pt-2">
            {isAdmin && (
              <div className="w-full max-w-sm">
                <label className="block text-sm font-medium text-gray-700 mb-1">اختيار المدرسة</label>
                <select
                  value={selectedSchoolId ?? ''}
                  onChange={(e) => setSelectedSchoolId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
                >
                  <option value="">— اختر مدرسة —</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            {isTeacher && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-sm">
                <AlertCircle size={16} />
                <span>ليس لديك صلاحية تعديل الإعدادات. يمكنك فقط الاطلاع على القيم.</span>
              </div>
            )}
            {canEdit && (
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 w-fit">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                حفظ الإعدادات
              </button>
            )}
          </div>`;

if (!g.includes(oldSaveArea)) {
  console.error('Could not find old save area pattern');
  process.exit(1);
}
g = g.replace(oldSaveArea, newSaveArea);

// Also disable inputs for teachers
const oldInputsBlock = `          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الدرجة العظمى</label>
              <input type="number" value={form.max_grade} onChange={(e) => setForm((f) => ({ ...f, max_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">درجة النجاح</label>
              <input type="number" value={form.passing_grade} onChange={(e) => setForm((f) => ({ ...f, passing_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">درجة الإعفاء الفردي (المادة)</label>
              <input type="number" value={form.exemption_grade} onChange={(e) => setForm((f) => ({ ...f, exemption_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              <p className="text-xs text-gray-500 mt-1">إذا كان السعي السنوي ≥ هذه القيمة ⇒ معفى فرديًا</p>
            </div>
            <div />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">متوسط الإعفاء العام</label>
              <input type="number" value={form.general_exemption_average_grade} onChange={(e) => setForm((f) => ({ ...f, general_exemption_average_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              <p className="text-xs text-gray-500 mt-1">متوسط السعي السنوي لجميع المواد يجب أن يكون ≥ هذه القيمة</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">أدنى درجة للإعفاء العام (لكل مادة)</label>
              <input type="number" value={form.general_exemption_min_subject_grade} onChange={(e) => setForm((f) => ({ ...f, general_exemption_min_subject_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              <p className="text-xs text-gray-500 mt-1">أدنى سعي سنوي بين جميع المواد يجب أن يكون ≥ هذه القيمة</p>
            </div>
          </div>`;

const newInputsBlock = `          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الدرجة العظمى</label>
              <input type="number" value={form.max_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, max_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">درجة النجاح</label>
              <input type="number" value={form.passing_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, passing_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">درجة الإعفاء الفردي (المادة)</label>
              <input type="number" value={form.exemption_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, exemption_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
              <p className="text-xs text-gray-500 mt-1">إذا كان السعي السنوي ≥ هذه القيمة ⇒ معفى فرديًا</p>
            </div>
            <div />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">متوسط الإعفاء العام</label>
              <input type="number" value={form.general_exemption_average_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, general_exemption_average_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
              <p className="text-xs text-gray-500 mt-1">متوسط السعي السنوي لجميع المواد يجب أن يكون ≥ هذه القيمة</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">أدنى درجة للإعفاء العام (لكل مادة)</label>
              <input type="number" value={form.general_exemption_min_subject_grade} disabled={isTeacher} onChange={(e) => setForm((f) => ({ ...f, general_exemption_min_subject_grade: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500" />
              <p className="text-xs text-gray-500 mt-1">أدنى سعي سنوي بين جميع المواد يجب أن يكون ≥ هذه القيمة</p>
            </div>
          </div>`;

if (!g.includes(oldInputsBlock)) {
  console.error('Could not find old inputs block pattern');
  process.exit(1);
}
g = g.replace(oldInputsBlock, newInputsBlock);

fs.writeFileSync('src/modules/grades/GradesPage.tsx', g, 'utf8');
console.log('GradesPage.tsx SettingsTab updated successfully');
