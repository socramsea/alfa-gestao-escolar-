import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorAlert, Loading } from '../components/ui';
import { useLoad } from '../hooks';
import { SHIFT_LABELS } from '../labels';

type ClassRow = { id: string; year: number; name: string; grade: string; shift: string; capacity: number | null; student_count: number };
type Year = { id: string; year: number; status: string };

export function Classes() {
  const { api, can } = useAuth();
  const years = useLoad(() => api<{ data: Year[] }>('/api/school-years').then((r) => r.data), [api]);
  const [yearId, setYearId] = useState('');
  const selectedYear = yearId || years.data?.find((year) => year.status === 'active')?.id || years.data?.[0]?.id;
  const classes = useLoad(
    () => (selectedYear ? api<{ data: ClassRow[] }>(`/api/classes?school_year_id=${selectedYear}`).then((r) => r.data) : Promise.resolve([])),
    [api, selectedYear],
  );
  const [form, setForm] = useState({ name: '', grade: '', shift: 'morning', capacity: '' });
  const [newYear, setNewYear] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addClass = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api('/api/classes', {
        method: 'POST',
        body: { ...form, school_year_id: selectedYear, capacity: form.capacity ? Number(form.capacity) : null },
      });
      setForm({ name: '', grade: '', shift: form.shift, capacity: '' });
      classes.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const addYear = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const created = await api<Year>('/api/school-years', { method: 'POST', body: { year: Number(newYear) } });
      setNewYear('');
      await years.reload();
      setYearId(created.id);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  if (years.loading && !years.data) return <Loading />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Turmas</h1>
        </div>
        <select value={selectedYear ?? ''} onChange={(event) => setYearId(event.target.value)} style={{ width: 'auto' }} aria-label="Ano letivo">
          {years.data?.map((year) => (
            <option key={year.id} value={year.id}>
              Ano letivo {year.year}
            </option>
          ))}
        </select>
      </div>
      <ErrorAlert message={error ?? years.error ?? classes.error} />

      <div className="card">
        {classes.data?.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Turma</th>
                <th>Série</th>
                <th>Turno</th>
                <th className="num">Alunos</th>
              </tr>
            </thead>
            <tbody>
              {classes.data.map((row) => (
                <tr key={row.id}>
                  <td data-label="Turma">
                    <strong>{row.name}</strong>
                  </td>
                  <td data-label="Série">{row.grade}</td>
                  <td data-label="Turno">{SHIFT_LABELS[row.shift]}</td>
                  <td data-label="Alunos" className="num">
                    {row.student_count}
                    {row.capacity ? ` / ${row.capacity}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhuma turma neste ano letivo.</div>
        )}
      </div>

      {can('academic:manage') && (
        <div className="grid grid-2" style={{ marginTop: '1rem' }}>
          <form className="card" onSubmit={addClass}>
            <h2>Nova turma</h2>
            <div className="form-row">
              <div className="field">
                <label htmlFor="cname">Nome</label>
                <input id="cname" required placeholder="1º Ano A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="grade">Série</label>
                <input id="grade" required placeholder="1º Ano" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="shift">Turno</label>
                <select id="shift" value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
                  {Object.entries(SHIFT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="capacity">Vagas</label>
                <input id="capacity" type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary" disabled={!selectedYear}>
              Adicionar turma
            </button>
          </form>
          <form className="card" onSubmit={addYear}>
            <h2>Novo ano letivo</h2>
            <div className="field">
              <label htmlFor="year">Ano</label>
              <input id="year" type="number" required min={2000} max={2100} value={newYear} onChange={(e) => setNewYear(e.target.value)} />
            </div>
            <button className="btn">Criar ano letivo</button>
          </form>
        </div>
      )}
    </>
  );
}
