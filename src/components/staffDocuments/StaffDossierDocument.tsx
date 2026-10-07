import { useState, type ReactNode } from 'react';
import type { EmployeeProfile } from '../../types/employees';
import { DOSSIER_HISTORY_KINDS, DOSSIER_PERSONAL_FIELDS, DOSSIER_SERVICE_FIELDS, type StaffDossierResponse } from '../../lib/staffDossier';
import { getEmployeePhotoUrl } from '../../lib/employeeRecordsApi';
import { staffDate, staffDigits, staffMoney } from './documentHelpers';
import './staffDossier.css';

function DossierImage({ src, label, className }: { src: string | null; label: string; className: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return src && failed !== src ? <img className={className} src={src} alt={label} onError={() => setFailed(src)} /> : <div className={`${className} dossier-image-empty`}>{src ? 'تعذر تحميل الصورة' : label}</div>;
}
export function StaffDossierDocument({ profile, dossier, draft = false }: { profile: EmployeeProfile; dossier: StaffDossierResponse; draft?: boolean }) {
  const employee = profile.employee, data = dossier.data, settings = profile.document_settings;
  const display = (value: ReactNode) => value == null || value === '' ? <span className="dossier-blank" aria-label="غير مسجل">&nbsp;</span> : value;
  const field = (label: string, value: ReactNode) => <div className="dossier-pair" key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>;
  const date = (value: string | null | undefined) => staffDate(value, settings, '');
  const unresolved = data.qualifications.filter(q => !dossier.qualification_links.some(link => link.qualification_key === q.qualification_key));
  return <article className="staff-dossier-document" dir="rtl" lang="ar" data-employee-id={employee.id}>
    <table className="dossier-page-flow"><thead><tr><td>
      <header className="dossier-header">
        <DossierImage src={dossier.logo_url} label={`شعار ${dossier.school_name}`} className="dossier-school-logo" />
        <div><p>{dossier.school_name}</p><h1>سجل جماعة المدرسين</h1><p>{employee.full_name}{profile.academic_year && ` · ${profile.academic_year.name}`}</p></div>
        <div className="dossier-header-reference">الرقم الوظيفي<br/><bdi dir="ltr">{staffDigits(employee.employee_number || '', settings)}</bdi>{draft && <strong>معاينة غير محفوظة</strong>}</div>
      </header>
    </td></tr></thead><tbody><tr><td>
      <section className="dossier-section"><h2>01 · البيانات الشخصية</h2>
        <div className="dossier-personal-top"><dl className="dossier-fields">{field('الاسم الكامل', employee.full_name)}{field('الهاتف', <bdi dir="ltr">{staffDigits(employee.phone || '', settings)}</bdi>)}{field('العنوان الدائم', employee.address)}</dl>
          <DossierImage src={employee.has_photo ? getEmployeePhotoUrl(employee.id, employee.school_id, employee.photo_updated_at) : null} label="الصورة الشخصية" className="dossier-portrait" />
        </div>
        <dl className="dossier-fields">{DOSSIER_PERSONAL_FIELDS.map(([key, label]) => field(label, key.endsWith('_date') ? date(data[key]) : key === 'blood_group' || key === 'identity_number' ? <bdi dir="ltr">{data[key]}</bdi> : data[key]))}</dl>
      </section>
    </td></tr><tr><td>
      <section className="dossier-section"><h2>02 · المؤهلات العلمية</h2>
        {profile.qualifications.length ? profile.qualifications.map(q => {
          const link = dossier.qualification_links.find(row => row.qualification_id === q.id);
          const supplement = data.qualifications.find(row => row.qualification_key === link?.qualification_key);
          return <dl className="dossier-fields dossier-qualification" key={q.id}>
            {field('الشهادة', q.degree)}{field('الجامعة', q.institution)}{field('الكلية', q.college)}{field('القسم', supplement?.department)}
            {field('الاختصاص العام', q.general_specialization)}{field('الاختصاص الدقيق', q.specific_specialization)}
            {field('التخرج', q.graduation_date ? date(q.graduation_date) : supplement?.graduation_year ? staffDigits(supplement.graduation_year, settings) : '')}
          </dl>;
        }) : <p className="dossier-empty">لم تسجّل مؤهلات</p>}
        {unresolved.map(q => <p className="dossier-unresolved" key={q.qualification_key}>تفاصيل مؤهل بحاجة إلى إعادة ربط: القسم {q.department || '—'} · سنة التخرج {q.graduation_year || '—'}</p>)}
      </section>
    </td></tr><tr><td>
      <section className="dossier-section"><h2>03 · الخدمة والتكليفات</h2>
        <dl className="dossier-fields">{field('العنوان الوظيفي', employee.job_title)}{field('الرقم الوظيفي', <bdi dir="ltr">{employee.employee_number}</bdi>)}
          {field('تاريخ التعيين', date(employee.hire_date))}{field('تاريخ المباشرة', date(employee.commencement_date))}
          {field('الراتب الأساسي الحالي', `${staffMoney(employee.salary_amount, settings)} ${settings.currency || 'IQD'}`)}
          {DOSSIER_SERVICE_FIELDS.map(([key, label]) => field(label, key.endsWith('_date') ? date(data[key]) : <bdi dir="auto">{data[key]}</bdi>))}
        </dl>
      </section>
    </td></tr>
      {DOSSIER_HISTORY_KINDS.map(([kind, label], index) => <tr key={kind}><td><section className="dossier-section"><h2>{String(index + 4).padStart(2, '0')} · {label}</h2>
        <table className="dossier-history"><thead><tr>{['التاريخ', 'العنوان / الموضوع', 'رقم الكتاب أو المرجع', 'ملاحظات'].map(text => <th key={text} scope="col">{text}</th>)}</tr></thead>
          <tbody>{data.history[kind].length ? data.history[kind].map((row, rowIndex) => <tr key={rowIndex}><td>{date(row.date)}</td><td>{row.title}</td><td><bdi dir="auto">{row.reference}</bdi></td><td>{row.notes}</td></tr>) : <tr><td colSpan={4} className="dossier-empty">لا توجد قيود مسجلة</td></tr>}</tbody>
        </table>
      </section></td></tr>)}
    <tr><td>
      <section className="dossier-section"><h2>09 · ملاحظات عامة</h2><p className="dossier-notes">{display(data.notes)}</p></section>
    </td></tr><tr><td>
      <footer className="dossier-signatures"><span>توقيع المدرس: ……………………</span><span>تدقيق الإدارة: ……………………</span></footer>
    </td></tr></tbody></table>
  </article>;
}
