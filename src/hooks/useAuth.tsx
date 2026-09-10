// ===========================================
// Authentication Context - JWT Bearer Token
// Backend integration with Hono Cloudflare Worker
// ===========================================

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { AuthState, AuthUser } from '../types';
import {
  AUTH_STORAGE_CLEARED_EVENT,
  clearAuthentication,
  getStoredAuthToken,
  getStoredAuthUser,
  storeAuthentication,
  updateStoredAuthUser,
} from '../lib/authStorage';

interface LoginResponse {
  data: {
    token: string;
    user: AuthUser;
  };
}

interface MeResponse {
  data: AuthUser;
}

interface LoginResult {
  success: boolean;
  error?: string;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string, rememberMe?: boolean) => Promise<LoginResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: getStoredAuthUser(),
    isAuthenticated: !!getStoredAuthToken(),
    isLoading: true,
  });

  useEffect(() => {
    const handleAuthCleared = () => {
      setState({ user: null, isAuthenticated: false, isLoading: false });
    };
    window.addEventListener(AUTH_STORAGE_CLEARED_EVENT, handleAuthCleared);
    return () => window.removeEventListener(AUTH_STORAGE_CLEARED_EVENT, handleAuthCleared);
  }, []);

  // On mount: validate token with backend
  useEffect(() => {
    const token = getStoredAuthToken();
    if (!token) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async res => {
        if (!res.ok) {
          throw new Error('Session expired');
        }
        const body = (await res.json()) as MeResponse;
        if (body.data) {
          updateStoredAuthUser(body.data);
          setState({
            user: body.data,
            isAuthenticated: true,
            isLoading: false,
          });
        } else {
          throw new Error('Invalid session');
        }
      })
      .catch(() => {
        clearAuthentication();
        setState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
      });
  }, []);

  const login = useCallback(async (email: string, password: string, rememberMe = false): Promise<LoginResult> => {
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setState(prev => ({ ...prev, isLoading: false }));
        return {
          success: false,
          error: body.error || (res.status === 429
            ? 'محاولات تسجيل دخول كثيرة، حاول مرة أخرى لاحقاً'
            : 'تعذر تسجيل الدخول'),
        };
      }

      const body = (await res.json()) as LoginResponse;
      const { token, user } = body.data;

      storeAuthentication(token, user, rememberMe);

      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
      return { success: true };
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: 'تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مجدداً' };
    }
  }, []);

  const logout = useCallback(async () => {
    const token = getStoredAuthToken();
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // ignore network errors on logout
      }
    }
    clearAuthentication();
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
