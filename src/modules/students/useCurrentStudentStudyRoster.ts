import { useEffect, useState } from 'react';
import { getAcademicYears } from '../../lib/api';
import { getStudentStudyRoster } from '../../lib/studentStudyStatusApi';
import type { StudentStudyStatusList } from '../../lib/studentStudyStatus';

export function useCurrentStudentStudyRoster(schoolId: number | null, enabled: boolean) {
  const key = `${schoolId}:${enabled}`;
  const [state, setState] = useState<{key: string; data: StudentStudyStatusList | null; error: string; loading: boolean}>({key: '', data: null, error: '', loading: false});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState({key, data: null, error: '', loading: enabled && schoolId != null});
    if (!enabled || schoolId == null) return;
    void (async () => {
      try {
        const years = await getAcademicYears(schoolId);
        if (!active) return;
        if (years.error || !years.data) throw new Error(years.error || 'تعذر تحميل السنة الدراسية.');
        const year = years.data.find(item => item.school_id === schoolId && item.is_active);
        if (!year) throw new Error('لا توجد سنة دراسية حالية لعرض نوع الدراسة.');
        const response = await getStudentStudyRoster({school_id: schoolId, academic_year_id: year.id});
        if (!active) return;
        if (response.error || !response.data) throw new Error(response.error || 'تعذر تحميل أنواع الدراسة.');
        if (response.data.school.id !== schoolId || response.data.academic_year.id !== year.id) throw new Error('تعذر مطابقة السنة والمدرسة.');
        setState({key, data: response.data, error: '', loading: false});
      } catch (error) { if (active) setState({key, data: null, error: error instanceof Error ? error.message : 'تعذر التحميل.', loading: false}); }
    })();
    return () => { active = false; };
  }, [key, schoolId, enabled, revision]);
  return {data: state.key === key ? state.data : null, error: state.key === key ? state.error : '', loading: state.key !== key || state.loading, reload: () => setRevision(value => value + 1)};
}
