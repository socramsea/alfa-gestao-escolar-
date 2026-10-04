import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import SecretariaDashboard from './pages/StructurePage.jsx';
import PeoplePage from './pages/PeoplePage.jsx';
import EnrollmentPage from './pages/EnrollmentPage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import AdmissionsPage from './pages/AdmissionsPage.jsx';
import SchoolSitePage from './pages/SchoolSitePage.jsx';
import FamilyEnrollmentPage from './pages/FamilyEnrollmentPage.jsx';
import { AuthProvider, canAccessSecretaria, useAuth } from './auth/AuthContext.jsx';

function Protected() {
  const { user, loading, error, retry, logout } = useAuth();
  if (loading) return <main className="login-page" role="status">Verificando acesso…</main>;
  if (error && !user) return <main className="login-page"><section className="login-card"><p role="alert">{error}</p><button onClick={retry}>Tentar novamente</button><button onClick={logout}>Voltar ao login</button></section></main>;
  return user ? <Outlet /> : <Navigate to="/" replace />;
}
function Unavailable() {
  const { logout } = useAuth();
  return <main className="login-page"><section className="login-card"><h1>Acesso indisponível</h1><p>Esta área ainda não está habilitada para seu perfil.</p><button onClick={logout}>Sair</button></section></main>;
}
function Secretaria({ people = false, enrollment = false, staff = false, admissions = false }) {
  const { user } = useAuth();
  return canAccessSecretaria(user) ? (admissions ? <AdmissionsPage /> : staff ? <StaffPage /> : enrollment ? <EnrollmentPage /> : people ? <PeoplePage /> : <SecretariaDashboard />) : <Unavailable />;
}
export default function App() {
  return <AuthProvider><Routes>
    <Route path="/" element={<LoginPage />} />
    <Route path="/escola/:slug" element={<SchoolSitePage />} />
    <Route path="/matricula/:token" element={<FamilyEnrollmentPage />} />
    <Route element={<Protected />}>
      <Route path="/secretaria" element={<Secretaria />} />
      <Route path="/secretaria/pessoas" element={<Secretaria people />} />
      <Route path="/secretaria/matriculas" element={<Secretaria enrollment />} />
      <Route path="/secretaria/profissionais" element={<Secretaria staff />} />
      <Route path="/secretaria/captacao" element={<Secretaria admissions />} />
      <Route path="/responsavel" element={<Unavailable />} />
      <Route path="/renovacao" element={<Unavailable />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AuthProvider>;
}
