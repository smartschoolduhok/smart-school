import {useEffect,useState} from 'react';
import {fetchApi} from '../../lib/api';
export interface SchoolOption {id:number;name:string;full_name?:string;class_id?:number;is_active?:number;status?:string;}
export function useSchoolOptions(schoolId:number|null,includeStudents=true){
 const [options,setOptions]=useState<{years:SchoolOption[];classes:SchoolOption[];sections:SchoolOption[];students:SchoolOption[]}>({years:[],classes:[],sections:[],students:[]}),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;setOptions({years:[],classes:[],sections:[],students:[]});setError('');if(schoolId)Promise.all(['academic-years','classes','sections',...(includeStudents?['students']:[])].map(path=>fetchApi<SchoolOption[]>(`/api/${path}?school_id=${schoolId}`))).then(rs=>{if(cancelled)return;const error=rs.find(r=>r.error)?.error;if(error)setError(error);else setOptions({years:rs[0].data||[],classes:rs[1].data||[],sections:rs[2].data||[],students:rs[3]?.data||[]});});return()=>{cancelled=true;};},[schoolId,includeStudents]);return {...options,error};
}
export const workflowInput='w-full min-w-0 rounded-lg border border-gray-300 bg-white p-2.5 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200';
export const workflowButton='rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50';
