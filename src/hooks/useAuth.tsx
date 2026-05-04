// ===========================================
// Authentication Context
// Mock implementation for Phase 1
// Ready for Supabase Auth integration in Phase 2
// ===========================================

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { AuthState, AuthUser } from '../types';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Mock admin user for development
const MOCK_ADMIN: AuthUser = {
  id: 1,
  full_name: 'أحمد عبدالله',
  email: 'admin@smart-school.iq',
  role_id: 1,
  role_key: 'system_admin',
  role_name: 'مدير النظام',
  school_id: null,
  school_name: null,
};

// Mock school user for development
const MOCK_SCHOOL_USER: AuthUser = {
  id: 2,
  full_name: 'سارة محمود',
  email: 'principal@nukhba.iq',
  role_id: 3,
  role_key: 'principal',
  role_name: 'المدير',
  school_id: 1,
  school_name: 'مدرسة النخبة الأهلية',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: false,
  });

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true }));

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));

    // Mock authentication logic
    let user: AuthUser | null = null;
    if (email === 'admin@smart-school.iq' && password === 'admin123') {
      user = MOCK_ADMIN;
    } else if (email === 'principal@nukhba.iq' && password === 'school123') {
      user = MOCK_SCHOOL_USER;
    }

    if (user) {
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
      // Store in localStorage for persistence (can be replaced with Supabase session)
      localStorage.setItem('smart_school_auth', JSON.stringify(user));
      return true;
    }

    setState(prev => ({ ...prev, isLoading: false }));
    return false;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('smart_school_auth');
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
    window.location.href = '/login';
  }, []);

  // Check for stored auth on mount (simulating Supabase session recovery)
  React.useEffect(() => {
    const stored = localStorage.getItem('smart_school_auth');
    if (stored) {
      try {
        const user = JSON.parse(stored) as AuthUser;
        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
        localStorage.removeItem('smart_school_auth');
      }
    }
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

// TODO Phase 2: Replace mock auth with Supabase Auth
// import { createClient } from '@supabase/supabase-js'
// const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
// Use supabase.auth.signInWithPassword() and supabase.auth.onAuthStateChange()
