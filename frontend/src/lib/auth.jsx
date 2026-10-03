import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAuthToken } from './api.js';
import { storage } from './storage.js';

const AuthContext = createContext(null);

/**
 * Holds the logged-in account. The JWT is kept in localStorage so the user stays
 * logged in across reloads; on startup it is re-validated with GET /api/auth/me.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    const saved = storage.getAuth();
    if (saved) setAuthToken(saved.token);
    return saved; // { token, user } | null
  });

  const save = useCallback((next) => {
    setAuthToken(next?.token ?? null);
    storage.setAuth(next);
    setSession(next);
  }, []);

  // Validate a stored token once (expired / server secret changed → log out).
  useEffect(() => {
    if (!session?.token) return;
    api
      .me()
      .then(({ user }) => save({ token: session.token, user }))
      .catch((err) => {
        if (err.status === 401) save(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (credentials) => save(await api.login(credentials)), [save]);
  const signup = useCallback(async (details) => save(await api.signup(details)), [save]);
  const logout = useCallback(() => save(null), [save]);

  const value = useMemo(
    () => ({ user: session?.user ?? null, token: session?.token ?? null, login, signup, logout }),
    [session, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
