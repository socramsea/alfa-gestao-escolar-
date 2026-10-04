import { useState } from "react";
import { Link } from "react-router-dom";

export default function RenovacaoPage() {
  const [accepted, setAccepted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  function handleConfirm() {
    if (!accepted) {
      alert("Aceite os termos para confirmar a renovação.");
      return;
    }

    setConfirmed(true);
  }

  return (
    <main className="dashboard-page">
      <header className="topbar">
        <div>
          <strong>Alfa Gestão Escolar</strong>
          <span>Renovação de matrícula</span>
        </div>

        <Link to="/responsavel">Voltar</Link>
      </header>

      <section className="page-content narrow-content">
        <p className="eyebrow">Ano letivo 2027</p>
        <h1>Prévia da renovação</h1>
        <p>Confira os dados antes de confirmar a matrícula.</p>

        {confirmed && (
          <div className="success-message">
            Renovação confirmada com sucesso. A secretaria fará a análise dos documentos.
          </div>
        )}

        <section className="panel">
          <h2>Dados do aluno</h2>
          <div className="details-grid">
            <div><span>Aluno</span><strong>Maria Souza</strong></div>
            <div><span>Matrícula</span><strong>AR-00045</strong></div>
            <div><span>Série atual</span><strong>5º ano</strong></div>
            <div><span>Próxima série</span><strong>6º ano</strong></div>
            <div><span>Turno</span><strong>Manhã</strong></div>
            <div><span>Turma prevista</span><strong>6º A</strong></div>
          </div>
        </section>

        <section className="panel">
          <h2>Dados financeiros</h2>
          <div className="financial-row"><span>Mensalidade</span><strong>R$ 620,00</strong></div>
          <div className="financial-row"><span>Desconto</span><strong>R$ 50,00</strong></div>
          <div className="financial-row total"><span>Total mensal</span><strong>R$ 570,00</strong></div>
        </section>

        <label className="terms">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span>Aceito os termos da renovação e confirmo os dados apresentados.</span>
        </label>

        <button className="primary-button" onClick={handleConfirm} disabled={confirmed}>
          {confirmed ? "Renovação confirmada" : "Confirmar renovação"}
        </button>
      </section>
    </main>
  );
}
