import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { structureRequest } from './structure-api.js';
import { peopleRequest } from './people-api.js';
import { enrollmentRequest } from './enrollment-api.js';
import { staffRequest } from './staff-api.js';
import { admissionsRequest } from './admissions-api.js';
import { onlineEnrollmentRequest } from './online-enrollment-api.js';

const AuthContext = createContext(null);
const KEY = 'alfa.session';
export { canAccessSecretaria } from "./api.js";
import { request } from "./api.js";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const token = useRef(null);
  const generation = useRef(0);

  function logout() {
    generation.current++;
    token.current = null;
    sessionStorage.removeItem(KEY);
    setUser(null);
    setError('');
    setLoading(false);
  }

  async function validate() {
    const current = ++generation.current;
    setError('');
    try {
      token.current = sessionStorage.getItem(KEY);
      if (!token.current) { setUser(null); return; }
      const data = await request('me', { token: token.current });
      if (current === generation.current) setUser(data.user);
    } catch (err) {
      if (current !== generation.current) return;
      setUser(null);
      if (err.status === 401) {
        sessionStorage.removeItem(KEY);
        token.current = null;
      }
      setError(err.message);
    } finally { if (current === generation.current) setLoading(false); }
  }

  async function login(email, password) {
    const current = ++generation.current;
    const data = await request('login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
    if (typeof data.token !== 'string' || !data.token) throw new Error('Resposta de autenticação inválida.');
    const verified = await request('me', { token: data.token });
    if (current !== generation.current) return;
    sessionStorage.setItem(KEY, data.token);
    token.current = data.token;
    setError('');
    setUser(verified.user);
  }

  useEffect(() => {
    validate();
    const onFocus = () => { if (token.current) validate(); };
    const timer = setInterval(() => { if (token.current) validate(); }, 60000);
    window.addEventListener('focus', onFocus);
    return () => { generation.current++; clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);

  const structure = useCallback(async (path, options) => {
    const activeToken = token.current;
    if (!activeToken) throw new Error('Entre novamente para continuar.');
    try {
      const result = await structureRequest(activeToken, path, options);
      if (activeToken !== token.current) throw new Error('Sessão alterada. Entre novamente.');
      return result;
    } catch (err) {
      if (err.status === 401 && activeToken === token.current) logout();
      throw err;
    }
  }, []);
  const people = useCallback(async (path, options) => {
    const activeToken = token.current;
    if (!activeToken) throw new Error('Entre novamente para continuar.');
    try {
      const result = await peopleRequest(activeToken, path, options);
      if (activeToken !== token.current) throw new Error('Sessão alterada. Entre novamente.');
      return result;
    } catch (err) {
      if (err.status === 401 && activeToken === token.current) logout();
      throw err;
    }
  }, []);
  const enroll = useCallback(async (path, options) => {
    const activeToken = token.current;
    if (!activeToken) throw new Error('Entre novamente para continuar.');
    try {
      const result = await enrollmentRequest(activeToken, path, options);
      if (activeToken !== token.current) throw new Error('Sessão alterada. Entre novamente.');
      return result;
    } catch (err) {
      if (err.status === 401 && activeToken === token.current) logout();
      throw err;
    }
  }, []);
  const staff = useCallback(async (path, options) => {
    const activeToken = token.current;
    if (!activeToken) throw new Error('Entre novamente para continuar.');
    try {
      const result = await staffRequest(activeToken, path, options);
      if (activeToken !== token.current) throw new Error('Sessão alterada. Entre novamente.');
      return result;
    } catch (err) {
      if (err.status === 401 && activeToken === token.current) logout();
      throw err;
    }
  }, []);
  const admissions = useCallback(async (path, options) => {
    const activeToken = token.current;
    if (!activeToken) throw new Error('Entre novamente para continuar.');
    try {
      const result = await admissionsRequest(activeToken, path, options);
      if (activeToken !== token.current) throw new Error('Sessão alterada. Entre novamente.');
      return result;
    } catch (err) {
      if (err.status === 401 && activeToken === token.current) logout();
      throw err;
    }
  }, []);
  const online = useCallback(async (path, options) => {
    const activeToken = token.current;
    if (!activeToken) throw new Error('Entre novamente para continuar.');
    try {
      const result = await onlineEnrollmentRequest(activeToken, path, options);
      if (activeToken !== token.current) throw new Error('Sessão alterada. Entre novamente.');
      return result;
    } catch (err) {
      if (err.status === 401 && activeToken === token.current) logout();
      throw err;
    }
  }, []);
  // Prévia de fotos exige credencial: busca como blob e devolve URL local.
  const admissionsImage = useCallback(async id => {
    const response = await fetch(`/api/admissions/site/images/${id}`, { headers: { Authorization: `Bearer ${token.current}` } });
    if (!response.ok) throw new Error('Foto indisponível.');
    return URL.createObjectURL(await response.blob());
  }, []);
  return <AuthContext.Provider value={{ user, loading, error, login, logout, retry: validate, structure, people, enroll, staff, admissions, admissionsImage, online }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
