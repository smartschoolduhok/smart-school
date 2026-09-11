export const PAYMENT_METHOD_LABELS: Record<string,string> = {
  cash:'نقدي',bank_transfer:'تحويل بنكي',cheque:'شيك',credit_card:'بطاقة ائتمان',
  debit_card:'بطاقة خصم',mobile_payment:'محفظة إلكترونية',other:'أخرى',
};

export const INSTALLMENT_STATUS_LABELS: Record<string,string> = {
  paid:'مسدد',partial:'مسدد جزئيًا',overdue:'متأخر',upcoming:'قادم',
};

export function paymentMethodLabel(value:string|undefined|null) {
  return PAYMENT_METHOD_LABELS[value??'']??'أخرى';
}

export function installmentStatusLabel(value:string|undefined|null) {
  return INSTALLMENT_STATUS_LABELS[value??'']??'غير محدد';
}

export function installmentStatusClasses(value:string|undefined|null) {
  if(value==='paid') return 'bg-emerald-100 text-emerald-700';
  if(value==='partial') return 'bg-amber-100 text-amber-800';
  if(value==='overdue') return 'bg-red-100 text-red-700';
  return 'bg-blue-100 text-blue-700';
}

export function formatIqd(value:number|undefined|null,useArabicIndic=true) {
  const amount=Number.isSafeInteger(value)?Number(value):0;
  return `${new Intl.NumberFormat(useArabicIndic?'ar-IQ':'en-US',{maximumFractionDigits:0}).format(amount)} د.ع`;
}

export function formatPercentageBasisPoints(value:number|undefined|null,useArabicIndic=true) {
  const percentage=(Number(value)||0)/100;
  return new Intl.NumberFormat(useArabicIndic?'ar-IQ':'en-US',{maximumFractionDigits:2}).format(percentage)+'%';
}

export function formatFinanceDate(value:number|string|undefined|null) {
  if(value===null||value===undefined||value==='') return '—';
  const date=typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : new Date(Number(value)*1000);
  return Number.isNaN(date.getTime())?'—':date.toLocaleDateString('ar-IQ',{timeZone:'Asia/Baghdad'});
}
