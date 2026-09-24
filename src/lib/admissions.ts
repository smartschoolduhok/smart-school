import type {AdmissionProcess,EligibilityResult} from './admissionRegulations';
import {boundedText,ensure} from './schoolWorkflow.ts';
export interface AdmissionFacts {previous_repeats:number|null;accelerated:boolean|null;documents:string[];}
export interface AdmissionApplicant {full_name:string;student_number:string;gender:'male'|'female';birth_date:string|null;}
export interface AdmissionApplication {application_key:string;student_id:number|null;applicant:AdmissionApplicant|null;student_name:string;academic_year_id:number;class_id:number;section_id:number|null;process:AdmissionProcess;external_school:string|null;document_reference:string|null;facts:AdmissionFacts;status:'submitted'|'approved'|'rejected'|'cancelled'|'executed';revision:number;}
export interface AdmissionPreview {eligibility:EligibilityResult;operational_issues:string[];can_approve:boolean;preview_digest:string;regulation:{title:string;version:number;source_reference:string;source_url:string}|null;}
export function parseAdmissionFacts(raw:unknown):AdmissionFacts {
 ensure(raw&&typeof raw==='object'&&!Array.isArray(raw),'invalid_facts','بيانات الطلب غير صالحة');const r=raw as Record<string,any>;
 ensure(Object.keys(r).every(k=>['previous_repeats','accelerated','documents'].includes(k)),'invalid_facts','حقول غير معروفة');
 ensure(r.previous_repeats===null||(typeof r.previous_repeats==='number'&&Number.isInteger(r.previous_repeats)&&r.previous_repeats>=0&&r.previous_repeats<=30),'invalid_repeats','عدد سنوات الإعادة غير صالح');
 ensure(r.accelerated===null||typeof r.accelerated==='boolean','invalid_acceleration','حالة التسريع غير صالحة');
 ensure(Array.isArray(r.documents)&&r.documents.length<=20,'invalid_documents','قائمة المستندات غير صالحة');const docs=r.documents.map((d:unknown)=>boundedText(d,100));ensure(new Set(docs).size===docs.length,'invalid_documents','المستندات مكررة');
 return {previous_repeats:r.previous_repeats,accelerated:r.accelerated,documents:docs};
}
