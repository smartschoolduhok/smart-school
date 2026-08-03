import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { FINANCE_ACCESS_ROLES, SCHOOL_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import {
  getEmployees, createEmployee, updateEmployee, archiveEmployee,
  getSalaries, generateSalary, generateAllSalaries, paySalary, cancelSalary,
  getSalaryMonthlyReport, getEmployee,
} from '../../lib/api';
import {
  Users, Plus, Search, Trash2, X, DollarSign, Calendar,
  CheckCircle, AlertTriangle, ArrowRight, BarChart3, Wallet,
  UserCheck, TrendingUp, TrendingDown, FileText
} from 'lucide-react';

// Arabic-Indic digit converter
function toArabicIndic(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return '';
  return String(num).replace(/\d/g, d => String.fromCharCode(0x0660 + parseInt(d, 10)));
}

function formatDate(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('ar-IQ');
}

function formatMoney(amount: number | null, currency = 'IQD'): string {
  if (amount === null || amount === undefined) return '-';
  return `${toArabicIndic(amount.toLocaleString('en-US'))} ${currency}`;
}

function roleName(key: string): string {
  const map: Record<string, string> = {
    system_admin: 'مدير النظام', school_owner: 'مالك المدرسة',
    principal: 'المدير', vice_principal: 'نائب المدير',
    teacher: 'مدرس', accountant: 'محاسب', registrar: 'مسجل', parent: 'ولي أمر',
    staff: 'موظف', manager: 'مدير قسم', supervisor: 'مشرف',
  };
  return map[key] || key;
}

type TabKey = 'list' | 'add' | 'salaries' | 'generate' | 'pay' | 'reports';

interface EmployeeRecord {
  id: number;
  school_id: number;
  full_name: string;
  employee_number: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  job_title: string | null;
  salary_amount: number;
  hire_date: string | null;
  status: string;
  notes: string | null;
}

interface SalaryRecord {
  id: number;
  employee_id: number;
  employee_name?: string;
  month: number;
  year: number;
  base_salary: number;
  bonus_amount: number;
  deduction_amount: number;
  net_salary: number;
  status: string;
  paid_at: number | null;
  cancel_reason: string | null;
  treasury_transaction_id: number | null;
}

interface ReportRow {
  month: number;
  year: number;
  total_base: number;
  total_bonus: number;
  total_deduction: number;
  total_net: number;
  paid_count: number;
  unpaid_count: number;
  cancelled_count: number;
}

export default function EmployeesPage() {
  const { user } = useAuth();
  const isAccountant = user?.role_key === 'accountant';
  const isManageEmployee = hasRole(user?.role_key, SCHOOL_MANAGEMENT_ROLES);
  const isManageSalary = hasRole(user?.role_key, FINANCE_ACCESS_ROLES);

  const [activeTab, setActiveTab] = useState<TabKey>('list');
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [salaries, setSalaries] = useState<SalaryRecord[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRecord | null>(null);
  const [selectedSalary, setSelectedSalary] = useState<SalaryRecord | null>(null);

  const [newEmployee, setNewEmployee] = useState<Record<string, any>>({
    full_name: '', employee_number: '', phone: '', email: '', role: 'staff',
    job_title: '', salary_amount: '', hire_date: '', notes: '',
  });
  const [editEmployee, setEditEmployee] = useState<Record<string, any> | null>(null);

  const [genPayload, setGenPayload] = useState<Record<string, any>>({
    employee_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(),
    base_salary: '', bonus_amount: 0, deduction_amount: 0,
  });
  const [genAllPayload, setGenAllPayload] = useState<Record<string, any>>({
    month: new Date().getMonth() + 1, year: new Date().getFullYear(),
    bonus_amount: 0, deduction_amount: 0,
  });
  const [paySalaryId, setPaySalaryId] = useState<string>('');
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [cancelPayload, setCancelPayload] = useState<{ id: string; reason: string }>({ id: '', reason: '' });
  const [reportFilters, setReportFilters] = useState<{ month: string; year: string }>({
    month: String(new Date().getMonth() + 1), year: String(new Date().getFullYear()),
  });

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  }, []);
  const showSuccess = useCallback((msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 5000);
  }, []);

  const schoolId = user?.school_id || 1;

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    const res = await getEmployees(schoolId);
    if (res.data) setEmployees(res.data as EmployeeRecord[]);
    setLoading(false);
  }, [schoolId]);

  const loadSalaries = useCallback(async () => {
    setLoading(true);
    const res = await getSalaries({ school_id: schoolId, limit: 100, offset: 0 });
    if (res.data) setSalaries(res.data as SalaryRecord[]);
    setLoading(false);
  }, [schoolId]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    const res = await getSalaryMonthlyReport(schoolId, reportFilters.month, reportFilters.year);
    if (res.data) setReports(res.data as ReportRow[]);
    setLoading(false);
  }, [schoolId, reportFilters]);

  useEffect(() => {
    if (activeTab === 'list') loadEmployees();
    if (activeTab === 'salaries') loadSalaries();
    if (activeTab === 'reports') loadReports();
  }, [activeTab, loadEmployees, loadSalaries, loadReports]);

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmployee.full_name) { showError('اسم الموظف مطلوب'); return; }
    const res = await createEmployee({ ...newEmployee, school_id: schoolId, salary_amount: Number(newEmployee.salary_amount) || 0 });
    if (res.error) { showError(res.error); }
    else {
      showSuccess('تم إضافة الموظف بنجاح');
      setNewEmployee({ full_name: '', employee_number: '', phone: '', email: '', role: 'staff', job_title: '', salary_amount: '', hire_date: '', notes: '' });
      setActiveTab('list');
      loadEmployees();
    }
  }

  async function handleUpdateEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!editEmployee || !selectedEmployee) return;
    const res = await updateEmployee(selectedEmployee.id, {
      ...editEmployee,
      salary_amount: Number(editEmployee.salary_amount) || 0,
    });
    if (res.error) { showError(res.error); }
    else {
      showSuccess('تم تحديث الموظف بنجاح');
      setEditEmployee(null);
      setSelectedEmployee(null);
      loadEmployees();
    }
  }

  async function handleArchive(id: number) {
    if (!confirm('هل أنت متأكد من أرشفة هذا الموظف؟')) return;
    const res = await archiveEmployee(id);
    if (res.error) { showError(res.error); }
    else { showSuccess('تم أرشفة الموظف بنجاح'); loadEmployees(); }
  }

  async function handleGenerateOne(e: React.FormEvent) {
    e.preventDefault();
    if (!genPayload.employee_id || !genPayload.month || !genPayload.year) { showError('معرف الموظف والشهر والسنة مطلوبة'); return; }
    const res = await generateSalary({
      employee_id: Number(genPayload.employee_id),
      month: Number(genPayload.month),
      year: Number(genPayload.year),
      base_salary: genPayload.base_salary !== '' ? Number(genPayload.base_salary) : undefined,
      bonus_amount: Number(genPayload.bonus_amount) || 0,
      deduction_amount: Number(genPayload.deduction_amount) || 0,
    });
    if (res.error) { showError(res.error); }
    else {
      showSuccess('تم توليد الراتب بنجاح');
      setGenPayload({ employee_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), base_salary: '', bonus_amount: 0, deduction_amount: 0 });
      setActiveTab('salaries');
      loadSalaries();
    }
  }

  async function handleGenerateAll(e: React.FormEvent) {
    e.preventDefault();
    const res = await generateAllSalaries({
      school_id: schoolId,
      month: Number(genAllPayload.month),
      year: Number(genAllPayload.year),
      bonus_amount: Number(genAllPayload.bonus_amount) || 0,
      deduction_amount: Number(genAllPayload.deduction_amount) || 0,
    });
    if (res.error) { showError(res.error); }
    else {
      const data = res.data as any;
      showSuccess(`تم توليد ${data?.created?.length || 0} راتب، تم تخطي ${data?.skipped?.length || 0}`);
      setActiveTab('salaries');
      loadSalaries();
    }
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!paySalaryId) { showError('معرف الراتب مطلوب'); return; }
    const res = await paySalary(paySalaryId, payDate);
    if (res.error) { showError(res.error); }
    else {
      showSuccess('تم دفع الراتب بنجاح');
      setPaySalaryId('');
      setPayDate(new Date().toISOString().split('T')[0]);
      setActiveTab('salaries');
      loadSalaries();
    }
  }

  async function handleCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelPayload.id || !cancelPayload.reason) { showError('معرف الراتب وسبب الإلغاء مطلوبان'); return; }
    const res = await cancelSalary(cancelPayload.id, cancelPayload.reason);
    if (res.error) { showError(res.error); }
    else {
      showSuccess('تم إلغاء الراتب بنجاح');
      setCancelPayload({ id: '', reason: '' });
      setActiveTab('salaries');
      loadSalaries();
    }
  }

  const filteredEmployees = employees.filter(e =>
    e.full_name.includes(search) || (e.employee_number && e.employee_number.includes(search)) || (e.job_title && e.job_title.includes(search))
  );

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'list', label: 'الموظفون', icon: <Users size={18} /> },
    ...(isManageEmployee ? [{ key: 'add' as TabKey, label: 'إضافة موظف', icon: <Plus size={18} /> }] : []),
    { key: 'salaries', label: 'الرواتب الشهرية', icon: <DollarSign size={18} /> },
    ...(isManageSalary ? [{ key: 'generate' as TabKey, label: 'توليد الرواتب', icon: <Calendar size={18} /> }] : []),
    ...(isManageSalary ? [{ key: 'pay' as TabKey, label: 'دفع راتب', icon: <Wallet size={18} /> }] : []),
    { key: 'reports', label: 'تقارير الرواتب', icon: <BarChart3 size={18} /> },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        <UserCheck className="text-primary-600" />
        الموظفون والرواتب
      </h1>

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center gap-2">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="mr-auto"><X size={16} /></button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 rounded-xl bg-green-50 border border-green-200 text-green-700 flex items-center gap-2">
          <CheckCircle size={18} />
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="mr-auto"><X size={16} /></button>
        </div>
      )}

      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setError(null); setSuccess(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-12 text-gray-500">جارِ التحميل...</div>}

      {!loading && activeTab === 'list' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-2.5 text-gray-400" size={18} />
              <input
                className="w-full pr-10 pl-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="بحث باسم الموظف أو الرقم أو المسمى الوظيفي..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">الاسم</th>
                  <th className="px-4 py-3 text-right font-medium">الرقم</th>
                  <th className="px-4 py-3 text-right font-medium">المسمى الوظيفي</th>
                  <th className="px-4 py-3 text-right font-medium">الراتب</th>
                  <th className="px-4 py-3 text-right font-medium">الحالة</th>
                  {!isAccountant && (
                    <th className="px-4 py-3 text-right font-medium">إجراءات</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEmployees.map(emp => (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{emp.full_name}</div>
                      {emp.phone && <div className="text-xs text-gray-500">{emp.phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{emp.employee_number || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{emp.job_title || roleName(emp.role)}</td>
                    <td className="px-4 py-3 font-medium text-primary-700">{formatMoney(emp.salary_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        emp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {emp.status === 'active' ? <CheckCircle size={12} /> : <X size={12} />}
                        {emp.status === 'active' ? 'نشط' : 'مؤرشف'}
                      </span>
                    </td>
                    {!isAccountant && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"
                            onClick={() => { setSelectedEmployee(emp); setEditEmployee({ ...emp }); setActiveTab('add'); }}
                            title="تعديل"
                          >
                            <Plus size={16} />
                          </button>
                          <button
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"
                            onClick={() => handleArchive(emp.id)}
                            title="أرشفة"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {filteredEmployees.length === 0 && (
                  <tr><td colSpan={isAccountant ? 5 : 6} className="px-4 py-8 text-center text-gray-500">لا يوجد موظفون</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && activeTab === 'add' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            {editEmployee ? <ArrowRight size={18} /> : <Plus size={18} />}
            {editEmployee ? 'تعديل موظف' : 'إضافة موظف جديد'}
          </h2>
          <form onSubmit={editEmployee ? handleUpdateEmployee : handleAddEmployee} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الاسم الكامل <span className="text-red-500">*</span></label>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editEmployee ? editEmployee.full_name : newEmployee.full_name}
                  onChange={e => editEmployee ? setEditEmployee({ ...editEmployee, full_name: e.target.value }) : setNewEmployee({ ...newEmployee, full_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">رقم الموظف</label>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editEmployee ? editEmployee.employee_number || '' : newEmployee.employee_number}
                  onChange={e => editEmployee ? setEditEmployee({ ...editEmployee, employee_number: e.target.value }) : setNewEmployee({ ...newEmployee, employee_number: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">المسمى الوظيفي</label>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editEmployee ? editEmployee.job_title || '' : newEmployee.job_title}
                  onChange={e => editEmployee ? setEditEmployee({ ...editEmployee, job_title: e.target.value }) : setNewEmployee({ ...newEmployee, job_title: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الدور</label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editEmployee ? editEmployee.role || 'staff' : newEmployee.role}
                  onChange={e => editEmployee ? setEditEmployee({ ...editEmployee, role: e.target.value }) : setNewEmployee({ ...newEmployee, role: e.target.value })}
                >
                  <option value="staff">موظف</option>
                  <option value="manager">مدير قسم</option>
                  <option value="supervisor">مشرف</option>
                  <option value="teacher">مدرس</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الراتب (IQD)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editEmployee ? editEmployee.salary_amount : newEmployee.salary_amount}
                  onChange={e => editEmployee ? setEditEmployee({ ...editEmployee, salary_amount: e.target.value }) : setNewEmployee({ ...newEmployee, salary_amount: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ التعيين</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editEmployee ? editEmployee.hire_date || '' : newEmployee.hire_date}
                  onChange={e => editEmployee ? setEditEmployee({ ...editEmployee, hire_date: e.target.value }) : setNewEmployee({ ...newEmployee, hire_date: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">الهاتف</label>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editEmployee ? editEmployee.phone || '' : newEmployee.phone}
                  onChange={e => editEmployee ? setEditEmployee({ ...editEmployee, phone: e.target.value }) : setNewEmployee({ ...newEmployee, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">البريد الإلكتروني</label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={editEmployee ? editEmployee.email || '' : newEmployee.email}
                  onChange={e => editEmployee ? setEditEmployee({ ...editEmployee, email: e.target.value }) : setNewEmployee({ ...newEmployee, email: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
              <textarea
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={3}
                value={editEmployee ? editEmployee.notes || '' : newEmployee.notes}
                onChange={e => editEmployee ? setEditEmployee({ ...editEmployee, notes: e.target.value }) : setNewEmployee({ ...newEmployee, notes: e.target.value })}
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                {editEmployee ? 'حفظ التعديلات' : 'إضافة موظف'}
              </button>
              {editEmployee && (
                <button type="button" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200" onClick={() => { setEditEmployee(null); setSelectedEmployee(null); }}>
                  إلغاء
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {!loading && activeTab === 'salaries' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">الموظف</th>
                  <th className="px-4 py-3 text-right font-medium">الشهر/السنة</th>
                  <th className="px-4 py-3 text-right font-medium">الراتب الأساسي</th>
                  <th className="px-4 py-3 text-right font-medium">المكافأة</th>
                  <th className="px-4 py-3 text-right font-medium">الاستقطاع</th>
                  <th className="px-4 py-3 text-right font-medium">الصافي</th>
                  <th className="px-4 py-3 text-right font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {salaries.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.employee_name || s.employee_id}</td>
                    <td className="px-4 py-3 text-gray-600">{toArabicIndic(`${s.month}/${s.year}`)}</td>
                    <td className="px-4 py-3">{formatMoney(s.base_salary)}</td>
                    <td className="px-4 py-3 text-green-700">{formatMoney(s.bonus_amount)}</td>
                    <td className="px-4 py-3 text-red-700">{formatMoney(s.deduction_amount)}</td>
                    <td className="px-4 py-3 font-bold text-primary-700">{formatMoney(s.net_salary)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        s.status === 'paid' ? 'bg-green-100 text-green-700' :
                        s.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {s.status === 'paid' ? <CheckCircle size={12} /> : s.status === 'cancelled' ? <X size={12} /> : <AlertTriangle size={12} />}
                        {s.status === 'paid' ? 'مدفوع' : s.status === 'cancelled' ? 'ملغى' : 'غير مدفوع'}
                      </span>
                    </td>
                  </tr>
                ))}
                {salaries.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">لا يوجد رواتب مسجلة</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && activeTab === 'generate' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <UserCheck size={18} /> توليد راتب فردي
            </h3>
            <form onSubmit={handleGenerateOne} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">معرف الموظف <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={genPayload.employee_id}
                  onChange={e => setGenPayload({ ...genPayload, employee_id: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الشهر</label>
                  <input
                    type="number" min={1} max={12}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={genPayload.month}
                    onChange={e => setGenPayload({ ...genPayload, month: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">السنة</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={genPayload.year}
                    onChange={e => setGenPayload({ ...genPayload, year: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">راتب أساسي (اختياري)</label>
                  <input
                    type="number" min={0}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={genPayload.base_salary}
                    onChange={e => setGenPayload({ ...genPayload, base_salary: e.target.value })}
                    placeholder="افتراضي من الموظف"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">مكافأة</label>
                  <input
                    type="number" min={0}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={genPayload.bonus_amount}
                    onChange={e => setGenPayload({ ...genPayload, bonus_amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">استقطاع</label>
                  <input
                    type="number" min={0}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={genPayload.deduction_amount}
                    onChange={e => setGenPayload({ ...genPayload, deduction_amount: e.target.value })}
                  />
                </div>
              </div>
              <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                توليد راتب
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Users size={18} /> توليد رواتب جميع الموظفين
            </h3>
            <form onSubmit={handleGenerateAll} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">الشهر</label>
                  <input
                    type="number" min={1} max={12}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={genAllPayload.month}
                    onChange={e => setGenAllPayload({ ...genAllPayload, month: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">السنة</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={genAllPayload.year}
                    onChange={e => setGenAllPayload({ ...genAllPayload, year: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">مكافأة جماعية</label>
                  <input
                    type="number" min={0}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={genAllPayload.bonus_amount}
                    onChange={e => setGenAllPayload({ ...genAllPayload, bonus_amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">استقطاع جماعي</label>
                  <input
                    type="number" min={0}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={genAllPayload.deduction_amount}
                    onChange={e => setGenAllPayload({ ...genAllPayload, deduction_amount: e.target.value })}
                  />
                </div>
              </div>
              <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                توليد جميع الرواتب
              </button>
            </form>
          </div>
        </div>
      )}

      {!loading && activeTab === 'pay' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Wallet size={18} /> دفع راتب
            </h3>
            <form onSubmit={handlePay} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">معرف الراتب <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={paySalaryId}
                  onChange={e => setPaySalaryId(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الدفع</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={payDate}
                  onChange={e => setPayDate(e.target.value)}
                />
              </div>
              <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                تأكيد الدفع
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <X size={18} /> إلغاء راتب
            </h3>
            <form onSubmit={handleCancel} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">معرف الراتب <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={cancelPayload.id}
                  onChange={e => setCancelPayload({ ...cancelPayload, id: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">سبب الإلغاء <span className="text-red-500">*</span></label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  rows={3}
                  value={cancelPayload.reason}
                  onChange={e => setCancelPayload({ ...cancelPayload, reason: e.target.value })}
                  required
                />
              </div>
              <button type="submit" className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
                إلغاء الراتب
              </button>
            </form>
          </div>
        </div>
      )}

      {!loading && activeTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex gap-4 bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">الشهر</label>
              <input
                type="number" min={1} max={12}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={reportFilters.month}
                onChange={e => setReportFilters({ ...reportFilters, month: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">السنة</label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={reportFilters.year}
                onChange={e => setReportFilters({ ...reportFilters, year: e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <button onClick={loadReports} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                عرض
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">الشهر/السنة</th>
                  <th className="px-4 py-3 text-right font-medium">الأساسي</th>
                  <th className="px-4 py-3 text-right font-medium">المكافآت</th>
                  <th className="px-4 py-3 text-right font-medium">الاستقطاعات</th>
                  <th className="px-4 py-3 text-right font-medium">الصافي</th>
                  <th className="px-4 py-3 text-right font-medium">مدفوع</th>
                  <th className="px-4 py-3 text-right font-medium">غير مدفوع</th>
                  <th className="px-4 py-3 text-right font-medium">ملغى</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reports.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{toArabicIndic(`${r.month}/${r.year}`)}</td>
                    <td className="px-4 py-3">{formatMoney(r.total_base)}</td>
                    <td className="px-4 py-3 text-green-700">{formatMoney(r.total_bonus)}</td>
                    <td className="px-4 py-3 text-red-700">{formatMoney(r.total_deduction)}</td>
                    <td className="px-4 py-3 font-bold text-primary-700">{formatMoney(r.total_net)}</td>
                    <td className="px-4 py-3">{toArabicIndic(r.paid_count)}</td>
                    <td className="px-4 py-3">{toArabicIndic(r.unpaid_count)}</td>
                    <td className="px-4 py-3">{toArabicIndic(r.cancelled_count)}</td>
                  </tr>
                ))}
                {reports.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">لا توجد بيانات</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
