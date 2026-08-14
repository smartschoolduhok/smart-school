import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getSchools } from '../lib/api';
import { systemAdminSchoolSessionStore } from '../lib/systemAdminSchoolSession';
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
  const selectedSchoolId = useSyncExternalStore(
    systemAdminSchoolSessionStore.subscribe,
    systemAdminSchoolSessionStore.getSnapshot,
    () => null,
  );
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(false);
  const [schoolsError, setSchoolsError] = useState('');
  const [schoolsValidated, setSchoolsValidated] = useState(false);

  useEffect(() => {
    setSchoolsError('');
    setSchoolsValidated(false);

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
        const activeSchools = ((data || []) as School[]).filter((school) => school.status === 'active');
        setSchools(activeSchools);
        systemAdminSchoolSessionStore.validateActiveSchools(activeSchools.map((school) => school.id));
        setSchoolsValidated(true);
      }
      setSchoolsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isSystemAdmin, user?.id]);

  const schoolId = useMemo(
    () => resolveTenantSchoolId(
      user?.role_key,
      user?.school_id,
      isSystemAdmin && schoolsValidated ? selectedSchoolId : null,
    ),
    [isSystemAdmin, schoolsValidated, selectedSchoolId, user?.role_key, user?.school_id],
  );

  const selectSchool = useCallback((nextSchoolId: number | null) => {
    if (!isSystemAdmin) return;
    if (nextSchoolId == null || schools.some((school) => school.id === nextSchoolId)) {
      systemAdminSchoolSessionStore.setSchoolId(nextSchoolId);
    }
  }, [isSystemAdmin, schools]);

  return {
    isSystemAdmin,
    schoolId,
    schools,
    schoolsLoading,
    schoolsError,
    selectSchool,
  };
}
