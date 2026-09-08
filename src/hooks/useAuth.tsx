// ===========================================
// Authentication Context - JWT Bearer Token
// Backend integration with Hono Cloudflare Worker
// ===========================================

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { AuthState, AuthUser } from '../types';

const TOKEN_KEY = 'smart_school_token';
const USER_KEY = 'smart_school_user';

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

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getCurrentAuthStorage(): Storage | null {
  if (localStorage.getItem(TOKEN_KEY)) return localStorage;
  if (sessionStorage.getItem(TOKEN_KEY)) return sessionStorage;
  return null;
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  // Also remove legacy key if present
  localStorage.removeItem('smart_school_auth');
  sessionStorage.removeItem('smart_school_auth');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: getStoredUser(),
    isAuthenticated: !!getStoredToken(),
    isLoading: true,
  });

  // On mount: validate token with backend
  useEffect(() => {
    const token = getStoredToken();
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
          getCurrentAuthStorage()?.setItem(USER_KEY, JSON.stringify(body.data));
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
        clearAuth();
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

      clearAuth();
      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem(TOKEN_KEY, token);
      storage.setItem(USER_KEY, JSON.stringify(user));

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
    const token = getStoredToken();
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
    clearAuth();
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
