import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { AuthState, AuthUser } from '../types';
import { AUTH_STORAGE_CLEARED_EVENT, clearAuthentication, discardLegacyAuthentication, getSessionCsrfToken, setSessionCsrfToken } from '../lib/authStorage';

interface LoginResult { success: boolean; error?: string; }
interface AuthContextType extends AuthState {
  login: (email: string, password: string, rememberMe?: boolean) => Promise<LoginResult>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
const signedOut: AuthState = { user: null, isAuthenticated: false, isLoading: false };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...signedOut, isLoading: true });
  const generation = useRef(0);
  useEffect(() => {
    const handleAuthCleared = () => { generation.current++; setState(signedOut); };
    window.addEventListener(AUTH_STORAGE_CLEARED_EVENT, handleAuthCleared);
    return () => window.removeEventListener(AUTH_STORAGE_CLEARED_EVENT, handleAuthCleared);
  }, []);
  useEffect(() => {
    discardLegacyAuthentication();
    setSessionCsrfToken(null);
    const requestGeneration = ++generation.current;
    const controller = new AbortController();
    fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error('Session unavailable');
        const body = await res.json() as { data: AuthUser; csrf_token?: string };
        if (requestGeneration !== generation.current || controller.signal.aborted) return;
        if (!body.data) throw new Error('Invalid session');
        setSessionCsrfToken(body.csrf_token);
        setState({ user: body.data, isAuthenticated: true, isLoading: false });
      })
      .catch(() => {
        if (requestGeneration !== generation.current || controller.signal.aborted) return;
        clearAuthentication();
      });
    return () => { controller.abort(); generation.current++; };
  }, []);

  const login = useCallback(async (email: string, password: string, rememberMe = false): Promise<LoginResult> => {
    const requestGeneration = ++generation.current;
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, session_mode: 'cookie', remember_me: rememberMe }),
      });
      const body = await res.json().catch(() => ({})) as { data?: { user: AuthUser; csrf_token: string }; error?: string };
      if (requestGeneration !== generation.current) return { success: false, error: 'تغيرت الجلسة؛ حاول مجددًا' };
      if (!res.ok || !body.data?.user || !/^[a-f0-9]{64}$/.test(body.data.csrf_token || '')) {
        setState(prev => ({ ...prev, isLoading: false }));
        return { success: false, error: body.error || (res.status === 429 ? 'محاولات تسجيل دخول كثيرة، حاول مرة أخرى لاحقاً' : 'تعذر تسجيل الدخول') };
      }
      const { user } = body.data;
      discardLegacyAuthentication();
      setSessionCsrfToken(body.data.csrf_token);
      setState({ user, isAuthenticated: true, isLoading: false });
      return { success: true };
    } catch {
      if (requestGeneration === generation.current) setState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: 'تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مجدداً' };
    }
  }, []);

  const logout = useCallback(async () => {
    generation.current++;
    try {
      const csrf = getSessionCsrfToken();
      const res = await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      });
      if (!res.ok && res.status !== 401) throw new Error('Logout failed');
      clearAuthentication();
      window.location.href = '/login';
    } catch {
      // A failed server revocation must never look like a completed logout.
      window.alert('تعذر تأكيد تسجيل الخروج. تحقق من الاتصال وحدّث الصفحة ثم حاول مجددًا.');
    }
  }, []);

  return <AuthContext.Provider value={{ ...state, login, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
