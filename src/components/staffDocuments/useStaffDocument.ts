import { useEffect, useRef, useState } from 'react';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';

/** Keep old-school and old-filter results out of both previews and print snapshots. */
export function useStaffDocument<T>({schoolId, requestKey, load, matches}: {
  schoolId: number | null; requestKey: string;
  load: () => Promise<{data?: T; error?: string}>;
  matches: (data: T) => boolean;
}) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const scope = useRef(requestKey); scope.current = requestKey;
  const [state, setState] = useState<{key: string; data: T | null; loading: boolean; error: string}>({key: '', data: null, loading: true, error: ''});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const isCurrentSchool = captureSchoolRequest();
    const current = () => active && isCurrentSchool() && scope.current === requestKey;
    setState({key: requestKey, data: null, loading: schoolId != null, error: ''});
    if (schoolId != null) void (async () => {
      try {
        const response = await load();
        if (!current()) return;
        if (response.error) throw new Error(response.error);
        if (!response.data || !matches(response.data)) throw new Error('تعذر مطابقة البيانات مع المدرسة والاختيارات الحالية.');
        setState({key: requestKey, data: response.data, loading: false, error: ''});
      } catch (failure) {
        if (current()) setState({key: requestKey, data: null, loading: false, error: failure instanceof Error ? failure.message : 'تعذر تحميل البيانات.'});
      }
    })();
    return () => { active = false; };
  }, [schoolId, requestKey, load, matches, revision, captureSchoolRequest]);
  return {data: state.key === requestKey ? state.data : null, loading: schoolId != null && (state.key !== requestKey || state.loading), error: state.key === requestKey ? state.error : '', reload: () => setRevision(value => value + 1)};
}
