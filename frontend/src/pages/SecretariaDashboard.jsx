import { useAuth } from "../auth/AuthContext.jsx";

const indicadores = [
  { titulo: "Alunos aptos", valor: "120", cor: "blue" },
  { titulo: "Renovações pendentes", valor: "35", cor: "orange" },
  { titulo: "Aprovadas", valor: "33", cor: "green" },
  { titulo: "Documentos pendentes", valor: "12", cor: "purple" }
];

export default function SecretariaDashboard() {
  const { user, logout } = useAuth();
  return (
    <main className="dashboard-page">
      <header className="topbar">
        <div>
          <strong>Alfa Gestão Escolar</strong>
          <span>{user.name}</span>
        </div>

        <button className="secondary-button" onClick={logout}>Sair</button>
      </header>

      <section className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Ano letivo 2027</p>
            <h1>Painel da Secretaria</h1>
            <p>Prévia demonstrativa: os indicadores e alunos abaixo são fictícios.</p>
          </div>


        </div>

        <div className="stats-grid">
          {indicadores.map((indicador) => (
            <article className={`stat-card ${indicador.cor}`} key={indicador.titulo}>
              <span>{indicador.titulo}</span>
              <strong>{indicador.valor}</strong>
            </article>
          ))}
        </div>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Solicitações recentes</h2>
              <p>Últimas movimentações do processo de renovação.</p>
            </div>
            <button className="secondary-button" disabled title="Disponível após a integração dos dados">Exportar relatório</button>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Série</th>
                  <th>Responsável</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Maria Souza</td>
                  <td>6º ano</td>
                  <td>Ana Souza</td>
                  <td><span className="status pending">Aguardando confirmação</span></td>
                </tr>
                <tr>
                  <td>João da Silva</td>
                  <td>5º ano</td>
                  <td>Paulo Silva</td>
                  <td><span className="status approved">Aprovada</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
