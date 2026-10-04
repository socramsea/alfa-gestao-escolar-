import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { ROLE_LABELS } from '../labels';

const LINKS = [
  { to: '/app', label: 'Painel', permission: 'dashboard:read', end: true },
  { to: '/app/captacao', label: 'Captação', permission: 'admissions:read' },
  { to: '/app/visitas', label: 'Visitas', permission: 'admissions:read' },
  { to: '/app/renovacao', label: 'Matrículas', permission: 'renewals:read' },
  { to: '/app/alunos', label: 'Alunos', permission: 'students:read' },
  { to: '/app/importar', label: 'Importar lista', permission: 'students:manage' },
  { to: '/app/turmas', label: 'Turmas', permission: 'academic:read' },
  { to: '/app/site', label: 'Site da escola', permission: 'site:manage' },
  { to: '/app/unidades', label: 'Unidades', permission: 'school:read' },
];

export function Layout() {
  const { me, can, logout } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>
            Alfa Gestão
            <small>{me?.school.name}</small>
          </span>
        </div>
        {LINKS.filter((link) => can(link.permission)).map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className="nav-link">
            {link.label}
          </NavLink>
        ))}
        <div className="sidebar-footer">
          <div>
            <strong>{me?.name}</strong>
          </div>
          <div className="muted">{ROLE_LABELS[me?.role ?? ''] ?? me?.role}</div>
          <button className="btn btn-small" style={{ marginTop: '0.5rem' }} onClick={logout}>
            Sair
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
