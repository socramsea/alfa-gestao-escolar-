import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorAlert } from '../components/ui';
import { storage } from '../storage';

export function Login() {
  const { me, login } = useAuth();
  const [school, setSchool] = useState(() => new URLSearchParams(location.search).get('escola') ?? storage.get('alfa.school') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={me.permissions.includes('dashboard:read') ? '/app' : '/app/turmas'} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(school.trim().toLowerCase(), email, password);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>Alfa Gestão Escolar</span>
        </div>
        <ErrorAlert message={error} />
        <div className="field">
          <label htmlFor="school">Código da escola</label>
          <input id="school" value={school} onChange={(event) => setSchool(event.target.value)} required autoComplete="organization" />
        </div>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        {import.meta.env.DEV && (
          <div className="demo-box">
            Demonstração (dados fictícios): escola <code>alfa-reis</code>, senha <code>AlfaDemo2026</code>
            <br />
            <code>secretaria@alfareis.demo</code> · <code>direcao@alfareis.demo</code> · <code>admin@alfareis.demo</code>
          </div>
        )}
      </form>
    </div>
  );
}
