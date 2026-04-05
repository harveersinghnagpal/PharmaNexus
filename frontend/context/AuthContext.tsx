'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi } from '@/services/api';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  store_id: number | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      const storedToken = localStorage.getItem('pharma_token');
      if (!storedToken) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      setToken(storedToken);

      try {
        const res = await authApi.me();
        if (cancelled) return;
        setUser(res.data);
        localStorage.setItem('pharma_user', JSON.stringify(res.data));
      } catch {
        if (cancelled) return;
        localStorage.removeItem('pharma_token');
        localStorage.removeItem('pharma_user');
        setToken(null);
        setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    const { access_token, user: userData } = res.data;
    localStorage.setItem('pharma_token', access_token);
    localStorage.setItem('pharma_user', JSON.stringify(userData));
    setToken(access_token);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('pharma_token');
    localStorage.removeItem('pharma_user');
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
