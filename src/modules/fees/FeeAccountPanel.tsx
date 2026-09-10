import {useCallback,useEffect,useMemo,useState} from 'react';
import {AlertTriangle,CalendarDays,Check,Plus,ReceiptText,Trash2,Wallet,X} from 'lucide-react';
import {disableFeeInstallmentPlan,getStudentFinance,saveFeeInstallmentPlan} from '../../lib/api';
import {formatFinanceDate,formatIqd,formatPercentageBasisPoints,installmentStatusClasses,installmentStatusLabel} from '../../lib/financePresentation';

interface FeeRecord {
  id:number;student_id:number;student_name?:string;student_number?:string;fee_type:string;amount:number;paid_amount:number;
  net_fee?:number;discount_amount?:number;currency:string;finance_revision?:number;
}
interface DraftItem {label:string;amount:string;due_date:string}
interface Props {
  fee:FeeRecord;schoolId:number;onClose:()=>void;onCollect:(fee:any)=>void;onEdit:(fee:any)=>void;onDelete:(id:number)=>void;onChanged:()=>void;
}

function isoDateFromUnix(value:unknown) {
  const date=new Date(Number(value||Date.now()/1000)*1000);
  return Number.isNaN(date.getTime())?new Date().toISOString().slice(0,10):date.toISOString().slice(0,10);
}
function addMonths(value:string,months:number) {
  const [year,month,day]=value.split('-').map(Number),target=new Date(Date.UTC(year,month-1+months,1));
  const lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(day,lastDay));return target.toISOString().slice(0,10);
}

