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

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // Also remove legacy key if present
  localStorage.removeItem('smart_school_auth');
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
          localStorage.setItem(USER_KEY, JSON.stringify(body.data));
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

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setState(prev => ({ ...prev, isLoading: false }));
        return false;
      }

      const body = (await res.json()) as LoginResponse;
      const { token, user } = body.data;

      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));

      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
      return true;
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
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
