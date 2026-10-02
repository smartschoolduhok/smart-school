import { useState } from 'react';
import type { StaffRegisterResponse, Employee } from '../../types/employees';
import { StaffDocumentFrame } from './StaffDocumentFrame';
import { EMPLOYEE_ROLE_LABELS, EMPLOYEE_STATUS_LABELS, staffDate, staffDigits } from './documentHelpers';
import { getEmployeePhotoUrl } from '../../lib/employeeRecordsApi';
import { useDocumentPagination } from './useDocumentPagination';

export function StaffPhoto({employee, enabled = true}: {employee: Employee; enabled?: boolean}) {
  const url = getEmployeePhotoUrl(employee.id, employee.school_id, employee.photo_updated_at);
  const [failedUrl, setFailedUrl] = useState('');
  return enabled && employee.has_photo && failedUrl !== url
    ? <img className="staff-register-photo" src={url} alt={`صورة ${employee.full_name}`} onError={() => setFailedUrl(url)} />
    : <div className="staff-register-photo staff-register-photo-placeholder">{enabled && employee.has_photo ? 'تعذر تحميل الصورة' : 'الصورة غير مسجلة'}</div>;
}

export function StaffRegisterDocument({summary}: {summary: StaffRegisterResponse}) {
  const {container, pages} = useDocumentPagination(summary.employees, 3, 258, '.staff-register-card', 12);
  const settings = summary.document_settings;
  const subtitle = [EMPLOYEE_STATUS_LABELS[summary.filters.status], summary.filters.role && (EMPLOYEE_ROLE_LABELS[summary.filters.role] || summary.filters.role), summary.filters.q && `البحث: ${summary.filters.q}`].filter(Boolean).join(' · ');
  return <div ref={container} className="staff-document staff-register-document" dir="rtl" lang="ar">{pages.map((employees, pageIndex) => <StaffDocumentFrame key={pageIndex} metadata={summary} title="سجل الكادر" subtitle={subtitle} pageIndex={pageIndex} pageCount={pages.length}>
    <div className="staff-register-cards">{employees.map((employee, index) => {
      const q = employee.primary_qualification;
      return <section className="staff-register-card" key={employee.id} data-record-id={employee.id} data-employee-id={employee.id}>
        <div className="staff-register-card-heading"><b>{staffDigits(pages.slice(0, pageIndex).reduce((sum, page) => sum + page.length, 0) + index + 1, settings)}. {employee.full_name}</b><span>{EMPLOYEE_STATUS_LABELS[employee.status] || employee.status}</span></div>
        <div className="staff-register-card-body">
          {summary.can_view_private && <StaffPhoto employee={employee} />}
          <dl>
            <div><dt>الرقم الوظيفي</dt><dd>{staffDigits(employee.employee_number || 'غير مسجل', settings)}</dd></div>
            <div><dt>الوظيفة</dt><dd>{employee.job_title || EMPLOYEE_ROLE_LABELS[employee.role] || employee.role || 'غير مسجل'}</dd></div>
            {summary.can_view_private && <><div><dt>الهاتف</dt><dd><bdi>{staffDigits(employee.phone || 'غير مسجل', settings)}</bdi></dd></div>
            <div><dt>البريد</dt><dd><bdi>{employee.email || 'غير مسجل'}</bdi></dd></div></>}
            <div><dt>تاريخ التعيين</dt><dd>{staffDate(employee.hire_date, settings)}</dd></div>
            <div><dt>تاريخ المباشرة</dt><dd>{staffDate(employee.commencement_date, settings)}</dd></div>
            {summary.can_view_private && <div className="staff-register-wide"><dt>المؤهل المختار</dt><dd>{q ? [q.degree, q.general_specialization, q.specific_specialization, q.institution, q.college, q.graduation_date && `التخرج: ${staffDate(q.graduation_date, settings)}`].filter(Boolean).join(' — ') : 'غير مسجل'}</dd></div>}
          </dl>
        </div>
      </section>;
    })}</div>
  </StaffDocumentFrame>)}</div>;
}