export default function FeeAccountPanel({fee,schoolId,onClose,onCollect,onEdit,onDelete,onChanged}:Props){
  const [account,setAccount]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [editorOpen,setEditorOpen]=useState(false),[saving,setSaving]=useState(false),[draft,setDraft]=useState<DraftItem[]>([]),[notes,setNotes]=useState('');
  const load=useCallback(async()=>{setLoading(true);setError('');const response=await getStudentFinance(fee.student_id,schoolId);if(response.error)setError(response.error);else setAccount(response.data);setLoading(false);},[fee.student_id,schoolId]);
  useEffect(()=>{void load();},[load]);
  const currentFee=account?.fees?.find((item:any)=>item.id===fee.id)??fee;
  const plan=currentFee?.installment_plan??null;
  const net=Number(currentFee.net_fee??currentFee.amount),remaining=Math.max(0,net-Number(currentFee.paid_amount||0));
  const draftTotal=useMemo(()=>draft.reduce((sum,item)=>sum+( /^\d+$/.test(item.amount)?Number(item.amount):0),0),[draft]);

  function equalDraft(count=3){
    const base=Math.floor(net/count),remainder=net-base*count,first=isoDateFromUnix((currentFee as any).due_date);
    setDraft(Array.from({length:count},(_,index)=>({label:`الدفعة ${index+1}`,amount:String(base+(index===count-1?remainder:0)),due_date:addMonths(first,index)})));
  }
  function openEditor(){
    if(plan){setDraft(plan.items.map((item:any)=>({label:item.label,amount:String(item.amount),due_date:item.due_date})));setNotes(plan.notes||'');}
    else {equalDraft(3);setNotes('');}
    setEditorOpen(true);setError('');
  }
  function updateItem(index:number,key:keyof DraftItem,value:string){setDraft(items=>items.map((item,itemIndex)=>itemIndex===index?{...item,[key]:value}:item));}
  async function save(){
    if(draftTotal!==net){setError('يجب أن يساوي مجموع الدفعات صافي القسط تمامًا.');return;}
    setSaving(true);setError('');const response=await saveFeeInstallmentPlan(fee.id,{school_id:schoolId,expected_fee_revision:Number(currentFee.finance_revision??0),notes:notes||null,items:draft.map(item=>({...item,amount:Number(item.amount)}))});
    setSaving(false);if(response.error){setError(response.error);return;}setEditorOpen(false);await load();onChanged();
  }
  async function disable(){
    if(!plan||!window.confirm('تعطيل خطة التقسيط الحالية؟ سيبقى سجلها محفوظًا.'))return;
    setSaving(true);setError('');const response=await disableFeeInstallmentPlan(fee.id,schoolId,plan.id);setSaving(false);
    if(response.error){setError(response.error);return;}await load();onChanged();
  }
  return <section className="rounded-2xl border border-primary-200 bg-primary-50/30 p-4 sm:p-5" aria-label="حساب الطالب المالي">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold text-primary-700">حساب الطالب المالي</p><h2 className="text-lg font-bold text-gray-900">{fee.student_name} — {fee.fee_type}</h2><p className="text-xs text-gray-500" dir="ltr">{fee.student_number}</p></div>
      <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-white" aria-label="إغلاق حساب الطالب"><X size={18}/></button>
    </div>
    {error&&<div role="alert" className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={18}/>{error}</div>}
    {loading?<p className="py-8 text-center text-sm text-gray-500">جاري تحميل الحساب...</p>:<>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[['إجمالي حساب الطالب',account?.totals?.net_due],['المدفوع الكلي',account?.totals?.paid_amount],['المتبقي الكلي',account?.totals?.remaining_amount],['صافي هذا القسط',net],['متبقي هذا القسط',remaining]].map(([label,value])=><div key={String(label)} className="rounded-xl border border-gray-100 bg-white p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 font-bold text-gray-900">{formatIqd(Number(value||0))}</p></div>)}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4"><div><h3 className="font-bold text-gray-900">خطة التقسيط</h3><p className="text-xs text-gray-500">اختيارية؛ الدفعات الفعلية تبقى مسجلة في الخزنة.</p></div><div className="flex gap-2"><button type="button" onClick={openEditor} className="rounded-lg border border-primary-200 px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50">{plan?'تعديل الخطة':'إنشاء خطة'}</button>{plan&&<button type="button" onClick={()=>void disable()} disabled={saving} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50">تعطيل</button>}</div></div>
        {!plan?<p className="p-5 text-center text-sm text-gray-500">لا توجد خطة تقسيط؛ يمكن تحصيل أي دفعة ضمن المتبقي.</p>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="p-3 text-right">الدفعة</th><th className="p-3 text-right">النسبة</th><th className="p-3 text-right">المبلغ</th><th className="p-3 text-right">الاستحقاق</th><th className="p-3 text-right">المتبقي</th><th className="p-3 text-right">الحالة</th></tr></thead><tbody className="divide-y divide-gray-100">{plan.items.map((item:any)=><tr key={item.id}><td className="p-3 font-semibold">{item.label}</td><td className="p-3">{formatPercentageBasisPoints(item.percentage_basis_points)}</td><td className="p-3">{formatIqd(item.amount)}</td><td className="p-3">{formatFinanceDate(item.due_date)}</td><td className="p-3">{formatIqd(item.remaining_amount)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${installmentStatusClasses(item.status)}`}>{installmentStatusLabel(item.status)}</span></td></tr>)}</tbody></table></div>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={remaining<=0} onClick={()=>onCollect(currentFee)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"><Wallet size={17}/>تحصيل دفعة</button><button type="button" onClick={()=>onEdit(currentFee)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700"><ReceiptText size={17}/>تعديل القسط</button><button type="button" onClick={()=>onDelete(fee.id)} className="mr-auto inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50"><Trash2 size={16}/>حذف القسط</button></div>
    </>}
    {editorOpen&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="installment-editor-title"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b p-5"><div><h2 id="installment-editor-title" className="text-lg font-bold">خطة تقسيط {fee.student_name}</h2><p className="text-xs text-gray-500">الصافي المطلوب توزيعه: {formatIqd(net)}</p></div><button type="button" onClick={()=>setEditorOpen(false)} aria-label="إغلاق"><X/></button></div><div className="space-y-4 p-5">
      <div className="flex flex-wrap gap-2"><span className="text-sm text-gray-600">تقسيم سريع:</span>{[2,3,4,6,9,12].map(count=><button key={count} type="button" onClick={()=>equalDraft(count)} className="rounded-full border px-3 py-1 text-xs hover:bg-gray-50">{count} دفعات</button>)}<button type="button" onClick={()=>setDraft(items=>[...items,{label:`الدفعة ${items.length+1}`,amount:'',due_date:items.length?addMonths(items[items.length-1].due_date,1):isoDateFromUnix((currentFee as any).due_date)}])} disabled={draft.length>=24} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs"><Plus size={13}/>إضافة</button></div>
      <div className="space-y-2">{draft.map((item,index)=><div key={index} className="grid gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"><input aria-label={`اسم الدفعة ${index+1}`} value={item.label} onChange={event=>updateItem(index,'label',event.target.value)} className="rounded-lg border px-3 py-2 text-sm"/><input aria-label={`مبلغ الدفعة ${index+1}`} type="number" step="1" min="1" value={item.amount} onChange={event=>updateItem(index,'amount',event.target.value)} className="rounded-lg border px-3 py-2 text-sm"/><label className="relative"><CalendarDays className="pointer-events-none absolute right-2 top-2.5 text-gray-400" size={16}/><input aria-label={`تاريخ الدفعة ${index+1}`} type="date" value={item.due_date} onChange={event=>updateItem(index,'due_date',event.target.value)} className="w-full rounded-lg border py-2 pl-2 pr-8 text-sm"/></label><button type="button" disabled={draft.length===1} onClick={()=>setDraft(items=>items.filter((_,itemIndex)=>itemIndex!==index))} className="rounded-lg p-2 text-red-600 disabled:opacity-30" aria-label={`حذف الدفعة ${index+1}`}><Trash2 size={17}/></button></div>)}</div>
      <label className="block text-sm text-gray-700">ملاحظات الخطة<textarea value={notes} onChange={event=>setNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2"/></label>
      <div className={`rounded-lg p-3 text-sm ${draftTotal===net?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-800'}`}>المجموع: <strong>{formatIqd(draftTotal)}</strong> من {formatIqd(net)} {draftTotal===net&&<Check className="inline" size={16}/>}</div>
    </div><div className="flex justify-end gap-2 border-t p-5"><button type="button" onClick={()=>setEditorOpen(false)} className="rounded-lg px-4 py-2 text-sm">إلغاء</button><button type="button" onClick={()=>void save()} disabled={saving||draftTotal!==net||draft.some(item=>!item.label.trim()||!item.due_date||!/^\d+$/.test(item.amount))} className="rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving?'جاري الحفظ...':'حفظ الخطة'}</button></div></div></div>}
  </section>;
}
