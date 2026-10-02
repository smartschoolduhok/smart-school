import type { Employee, EmployeeQualificationInput, EmployeeQualification } from '../types/employees';

export class EmployeeRecordError extends Error {}
const enumValues = {
  gender: ['male','female','other'],
  employee_type: ['teacher','administrator','accountant','registrar','principal','worker','driver','other'],
  salary_type: ['monthly','hourly','daily','weekly','contract','other'],
  role: ['teacher','staff','manager','supervisor','principal','vice_principal','accountant','registrar','administrator','worker','driver','other'],
};
export function employeeDate(value: unknown): string | null {
  if(value == null || value === '') return null;
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1900 || Number(value.slice(0,4)) > 2200 || !Number.isFinite(new Date(value+'T00:00:00Z').getTime()) || new Date(value+'T00:00:00Z').toISOString().slice(0,10) !== value) throw new EmployeeRecordError('التاريخ يجب أن يكون تاريخاً صحيحاً بصيغة YYYY-MM-DD');
  return value;
}
function textField(value: unknown, max: number, required=false): string | null {
  if(value == null || value === '') { if(required) throw new EmployeeRecordError('الاسم والشهادة لا يمكن أن يكونا فارغين'); return null; }
  if(typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new EmployeeRecordError('أحد الحقول النصية غير صالح أو أطول من الحد المسموح');
  return value.trim() || null;
}
export function validateEmployeeQualifications(value: unknown): EmployeeQualificationInput[] {
  if(!Array.isArray(value) || value.length > 12) throw new EmployeeRecordError('المؤهلات يجب أن تكون قائمة لا تتجاوز 12 مؤهلاً');
  const rows=value.map(raw=>{
    if(!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.is_primary !== 'boolean') throw new EmployeeRecordError('بيانات المؤهل غير صالحة');
    return { degree:textField(raw.degree,200,true)!,general_specialization:textField(raw.general_specialization,250),specific_specialization:textField(raw.specific_specialization,250),institution:textField(raw.institution,250),college:textField(raw.college,250),graduation_date:employeeDate(raw.graduation_date),is_primary:raw.is_primary };
  });
  if(rows.length && rows.filter(r=>r.is_primary).length !== 1) throw new EmployeeRecordError('اختر مؤهلاً أساسياً واحداً للسجل المختصر');
  return rows;
}
export function validateEmployeeFields(body: Record<string,unknown>, existing?: Record<string,unknown>): Record<string,unknown> {
  const result:Record<string,unknown>={...existing};
  for(const [field,max] of Object.entries({full_name:200,employee_number:80,phone:60,email:254,address:1000,job_title:200,notes:4000})) {
    if(field in body || !existing) result[field]=textField(body[field],max,field==='full_name');
  }
  if(result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(result.email))) throw new EmployeeRecordError('البريد الإلكتروني غير صالح');
  for(const [field,allowed] of Object.entries(enumValues)) {
    if(!(field in body) && existing) continue;
    const value=body[field] == null || body[field] === '' ? (field==='gender'?null:field==='role'?'staff':field==='salary_type'?'monthly':'other') : body[field];
    if(value !== null && (typeof value !== 'string' || !allowed.includes(value))) throw new EmployeeRecordError('الوظيفة أو نوع الموظف أو الراتب أو الجنس غير صالح');
    result[field]=value;
  }
  for(const field of ['hire_date','commencement_date']) if(field in body || !existing) result[field]=employeeDate(body[field]);
  if('salary_amount' in body || !existing) {
    const salary=body.salary_amount == null || body.salary_amount === '' ? 0 : Number(body.salary_amount);
    if((typeof body.salary_amount !== 'undefined' && typeof body.salary_amount !== 'number' && typeof body.salary_amount !== 'string') || (typeof body.salary_amount === 'string' && body.salary_amount !== '' && !/^\d+$/.test(body.salary_amount.trim())) || !Number.isSafeInteger(salary) || salary < 0) throw new EmployeeRecordError('راتب الموظف يجب أن يكون عدداً صحيحاً آمناً، صفر أو أكبر');
    result.salary_amount=salary;
  }
  return result;
}
export function qualificationRows(db:D1Database,schoolId:number,employeeId:number|undefined,qualifications:EmployeeQualificationInput[],auditOperationId?:string):D1PreparedStatement {
  // For create: the preceding statement inserted the audit row for this employee.
  const employeeSql=employeeId === undefined ? '(SELECT employee_id FROM employee_record_audit WHERE id=last_insert_rowid())' : '?';
  return db.prepare(`INSERT INTO employee_qualifications(school_id,employee_id,degree,general_specialization,specific_specialization,institution,college,graduation_date,is_primary)
    SELECT ?,${employeeSql},json_extract(value,'$.degree'),json_extract(value,'$.general_specialization'),json_extract(value,'$.specific_specialization'),json_extract(value,'$.institution'),json_extract(value,'$.college'),json_extract(value,'$.graduation_date'),json_extract(value,'$.is_primary') FROM json_each(?)
    ${auditOperationId?'WHERE EXISTS (SELECT 1 FROM employee_record_audit WHERE id=last_insert_rowid() AND json_extract(after_json,\'$.operation_id\')=?)':''}`).bind(schoolId,...(employeeId===undefined?[]:[employeeId]),JSON.stringify(qualifications),...(auditOperationId?[auditOperationId]:[]));
}
export function createEmployeeAuditStatement(db:D1Database,input:{schoolId:number;employeeId?:number;userId:number;action:string;before:unknown;after:unknown;onlyIfPreviousChanged?:boolean}):D1PreparedStatement {
  return db.prepare(`INSERT INTO employee_record_audit(school_id,employee_id,actor_user_id,action,before_json,after_json) SELECT ?,${input.employeeId===undefined?'last_insert_rowid()':'?'},?,?,?,? ${input.onlyIfPreviousChanged?'WHERE changes()>0':''}`).bind(input.schoolId,...(input.employeeId===undefined?[]:[input.employeeId]),input.userId,input.action,input.before==null?null:JSON.stringify(input.before),input.after==null?null:JSON.stringify(input.after));
}
export function publicEmployee(row:Record<string,unknown>,canViewPrivate:boolean):Employee {
  const nullableText=(field:string)=>row[field]==null?null:String(row[field]);
  const result:Employee={
    id:Number(row.id),school_id:Number(row.school_id),full_name:String(row.full_name),
    employee_number:nullableText('employee_number'),role:String(row.role),job_title:nullableText('job_title'),
    salary_amount:Number(row.salary_amount),salary_type:row.salary_type as Employee['salary_type'],
    employee_type:row.employee_type as Employee['employee_type'],status:String(row.status),
    hire_date:nullableText('hire_date'),commencement_date:nullableText('commencement_date'),
    created_at:Number(row.created_at),updated_at:Number(row.updated_at),
  };
  if(canViewPrivate) {
    result.phone=nullableText('phone');result.email=nullableText('email');
    result.gender=row.gender as Employee['gender'];result.address=nullableText('address');result.notes=nullableText('notes');
    result.created_by_user_id=row.created_by_user_id==null?null:Number(row.created_by_user_id);
    result.has_photo=!!row.photo_object_key;result.photo_updated_at=row.photo_updated_at==null?null:Number(row.photo_updated_at);
  }
  return result;
}
export async function employeeQualifications(db:D1Database,schoolId:number,employeeId?:number):Promise<Array<EmployeeQualification & {employee_id:number}>> {
  const rows=await db.prepare(`SELECT id,employee_id,degree,general_specialization,specific_specialization,institution,college,graduation_date,is_primary FROM employee_qualifications WHERE school_id=? ${employeeId===undefined?'':'AND employee_id=?'} ORDER BY is_primary DESC,id`).bind(schoolId,...(employeeId===undefined?[]:[employeeId])).all<EmployeeQualification & {employee_id:number}>();
  return (rows.results||[]).map(row=>({...row,is_primary:!!row.is_primary}));
}
export const EMPLOYEE_PHOTO_MAX_BYTES=2*1024*1024;
export async function readEmployeePhotoBody(request:Request):Promise<Uint8Array> {
  const length=request.headers.get('content-length');
  if(length && (!/^\d+$/.test(length) || Number(length)>EMPLOYEE_PHOTO_MAX_BYTES)) throw new EmployeeRecordError('حجم الصورة لا يتجاوز 2 ميغابايت');
  if(!request.body) throw new EmployeeRecordError('الصورة مطلوبة');
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  try { while(true) { const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>EMPLOYEE_PHOTO_MAX_BYTES){await reader.cancel();throw new EmployeeRecordError('حجم الصورة لا يتجاوز 2 ميغابايت');} chunks.push(value); } } finally {reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export function detectEmployeePhoto(bytes:Uint8Array):string|null {
  const matches=(offset:number,values:number[])=>values.every((v,i)=>bytes[offset+i]===v);
  if(bytes.length>=33 && matches(0,[137,80,78,71,13,10,26,10]) && matches(12,[73,72,68,82]) && matches(bytes.length-8,[73,69,78,68])) return 'image/png';
  if(bytes.length>=12 && matches(0,[255,216,255]) && matches(bytes.length-2,[255,217])) return 'image/jpeg';
  if(bytes.length>=30 && matches(0,[82,73,70,70]) && matches(8,[87,69,66,80]) && ['VP8 ','VP8L','VP8X'].includes(String.fromCharCode(...bytes.slice(12,16))) && new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true)+8===bytes.length) return 'image/webp';
  return null;
}
