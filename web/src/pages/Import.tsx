import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorAlert } from '../components/ui';
import { useLoad } from '../hooks';

type Row = {
  student_name: string;
  birth_date: string;
  class_name?: string;
  guardian_name: string;
  guardian_phone: string;
};

const EXAMPLE = `Aluno\tNascimento\tTurma\tResponsável\tWhatsApp
João Fictício Souza\t02/02/2019\t1º Ano A\tCarla Fictícia Souza\t(11) 95555-4444
Pedro Fictício Souza\t04/04/2020\tInfantil 5 A\tCarla Fictícia Souza\t(11) 95555-4444`;

function toIsoDate(value: string) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return value.trim();
}

/** Aceita colagem direta do Excel/Google Planilhas (tabulação) ou CSV com ; ou ,. */
function parseRows(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const separator = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const hasHeader = /aluno|nome/i.test(lines[0]);

  return lines.slice(hasHeader ? 1 : 0).map((line) => {
    const [student_name = '', birth = '', class_name = '', guardian_name = '', guardian_phone = ''] = line
      .split(separator)
      .map((cell) => cell.trim());
    return {
      student_name,
      birth_date: toIsoDate(birth),
      class_name: class_name || undefined,
      guardian_name,
      guardian_phone,
    };
  });
}

export function Import() {
  const { api } = useAuth();
  const years = useLoad(() => api<{ data: { id: string; year: number; status: string }[] }>('/api/school-years').then((r) => r.data), [api]);
  const [text, setText] = useState('');
  const [yearId, setYearId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => parseRows(text), [text]);
  const selectedYear = yearId || years.data?.find((year) => year.status === 'active')?.id || years.data?.[0]?.id || '';

  const submit = async () => {
    setBusy(true);
    setError(null);
    setRowErrors({});
    try {
      const result = await api<{ created: number }>('/api/students/import', {
        method: 'POST',
        body: { school_year_id: selectedYear || undefined, rows },
      });
      setDone(result.created);
      setText('');
    } catch (reason) {
      setError(errorMessage(reason));
      if (reason instanceof ApiError && reason.details) {
        setRowErrors(
          Object.fromEntries(
            reason.details.map((detail) => {
              const line = detail.linha ?? Number(detail.campo?.split('.')[1]) + 1;
              return [line, detail.mensagem];
            }),
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Importar lista de alunos</h1>
          <p className="muted">Digitalize as fichas em papel de uma vez: cole a planilha e confira antes de salvar.</p>
        </div>
      </div>

      {done !== null && (
        <div className="alert alert-success">
          {done} alunos importados. <Link to="/app/alunos">Ver alunos</Link> e enviar o link para os responsáveis completarem os dados.
        </div>
      )}
      <ErrorAlert message={error} />

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label htmlFor="year">Ano letivo das turmas</label>
            <select id="year" value={selectedYear} onChange={(event) => setYearId(event.target.value)}>
              {years.data?.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.year}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="paste">Cole aqui as linhas da planilha</label>
          <span className="hint">Colunas: Aluno · Nascimento (dd/mm/aaaa) · Turma (opcional) · Responsável · WhatsApp</span>
          <textarea id="paste" rows={8} value={text} onChange={(event) => setText(event.target.value)} placeholder={EXAMPLE} />
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setText(EXAMPLE)}>
            Usar exemplo
          </button>
          <button className="btn btn-primary" disabled={!rows.length || busy} onClick={submit}>
            {busy ? 'Importando…' : `Importar ${rows.length} alunos`}
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card">
          <h2>Conferência</h2>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Aluno</th>
                <th>Nascimento</th>
                <th>Turma</th>
                <th>Responsável</th>
                <th>WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} style={rowErrors[index + 1] ? { background: 'var(--danger-soft)' } : undefined}>
                  <td data-label="#">{index + 1}</td>
                  <td data-label="Aluno">
                    {row.student_name}
                    {rowErrors[index + 1] && <div className="small" style={{ color: 'var(--danger)' }}>{rowErrors[index + 1]}</div>}
                  </td>
                  <td data-label="Nascimento">{row.birth_date}</td>
                  <td data-label="Turma">{row.class_name ?? '—'}</td>
                  <td data-label="Responsável">{row.guardian_name}</td>
                  <td data-label="WhatsApp">{row.guardian_phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
