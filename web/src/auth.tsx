import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, request } from './api';
import { storage } from './storage';

export type Me = {
  id: string;
  name: string;
  email: string;
  role: string;
  school: { id: string; name: string; slug: string };
  permissions: string[];
};

type AuthContextValue = {
  me: Me | null;
  token: string | null;
  loading: boolean;
  login: (school: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
  api: <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const TOKEN_KEY = 'alfa.staff.token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => storage.get(TOKEN_KEY));
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(Boolean(token));

  const logout = useCallback(() => {
    storage.set(TOKEN_KEY, null);
    setToken(null);
    setMe(null);
  }, []);

  const api = useCallback(
    async <T,>(path: string, options: { method?: string; body?: unknown } = {}) => {
      try {
        return await request<T>(path, { ...options, token });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) logout();
        throw error;
      }
    },
    [token, logout],
  );

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    request<Me>('/api/auth/me', { token })
      .then(setMe)
      .catch(logout)
      .finally(() => setLoading(false));
  }, [token, logout]);

  const login = async (school: string, email: string, password: string) => {
    const response = await request<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: { school, email, password },
    });
    storage.set(TOKEN_KEY, response.token);
    storage.set('alfa.school', school);
    setToken(response.token);
  };

  const can = (permission: string) => Boolean(me?.permissions.includes(permission));

  return (
    <AuthContext.Provider value={{ me, token, loading, login, logout, can, api }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth fora do AuthProvider');
  return context;
}
