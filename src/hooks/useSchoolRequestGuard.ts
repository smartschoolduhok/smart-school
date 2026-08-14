import { useRef } from 'react';
import { createRequestGeneration, type RequestGeneration } from '../lib/requestGeneration';

export function useSchoolRequestGuard(schoolId: number | null): () => () => boolean {
  const guardRef = useRef<RequestGeneration | null>(null);
  const schoolIdRef = useRef(schoolId);

  if (guardRef.current == null) guardRef.current = createRequestGeneration();
  if (schoolIdRef.current !== schoolId) {
    schoolIdRef.current = schoolId;
    guardRef.current.invalidate();
  }

  return guardRef.current.capture;
}
