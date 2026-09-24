import {ensure,boundedText} from './schoolWorkflow.ts';
export type AdmissionProcess='admission'|'transfer_in'|'transfer_out';
export const ADMISSION_PROCESSES:Record<AdmissionProcess,string>={admission:'قبول جديد',transfer_in:'نقل وارد',transfer_out:'نقل صادر'};
export interface AdmissionRules {
 age_reference_date:string;
 age_rule:'bounded'|'not_applicable'|'review';min_age_months:number|null;max_age_months:number|null;
 repeat_rule:'bounded'|'not_applicable'|'review';max_previous_repeats:number|null;
 acceleration:'allowed'|'prohibited'|'review';required_documents:string[];
}
export interface RegulationRecord {regulation_key:string;academic_year_id:number;class_id:number;process:AdmissionProcess;version:number;title:string;jurisdiction:string;source_reference:string;source_url:string;effective_from:string;effective_to:string;rules:AdmissionRules;status:'draft'|'approved'|'retired';revision:number;}
export function validDate(value:unknown):string {ensure(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,'invalid_date','التاريخ غير صالح');return value;}
export function baghdadDate(){return new Date(Date.now()+3*3600_000).toISOString().slice(0,10);}
function optionalNumber(value:unknown,max:number){if(value===null)return null;ensure(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max,'invalid_rule','قيمة القاعدة غير صالحة');return value;}
export function parseAdmissionRules(raw:unknown):AdmissionRules {
 ensure(raw&&typeof raw==='object'&&!Array.isArray(raw),'invalid_rules','قواعد اللائحة غير صالحة');const r=raw as Record<string,any>;
 const keys=['age_reference_date','age_rule','min_age_months','max_age_months','repeat_rule','max_previous_repeats','acceleration','required_documents'];
 ensure(Object.keys(r).every(k=>keys.includes(k))&&keys.every(k=>k in r),'invalid_rules','حقول اللائحة غير مكتملة');
 ensure(['bounded','not_applicable','review'].includes(r.age_rule)&&['bounded','not_applicable','review'].includes(r.repeat_rule)&&['allowed','prohibited','review'].includes(r.acceleration),'invalid_rules','حدد طريقة معالجة كل شرط');
 const min=optionalNumber(r.min_age_months,1200),max=optionalNumber(r.max_age_months,1200),repeats=optionalNumber(r.max_previous_repeats,30);
 ensure(r.age_rule!=='bounded'||min!=null||max!=null,'invalid_rules','حدد حدًا عمريًا واحدًا على الأقل');ensure(min==null||max==null||min<=max,'invalid_rules','حد العمر الأدنى أكبر من الأعلى');
 ensure(r.repeat_rule!=='bounded'||repeats!=null,'invalid_rules','حدد عدد سنوات الإعادة');
 ensure(Array.isArray(r.required_documents)&&r.required_documents.length<=20,'invalid_rules','المستندات المطلوبة غير صالحة');
 const docs=r.required_documents.map((x:unknown)=>boundedText(x,100));ensure(new Set(docs).size===docs.length,'invalid_rules','المستندات مكررة');
 return {age_reference_date:validDate(r.age_reference_date),age_rule:r.age_rule,min_age_months:min,max_age_months:max,repeat_rule:r.repeat_rule,max_previous_repeats:repeats,acceleration:r.acceleration,required_documents:docs};
}
export function ageInMonths(birth:string,reference:string):number {const b=validDate(birth).split('-').map(Number),r=validDate(reference).split('-').map(Number);return (r[0]-b[0])*12+r[1]-b[1]-(r[2]<b[2]?1:0);}
export interface EligibilityResult {decision:'eligible'|'ineligible'|'review';issues:string[];age_months:number|null;}
export function evaluateAdmission(rules:AdmissionRules|null,input:{birth_date:string|null;previous_repeats:number|null;accelerated:boolean|null;documents:string[]}):EligibilityResult {
 if(!rules)return {decision:'review',issues:['لا توجد لائحة معتمدة وسارية لهذا الصف والسنة ونوع الطلب'],age_months:null};
 const review:string[]=[],blocked:string[]=[];let age:number|null=null;
 if(rules.age_rule==='review')review.push('شرط العمر يحتاج مراجعة');
 if(rules.age_rule==='bounded'){
  if(!input.birth_date)review.push('تاريخ الميلاد غير مثبت');
  else {try{age=ageInMonths(input.birth_date,rules.age_reference_date);if(age<0)review.push('تاريخ الميلاد بعد تاريخ احتساب العمر');else if((rules.min_age_months!=null&&age<rules.min_age_months)||(rules.max_age_months!=null&&age>rules.max_age_months))blocked.push('العمر خارج الحدود الموثقة');}catch{review.push('تاريخ الميلاد غير صالح');}}
 }
 if(rules.repeat_rule==='review')review.push('سنوات الإعادة تحتاج مراجعة');
 if(rules.repeat_rule==='bounded'){if(input.previous_repeats==null)review.push('عدد سنوات الإعادة غير مثبت');else if(input.previous_repeats>rules.max_previous_repeats!)blocked.push('سنوات الإعادة تتجاوز الحد الموثق');}
 if(input.accelerated==null)review.push('حالة التسريع غير مثبتة');else if(input.accelerated){if(rules.acceleration==='prohibited')blocked.push('التسريع غير مسموح وفق اللائحة');else if(rules.acceleration==='review')review.push('التسريع يحتاج مستند اعتماد');}
 for(const d of rules.required_documents)if(!input.documents.includes(d))review.push(`مستند غير متحقق: ${d}`);
 return {decision:blocked.length?'ineligible':review.length?'review':'eligible',issues:[...blocked,...review],age_months:age};
}
