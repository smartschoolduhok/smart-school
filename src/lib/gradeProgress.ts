import { calculateGrades } from './gradeCalculations';
import { normalizeGradeSchemeSettings } from './gradeScheme';
export const PROGRESS_PERIODS = { first_month:'الشهر الأول',second_month:'الشهر الثاني',first_term:'الفصل الأول',mid_year_exam:'نصف السنة',third_month:'الشهر الثالث',fourth_month:'الشهر الرابع',second_term:'الفصل الثاني' } as const;
export type ProgressPeriod=keyof typeof PROGRESS_PERIODS;
export interface GradeProgressSnapshot { student_name:string; student_number:string;year_name:string;class_name:string;section_name:string|null;period:ProgressPeriod;period_label:string;max_grade:number;subjects:Array<{subject_name:string;score:number|null}>;missing_count:number; }
export interface GradeProgressReport { report_key:string;status:'published'|'withdrawn';revision:number;created_at:number;snapshot:GradeProgressSnapshot; }
export function progressSnapshot(source:Record<string,any>,period:ProgressPeriod):GradeProgressSnapshot {
 const settings={max_grade:100,passing_grade:50,exemption_grade:90,...source.settings,minimum_monthly_exams_per_term:source.minimum_monthly};
 const subjects=source.grades.map((g:Record<string,any>)=>{
  const derived=calculateGrades(g,settings);
  const score=period==='first_term'?derived.first_term_average:period==='second_term'?derived.second_term_average:g[period];
  return {subject_name:String(g.subject_name),score:score==null?null:Number(score)};
 });
 return {student_name:source.student_name,student_number:source.student_number,year_name:source.year_name,class_name:source.class_name,section_name:source.section_name,period,period_label:PROGRESS_PERIODS[period],max_grade:Number(settings.max_grade),subjects,missing_count:subjects.filter((s:{score:number|null})=>s.score==null).length};
}
export function progressPeriodEnabled(source:Record<string,any>,period:ProgressPeriod) {
 const s=normalizeGradeSchemeSettings(source.settings);
 if(period==='first_month'||period==='second_month')return s.first_term_input_mode==='monthly';
 if(period==='third_month'||period==='fourth_month')return s.second_term_input_mode==='monthly';
 if(period==='first_term')return s.first_term_input_mode!=='disabled';
 if(period==='second_term')return s.second_term_input_mode!=='disabled';
 return s.mid_year_exam_enabled===1;
}
