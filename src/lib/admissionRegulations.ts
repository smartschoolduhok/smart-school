import {ensure,boundedText} from './schoolWorkflow.ts';
import {checkStudentAge, type BirthDateBounds} from './studentAge.ts';
import {ageInMonths,baghdadDate,validDate} from './admissionDates.ts';
import type {StudentAgeException} from './studentStudyStatus.ts';
export {ageInMonths,baghdadDate,validDate} from './admissionDates.ts';
export type AdmissionProcess='admission'|'transfer_in'|'transfer_out';
export const ADMISSION_PROCESSES:Record<AdmissionProcess,string>={admission:'قبول جديد',transfer_in:'نقل وارد',transfer_out:'نقل صادر'};
export interface AdmissionRules {
 age_reference_date:string;
 age_rule:'bounded'|'birth_date'|'not_applicable'|'review';min_age_months:number|null;max_age_months:number|null;
 birth_date_bounds?:{male:BirthDateBounds;female:BirthDateBounds};
 age_scope?:'entry_only'|'continuing';
 age_notes?:string;
 repeat_rule:'bounded'|'not_applicable'|'review';max_previous_repeats:number|null;
 acceleration:'allowed'|'prohibited'|'review';required_documents:string[];
}
export interface RegulationRecord {regulation_key:string;academic_year_id:number;class_id:number;process:AdmissionProcess;version:number;title:string;jurisdiction:string;source_reference:string;source_url:string;effective_from:string;effective_to:string;rules:AdmissionRules;status:'draft'|'approved'|'retired';revision:number;}
function optionalNumber(value:unknown,max:number){if(value===null)return null;ensure(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max,'invalid_rule','قيمة القاعدة غير صالحة');return value;}
export function parseAdmissionRules(raw:unknown):AdmissionRules {
 ensure(raw&&typeof raw==='object'&&!Array.isArray(raw),'invalid_rules','قواعد اللائحة غير صالحة');const r=raw as Record<string,any>;
 const keys=['age_reference_date','age_rule','min_age_months','max_age_months','repeat_rule','max_previous_repeats','acceleration','required_documents'];
 const optionalKeys=['birth_date_bounds','age_scope','age_notes'];
 ensure(Object.keys(r).every(k=>keys.includes(k)||optionalKeys.includes(k))&&keys.every(k=>k in r),'invalid_rules','حقول اللائحة غير مكتملة');
 ensure(['bounded','birth_date','not_applicable','review'].includes(r.age_rule)&&['bounded','not_applicable','review'].includes(r.repeat_rule)&&['allowed','prohibited','review'].includes(r.acceleration),'invalid_rules','حدد طريقة معالجة كل شرط');
 const min=optionalNumber(r.min_age_months,1200),max=optionalNumber(r.max_age_months,1200),repeats=optionalNumber(r.max_previous_repeats,30);
 ensure(r.age_rule!=='bounded'||min!=null||max!=null,'invalid_rules','حدد حدًا عمريًا واحدًا على الأقل');ensure(min==null||max==null||min<=max,'invalid_rules','حد العمر الأدنى أكبر من الأعلى');
 ensure(r.repeat_rule!=='bounded'||repeats!=null,'invalid_rules','حدد عدد سنوات الإعادة');
 ensure(Array.isArray(r.required_documents)&&r.required_documents.length<=20,'invalid_rules','المستندات المطلوبة غير صالحة');
 const docs=r.required_documents.map((x:unknown)=>boundedText(x,100));ensure(new Set(docs).size===docs.length,'invalid_rules','المستندات مكررة');
 const extra:Pick<AdmissionRules,'birth_date_bounds'|'age_scope'|'age_notes'>={};
 if(r.age_scope!==undefined){ensure(['entry_only','continuing'].includes(r.age_scope),'invalid_rules','نطاق العمر غير صالح');extra.age_scope=r.age_scope;}
 if(r.age_notes!==undefined)extra.age_notes=boundedText(r.age_notes,1500);
 if(r.birth_date_bounds!==undefined||r.age_rule==='birth_date'){
  const bounds=r.birth_date_bounds;ensure(bounds&&typeof bounds==='object'&&!Array.isArray(bounds)&&Object.keys(bounds).length===2&&'male' in bounds&&'female' in bounds,'invalid_rules','حدد حدود مواليد الذكور والإناث');
  const parse=(v:Record<string,unknown>):BirthDateBounds=>{ensure(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===2&&'earliest' in v&&'latest' in v,'invalid_rules','حدود المواليد غير صالحة');const earliest=v.earliest===null?null:validDate(v.earliest),latest=v.latest===null?null:validDate(v.latest);ensure(earliest||latest,'invalid_rules','حدد حد مواليد واحدًا على الأقل');ensure(!earliest||!latest||earliest<=latest,'invalid_rules','حدود المواليد متعاكسة');return {earliest,latest};};
  extra.birth_date_bounds={male:parse(bounds.male),female:parse(bounds.female)};
 }
 return {age_reference_date:validDate(r.age_reference_date),age_rule:r.age_rule,min_age_months:min,max_age_months:max,repeat_rule:r.repeat_rule,max_previous_repeats:repeats,acceleration:r.acceleration,required_documents:docs,...extra};
}
export interface EligibilityResult {decision:'eligible'|'ineligible'|'review';issues:string[];age_months:number|null;}
export function evaluateAdmission(rules:AdmissionRules|null,input:{birth_date:string|null;gender?:string|null;today?:string;class_id?:number|null;age_exception?:StudentAgeException|null;previous_repeats:number|null;accelerated:boolean|null;documents:string[]}):EligibilityResult {
 if(!rules)return {decision:'review',issues:['لا توجد لائحة معتمدة وسارية لهذا الصف والسنة ونوع الطلب'],age_months:null};
 const review:string[]=[],blocked:string[]=[];let age:number|null=null;
 if(rules.age_rule==='review')review.push('شرط العمر يحتاج مراجعة');
 if(rules.age_rule==='bounded'||rules.age_rule==='birth_date'){
  const check=checkStudentAge(rules,{birth_date:input.birth_date,gender:input.gender,today:input.today??baghdadDate(),class_id:input.class_id,age_exception:input.age_exception});age=check.age_months;
  if(check.status==='outside_limits')blocked.push(...check.issues);else if(check.status!=='within_limits'&&check.status!=='documented_exception')review.push(...check.issues);
 }
 if(rules.repeat_rule==='review')review.push('سنوات الإعادة تحتاج مراجعة');
 if(rules.repeat_rule==='bounded'){if(input.previous_repeats==null)review.push('عدد سنوات الإعادة غير مثبت');else if(input.previous_repeats>rules.max_previous_repeats!)blocked.push('سنوات الإعادة تتجاوز الحد الموثق');}
 if(input.accelerated==null)review.push('حالة التسريع غير مثبتة');else if(input.accelerated){if(rules.acceleration==='prohibited')blocked.push('التسريع غير مسموح وفق اللائحة');else if(rules.acceleration==='review')review.push('التسريع يحتاج مستند اعتماد');}
 for(const d of rules.required_documents)if(!input.documents.includes(d))review.push(`مستند غير متحقق: ${d}`);
 return {decision:blocked.length?'ineligible':review.length?'review':'eligible',issues:[...blocked,...review],age_months:age};
}
