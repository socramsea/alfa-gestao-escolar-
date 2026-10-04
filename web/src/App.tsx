import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Classes } from './pages/Classes';
import { Dashboard } from './pages/Dashboard';
import { Import } from './pages/Import';
import { Login } from './pages/Login';
import { RenewalReview } from './pages/RenewalReview';
import { Renewals } from './pages/Renewals';
import { StudentDetailPage, Students } from './pages/Students';
import { Portal } from './portal/Portal';
import { Admissions, LeadDetail } from './pages/Admissions';
import { SiteEditor } from './pages/SiteEditor';
import { Units } from './pages/Units';
import { Visits } from './pages/Visits';
import { SchoolSite } from './site/SchoolSite';

function RequireStaff({ children }: { children: ReactNode }) {
  const { me, token, loading } = useAuth();
  if (loading || (token && !me)) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

function Guard({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return <div className="card empty">Seu perfil não tem acesso a esta área.</div>;
  }
  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Portal do responsável: independente do login da equipe. */}
        <Route path="/r/:token" element={<Portal />} />
        {/* Site público da escola, com a pré-matrícula. */}
        <Route path="/escola/:slug" element={<SchoolSite />} />

        <Route
          path="/*"
          element={
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/app"
                  element={
                    <RequireStaff>
                      <Layout />
                    </RequireStaff>
                  }
                >
                  <Route index element={<Guard permission="dashboard:read"><Dashboard /></Guard>} />
                  <Route path="renovacao" element={<Guard permission="renewals:read"><Renewals /></Guard>} />
                  <Route path="renovacao/:id" element={<Guard permission="renewals:read"><RenewalReview /></Guard>} />
                  <Route path="alunos" element={<Guard permission="students:read"><Students /></Guard>} />
                  <Route path="alunos/:id" element={<Guard permission="students:read"><StudentDetailPage /></Guard>} />
                  <Route path="importar" element={<Guard permission="students:manage"><Import /></Guard>} />
                  <Route path="turmas" element={<Guard permission="academic:read"><Classes /></Guard>} />
                  <Route path="captacao" element={<Guard permission="admissions:read"><Admissions /></Guard>} />
                  <Route path="captacao/:id" element={<Guard permission="admissions:read"><LeadDetail /></Guard>} />
                  <Route path="visitas" element={<Guard permission="admissions:read"><Visits /></Guard>} />
                  <Route path="site" element={<Guard permission="site:manage"><SiteEditor /></Guard>} />
                  <Route path="unidades" element={<Guard permission="school:read"><Units /></Guard>} />
                </Route>
                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
