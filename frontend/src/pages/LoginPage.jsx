import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try { await login(email, password); }
    catch (err) { setError(err.message); }
    finally { setPassword(""); setPending(false); }
  }
  if (loading) return <main className="login-page" role="status">Verificando acesso…</main>;
  if (user) return <Navigate to="/secretaria" replace />;

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand">
          <span className="brand-mark">AR</span>
          <div>
            <h1>Alfa Gestão Escolar</h1>
            <p>Portal escolar</p>
          </div>
        </div>

        <h2>Acesso ao sistema</h2>

        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          disabled={pending}
          placeholder="admin@alfareis.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          placeholder="Digite sua senha"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <p role="alert">{error}</p>
        <button type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>

        <small>Use as credenciais cadastradas pela administração.</small>
      </form>
    </main>
  );
}
