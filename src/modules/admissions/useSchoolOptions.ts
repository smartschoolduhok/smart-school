import {useEffect,useState} from 'react';
import {fetchApi} from '../../lib/api';
export interface SchoolOption {id:number;name:string;full_name?:string;class_id?:number;is_active?:number;status?:string;}
export function useSchoolOptions(schoolId:number|null){
 const [options,setOptions]=useState<{years:SchoolOption[];classes:SchoolOption[];sections:SchoolOption[];students:SchoolOption[]}>({years:[],classes:[],sections:[],students:[]}),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;setOptions({years:[],classes:[],sections:[],students:[]});setError('');if(schoolId)Promise.all(['academic-years','classes','sections','students'].map(path=>fetchApi<SchoolOption[]>(`/api/${path}?school_id=${schoolId}`))).then(rs=>{if(cancelled)return;const error=rs.find(r=>r.error)?.error;if(error)setError(error);else setOptions({years:rs[0].data||[],classes:rs[1].data||[],sections:rs[2].data||[],students:rs[3].data||[]});});return()=>{cancelled=true;};},[schoolId]);return {...options,error};
}
export const workflowInput='w-full min-w-0 rounded-lg border bg-white p-2.5';
export const workflowButton='rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50';
