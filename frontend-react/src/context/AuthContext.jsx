import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('vascuai_token')));
  const [sessionError, setSessionError] = useState('');

  const clearSession = useCallback(() => {
    localStorage.removeItem('vascuai_token');
    localStorage.removeItem('vascuai_user');
    setUser(null);
  }, []);

  useEffect(() => {
    let active = true;
    const restoringToken = localStorage.getItem('vascuai_token');
    const isCurrent = () => active && localStorage.getItem('vascuai_token') === restoringToken;
    if (restoringToken) {
      authApi.me().then((identity) => {
        if (isCurrent()) setUser(identity);
      }).catch(() => {
        if (isCurrent()) clearSession();
      }).finally(() => { if (active) setLoading(false); });
    }
    window.addEventListener('vascuai:unauthorized', clearSession);
    return () => {
      active = false;
      window.removeEventListener('vascuai:unauthorized', clearSession);
    };
  }, [clearSession]);

  const saveSession = useCallback((data) => {
    localStorage.setItem('vascuai_token', data.access_token);
    // Identity is restored from the server, never from this browser cache.
    localStorage.removeItem('vascuai_user');
    setUser(data.user);
    setSessionError('');
    return data.user;
  }, []);

  const login = useCallback(async (email, password) =>
    saveSession(await authApi.login(email, password)), [saveSession]);
  const register = useCallback(async (payload) =>
    saveSession(await authApi.register(payload)), [saveSession]);
  const updateProfile = useCallback(async (payload) => {
    const identity = await authApi.updateProfile(payload);
    setUser(identity);
    return identity;
  }, []);
  const changePassword = useCallback(async (current, password) =>
    saveSession(await authApi.changePassword(current, password)), [saveSession]);
  const logout = useCallback(async () => {
    try { await authApi.logout(); }
    catch {
      setSessionError('Signed out on this device. Server session revocation could not be confirmed.');
    } finally { clearSession(); }
  }, [clearSession]);
  const isRole = useCallback((...roles) => user && roles.includes(user.role), [user]);

  return (
    <AuthContext.Provider value={{
      user, loading, sessionError, login, register, logout, isRole, updateProfile, changePassword,
    }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
