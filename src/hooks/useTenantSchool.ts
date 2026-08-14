import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSchools } from '../lib/api';
import { resolveTenantSchoolId } from '../lib/tenantSchool';
import type { School } from '../types';
import { useAuth } from './useAuth';

export interface TenantSchoolScope {
  isSystemAdmin: boolean;
  schoolId: number | null;
  schools: School[];
  schoolsLoading: boolean;
  schoolsError: string;
  selectSchool: (schoolId: number | null) => void;
}

export function useTenantSchool(): TenantSchoolScope {
  const { user } = useAuth();
  const isSystemAdmin = user?.role_key === 'system_admin';
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(false);
  const [schoolsError, setSchoolsError] = useState('');

  useEffect(() => {
    setSelectedSchoolId(null);
    setSchoolsError('');

    if (!isSystemAdmin) {
      setSchools([]);
      setSchoolsLoading(false);
      return;
    }

    let cancelled = false;
    setSchoolsLoading(true);
    getSchools().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setSchools([]);
        setSchoolsError(error);
      } else {
        setSchools(((data || []) as School[]).filter((school) => school.status === 'active'));
      }
      setSchoolsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isSystemAdmin, user?.id]);

  const schoolId = useMemo(
    () => resolveTenantSchoolId(user?.role_key, user?.school_id, selectedSchoolId),
    [selectedSchoolId, user?.role_key, user?.school_id],
  );

  const selectSchool = useCallback((nextSchoolId: number | null) => {
    if (isSystemAdmin) {
      setSelectedSchoolId(nextSchoolId);
    }
  }, [isSystemAdmin]);

  return {
    isSystemAdmin,
    schoolId,
    schools,
    schoolsLoading,
    schoolsError,
    selectSchool,
  };
}
