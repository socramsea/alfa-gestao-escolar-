import { Link } from "react-router-dom";

export default function ResponsavelDashboard() {
  return (
    <main className="dashboard-page">
      <header className="topbar">
        <div>
          <strong>Alfa Gestão Escolar</strong>
          <span>Área do responsável</span>
        </div>

        <Link to="/">Sair</Link>
      </header>

      <section className="page-content narrow-content">
        <p className="eyebrow">Portal da família</p>
        <h1>Olá, Ana Souza</h1>
        <p>Confira as informações do aluno e finalize a renovação.</p>

        <article className="student-card">
          <div>
            <span className="avatar">MS</span>
            <div>
              <h2>Maria Souza</h2>
              <p>5º ano · Turno da manhã</p>
            </div>
          </div>

          <span className="status pending">Renovação pendente</span>
        </article>

        <Link className="primary-link" to="/renovacao">
          Conferir prévia da renovação
        </Link>
      </section>
    </main>
  );
}
