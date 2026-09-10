import {useEffect,useMemo,useState} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import {SystemAdminSchoolSelector} from '../../components/SystemAdminSchoolSelector';
import {DocumentFooter,PrintLayout,QRBlock,usePrintExport} from '../../components/print';
import {useAuth} from '../../hooks/useAuth';
import {useSchoolRequestGuard} from '../../hooks/useSchoolRequestGuard';
import {useTenantSchool} from '../../hooks/useTenantSchool';
import {getFeeReceipt,getParentFeeReceipt,markReceiptPrinted} from '../../lib/api';
import {toArabicDigits} from '../../lib/arabicDigits';
import {formatFinanceDate,formatIqd,formatPercentageBasisPoints,installmentStatusLabel,paymentMethodLabel} from '../../lib/financePresentation';
import {FINANCE_ACCESS_ROLES,hasRole} from '../../lib/rbac';

interface PaymentSnapshot {fee_type?:string;payment_method?:string;amount?:number;payment_date?:number;notes?:string|null}
interface ReceiptRecord {
  id:number;school_id:number;student_id:number;receipt_number:string;student_name_snapshot:string;student_number_snapshot?:string;
  class_name_snapshot?:string;section_name_snapshot?:string;school_name_snapshot:string;academic_year_snapshot?:string;
  total_amount:number;currency?:string;currency_snapshot?:string;status:string;verification_token:string;created_at:number;
  received_by_snapshot?:string;replaces_receipt_id?:number|null;payments_snapshot?:PaymentSnapshot[];
  settings_snapshot?:Record<string,any>;settings_snapshot_json?:string;financial_summary_snapshot?:Record<string,any>|null;
  installment_plan_snapshot?:Array<Record<string,any>>;
}

