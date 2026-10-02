import type { SalaryReceiptsResponse } from '../../types/employees';
import { StaffDocumentFrame } from './StaffDocumentFrame';
import { receiptTotals, SALARY_ROW_LABELS, SALARY_STATUS_LABELS, staffDate, staffDigits, staffMoney } from './documentHelpers';
import { useDocumentPagination } from './useDocumentPagination';

export function SalaryReceiptsDocument({summary}: {summary: SalaryReceiptsResponse}) {
  const {container, pages} = useDocumentPagination(summary.rows, 12, 175, 'tbody tr[data-record-id]', 31);
  const settings = summary.document_settings;
  const totals = receiptTotals(summary.rows);
  return <div ref={container} className="staff-document salary-receipts-document" dir="rtl" lang="ar">{pages.map((rows, pageIndex) => <StaffDocumentFrame key={pageIndex} metadata={summary} title="كشف استلام الرواتب" subtitle={`${SALARY_STATUS_LABELS[summary.status]} — ${staffDigits(`${summary.month}/${summary.year}`, settings)} — العملة: ${settings.currency}`} pageIndex={pageIndex} pageCount={pages.length} landscape>
    <table className="salary-receipts-table">
      <caption className="sr-only">رواتب الشهر المحفوظة وخانات توقيع الاستلام</caption>
      <colgroup><col style={{width: '4%'}}/><col style={{width: '7%'}}/><col style={{width: '19%'}}/><col style={{width: '10%'}}/><col style={{width: '9%'}}/><col style={{width: '9%'}}/><col style={{width: '11%'}}/><col style={{width: '7%'}}/><col style={{width: '11%'}}/><col style={{width: '13%'}}/></colgroup>
      <thead><tr>{['ت', 'الرقم الوظيفي', 'اسم الموظف', 'الراتب الأساسي', 'الإضافات', 'الاستقطاعات', 'الصافي', 'الحالة', 'تاريخ الاستلام', 'التوقيع'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.id} data-record-id={row.id} data-salary-id={row.id} className={row.status === 'cancelled' ? 'salary-row-cancelled' : ''}>
        <td>{staffDigits(pages.slice(0, pageIndex).reduce((sum, page) => sum + page.length, 0) + index + 1, settings)}</td><td>{staffDigits(row.employee_number || 'غير مسجل', settings)}</td>
        <th scope="row">{row.employee_name || 'غير مسجل'}{row.employee_status === 'archived' && <small>موظف مؤرشف</small>}</th>
        {[row.base_salary, row.bonus_amount, row.deduction_amount, row.net_salary].map((amount, i) => <td key={i}><bdi>{staffMoney(amount, settings)}</bdi></td>)}
        <td>{SALARY_ROW_LABELS[row.status] || row.status}</td><td>{row.status === 'paid' ? staffDate(row.payment_business_date || row.paid_at, settings, 'غير مسجل') : '—'}</td>
        <td className="salary-receipt-signature" aria-label={`توقيع ${row.employee_name || 'الموظف'}`} />
      </tr>)}</tbody>
      {pageIndex === pages.length - 1 && <tfoot><tr><th colSpan={3}>الإجمالي دون الملغاة ({staffDigits(totals.payable_count, settings)})</th>{[totals.base_salary, totals.bonus_amount, totals.deduction_amount, totals.net_salary].map((amount, i) => <td key={i}><bdi>{staffMoney(amount, settings)}</bdi></td>)}<td colSpan={3}>{settings.currency}</td></tr></tfoot>}
    </table>
    {pageIndex === pages.length - 1 && <div className="salary-receipts-notes"><p>التوقيع مخصص للاستلام الورقي. طباعة الكشف لا تثبت الدفع في النظام.</p>{summary.missing_employee_count > 0 && <p>رواتب غير مولدة لـ {staffDigits(summary.missing_employee_count, settings)} موظف نشط؛ لا تدخل في هذا الكشف.</p>}<p>إعداد: ………………………… <span>تدقيق: …………………………</span></p></div>}
  </StaffDocumentFrame>)}</div>;
}