export default function PrintReceiptPage(){
  const {id}=useParams<{id:string}>(),navigate=useNavigate(),{user,isLoading:authLoading}=useAuth();
  const schoolScope=useTenantSchool(),{schoolId}=schoolScope,captureSchoolRequest=useSchoolRequestGuard(schoolId);
  const [loadedReceipt,setReceipt]=useState<ReceiptRecord|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const receipt=loadedReceipt?.school_id===schoolId&&loadedReceipt?.id===Number(id)?loadedReceipt:null;
  const isParent=user?.role_key==='parent',canManagePrint=hasRole(user?.role_key,FINANCE_ACCESS_ROLES);
  const snapshot=useMemo(()=>{if(receipt?.settings_snapshot)return receipt.settings_snapshot;try{return JSON.parse(receipt?.settings_snapshot_json||'{}');}catch{return {};}},[receipt]);
  const financial=receipt?.financial_summary_snapshot||{currency:snapshot.currency||receipt?.currency_snapshot||receipt?.currency,
    original_fee:receipt?.total_amount||0,discount_amount:0,net_due:receipt?.total_amount||0,paid_before:0,this_payment:receipt?.total_amount||0,
    total_paid:receipt?.total_amount||0,remaining_after:0,payment_ratio_basis_points:10000};
  const plans=receipt?.installment_plan_snapshot||[],payments=receipt?.payments_snapshot||[];
  const useArabic=snapshot.use_arabic_indic_digits!==false,ratio=Math.min(100,Math.max(0,Number(financial.payment_ratio_basis_points||0)/100));
  const base=typeof window!=='undefined'?window.location.origin:'',verificationUrl=receipt?.verification_token?`${base}/verify/receipt/${receipt.verification_token}`:'';
  const money=(value:number|undefined|null)=>financial.currency==='IQD'||receipt?.currency_snapshot==='IQD'||snapshot.currency==='IQD'
    ? formatIqd(value,useArabic)
    : `${new Intl.NumberFormat(useArabic?'ar-IQ':'en-US',{maximumFractionDigits:2}).format(Number(value||0))} ${financial.currency||'عملة السجل'}`;

  const {handlePrint,isPrinting,error:printError}=usePrintExport({documentTitle:receipt?.receipt_number?`إيصال ${receipt.receipt_number}`:'إيصال قسط دراسي',onBeforePrint:async()=>{
    if(!receipt||schoolId!==receipt.school_id)throw new Error('الإيصال غير متاح للطباعة');
    if(canManagePrint&&receipt.status==='active'){const result=await markReceiptPrinted(receipt.id,schoolId);if(result.error)throw new Error(result.error);}
  }});

  useEffect(()=>{
    setReceipt(null);if(authLoading)return;if(!user){navigate('/login');return;}
    if(!isParent&&!canManagePrint){setError('غير مسموح: لا تملك صلاحية عرض هذا الإيصال');setLoading(false);return;}
    if(!id||schoolId==null){setLoading(false);return;}
    const isCurrent=captureSchoolRequest();let cancelled=false;setLoading(true);setError(null);
    void (isParent?getParentFeeReceipt(id):getFeeReceipt(id,schoolId)).then(response=>{if(cancelled||!isCurrent())return;if(response.error)setError(response.error);else if(response.data)setReceipt(response.data as ReceiptRecord);setLoading(false);});
    return()=>{cancelled=true;};
  },[authLoading,user?.id,user?.role_key,navigate,id,schoolId,captureSchoolRequest,isParent,canManagePrint]);

  if(!authLoading&&schoolId==null)return <div className="p-6"><SystemAdminSchoolSelector {...schoolScope}/><p>اختر المدرسة لعرض الإيصال.</p></div>;
  if(loading)return <div className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-600">جاري التحميل...</div>;
  if(error)return <div className="flex min-h-screen items-center justify-center bg-gray-100"><div className="rounded-xl bg-white p-6 text-center shadow"><div className="mb-2 font-bold text-red-600">{error}</div><button onClick={()=>navigate(-1)} className="rounded bg-gray-100 px-4 py-2 text-sm">رجوع</button></div></div>;
  if(!receipt)return <div className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-600">الإيصال غير موجود</div>;

  return <PrintLayout size="A4" onPrint={isPrinting?undefined:handlePrint} className="receipt-a4-sheet relative overflow-hidden" backButton={<button onClick={()=>navigate(-1)} className="rounded-md bg-gray-100 px-3 py-2 text-sm">رجوع</button>}>
    {printError&&<p role="alert" className="mb-3 text-red-700 print:hidden">{printError}</p>}
    {receipt.status==='cancelled'&&<div className="pointer-events-none absolute inset-0 z-20 flex rotate-[-28deg] items-center justify-center text-7xl font-black text-red-600/15">إيصال ملغى</div>}
    <header className="grid grid-cols-[105px_1fr_105px] items-center gap-4 border-b-4 border-teal-700 pb-4">
      <div className="flex h-24 items-center justify-center">{snapshot.use_logo&&snapshot.logo_url?<img src={snapshot.logo_url} alt="شعار المدرسة" className="max-h-24 max-w-24 object-contain"/>:<div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-teal-700 text-center text-xs font-bold text-teal-800">SMART<br/>SCHOOL</div>}</div>
      <div className="text-center"><h1 className="text-xl font-black text-gray-900">{snapshot.school_name||receipt.school_name_snapshot||'المدرسة'}</h1>{snapshot.principal_name&&<p className="mt-1 text-xs text-gray-600">الإدارة: {snapshot.principal_name}</p>}<h2 className="mt-3 text-2xl font-black text-teal-800">إيصال استلام قسط دراسي</h2><p className="mt-1 text-sm text-gray-600">العام الدراسي: {toArabicDigits(receipt.academic_year_snapshot||'—')}</p></div>
      <QRBlock url={verificationUrl} label="امسح للتحقق"/>
    </header>

    <div className="mt-4 grid grid-cols-4 overflow-hidden rounded-xl border border-gray-300 text-sm"><div className="bg-gray-100 p-2 font-bold">رقم الإيصال</div><div className="col-span-3 p-2 font-mono font-bold" dir="ltr"><bdi>{receipt.receipt_number}</bdi></div><div className="bg-gray-100 p-2 font-bold">الطالب</div><div className="p-2 font-semibold">{receipt.student_name_snapshot}</div><div className="bg-gray-100 p-2 font-bold">رقم الطالب</div><div className="p-2 font-mono" dir="ltr"><bdi>{receipt.student_number_snapshot||'—'}</bdi></div><div className="bg-gray-100 p-2 font-bold">الصف</div><div className="p-2">{receipt.class_name_snapshot||'—'}</div><div className="bg-gray-100 p-2 font-bold">الشعبة</div><div className="p-2">{receipt.section_name_snapshot||'—'}</div></div>
    {receipt.replaces_receipt_id&&<div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">هذا إيصال بديل مرتبط بإيصال ملغى سابق.</div>}
    {receipt.status==='cancelled'&&<div className="mt-3 rounded-lg border-2 border-red-500 bg-red-50 py-2 text-center font-black text-red-700">ملغى — غير صالح للاستخدام الرسمي</div>}

    <section className="mt-4 grid grid-cols-[1fr_112px] gap-4">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-gray-300 text-sm">{[
        ['الرسوم الأصلية',financial.original_fee],['الخصم',financial.discount_amount],['صافي المستحق',financial.net_due],['المدفوع سابقًا',financial.paid_before],['هذه الدفعة',financial.this_payment],['إجمالي المدفوع',financial.total_paid],['المتبقي بعد الدفع',financial.remaining_after],
      ].map(([label,value],index)=><div key={String(label)} className={`flex items-center justify-between gap-2 p-2.5 ${index%2===0?'border-l':''} ${index<6?'border-b':''} ${label==='هذه الدفعة'?'bg-teal-50 font-black text-teal-800':''}`}><span className="font-semibold text-gray-700">{label}</span><span className="whitespace-nowrap font-bold">{money(Number(value||0))}</span></div>)}</div>
      <div className="flex flex-col items-center justify-center rounded-xl border border-teal-200 bg-teal-50 p-3"><div className="flex h-20 w-20 items-center justify-center rounded-full" style={{background:`conic-gradient(#0f766e ${ratio}%, #d1fae5 0)`}}><div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sm font-black text-teal-800">{ratio.toLocaleString(useArabic?'ar-IQ':'en-US',{maximumFractionDigits:2})}%</div></div><p className="mt-2 text-xs font-bold text-teal-800">نسبة التسديد</p></div>
    </section>

    {plans.length>0&&<section className="receipt-table-section mt-4"><h3 className="mb-2 border-r-4 border-amber-500 pr-2 text-sm font-black">خطة التقسيط</h3><table className="print-table text-xs"><thead><tr><th>الدفعة</th><th>النسبة</th><th>المبلغ</th><th>تاريخ الاستحقاق</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>{plans.flatMap((plan:any)=>plan.items||[]).map((item:any)=><tr key={`${item.id}-${item.sequence_no}`}><td>{item.label}</td><td>{formatPercentageBasisPoints(item.percentage_basis_points,useArabic)}</td><td>{money(item.amount)}</td><td>{formatFinanceDate(item.due_date)}</td><td>{money(item.paid_amount)}</td><td>{money(item.remaining_amount)}</td><td>{installmentStatusLabel(item.status)}</td></tr>)}</tbody></table></section>}

    <section className="receipt-table-section mt-4"><h3 className="mb-2 border-r-4 border-teal-700 pr-2 text-sm font-black">تفاصيل الدفعة الحالية</h3><table className="print-table text-xs"><thead><tr><th>#</th><th>نوع القسط</th><th>طريقة الدفع</th><th>المبلغ</th><th>التاريخ</th><th>ملاحظات</th></tr></thead><tbody>{payments.length===0?<tr><td colSpan={6}>لا توجد تفاصيل دفعة محفوظة</td></tr>:payments.map((payment,index)=><tr key={index}><td>{toArabicDigits(String(index+1))}</td><td>{payment.fee_type||'—'}</td><td>{paymentMethodLabel(payment.payment_method)}</td><td>{money(payment.amount)}</td><td>{formatFinanceDate(payment.payment_date)}</td><td>{payment.notes||'—'}</td></tr>)}</tbody></table></section>

    <section className="mt-7 grid grid-cols-3 gap-8 text-center text-sm"><div><p className="font-bold">المستلم</p><p className="mt-2 text-gray-700">{receipt.received_by_snapshot||'—'}</p><div className="mx-auto mt-8 w-32 border-t border-gray-500"/></div><div><p className="font-bold">التوقيع</p><div className="mx-auto mt-12 w-32 border-t border-gray-500"/></div><div><p className="font-bold">الختم الرسمي</p>{snapshot.use_stamp&&snapshot.stamp_url?<img src={snapshot.stamp_url} alt="الختم الرسمي" className="mx-auto mt-2 max-h-20 max-w-24 object-contain"/>:<div className="mx-auto mt-4 h-16 w-24 rounded-full border border-dashed border-gray-400"/>}</div></section>
    <DocumentFooter footerText={snapshot.receipt_footer_text||null} printedAt={new Date().toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})} printedBy={receipt.received_by_snapshot} verificationNote={snapshot.verification_note||snapshot.verification_note_text||'يمكن التحقق من حالة الإيصال عبر رمز QR.'}/>
  </PrintLayout>;
}
