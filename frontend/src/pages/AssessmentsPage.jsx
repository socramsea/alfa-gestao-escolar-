import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { buildScores, civilDate, decimal } from '../auth/assessments-api.js';

const emptyType = () => ({ code:'', name:'', default_weight:'' });
const emptyAssessment = () => ({ assessment_type_id:'', title:'', held_on:'', weight:'' });
const typed = text => String(text ?? '').trim().replace(',', '.');
const asText = score => score === null || score === undefined ? '' : String(score).replace('.', ',');
export default function AssessmentsPage() {
  const { user, logout, structure, assessments } = useAuth();
  const [refs,setRefs] = useState({ groups:[], years:[], types:[] });
  const [groupId,setGroupId] = useState('');
  const [book,setBook] = useState(null);
  const [assessmentId,setAssessmentId] = useState('');
  const [history,setHistory] = useState(null);
  const [scores,setScores] = useState({});
  const [reason,setReason] = useState('');
  const [typeForm,setTypeForm] = useState(emptyType);
  const [form,setForm] = useState(emptyAssessment);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(null);
  const [success,setSuccess] = useState('');
  const [revision,setRevision] = useState(0);
  const saving = useRef(false);
  const attempt = useRef(null);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    async function all(request, resource) {
      const items = []; let page = 1;
      for (;;) {
        const data = await request(`${resource}?page=${page++}`, { signal: controller.signal });
        items.push(...data.items);
        if (!data.has_more) return items;
      }
    }
    Promise.all([all(structure,'class-groups'), all(structure,'academic-years'), all(assessments,'/types')])
      .then(([groups, years, types]) => { if (live) setRefs({ groups, years, types }); })
      .catch(e => { if (live) setError({ message: e.message }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [revision, structure, assessments]);

  useEffect(() => {
    if (!groupId) { setBook(null); return undefined; }
    let live = true;
    const controller = new AbortController();
    assessments(`?class_group_id=${groupId}`, { signal: controller.signal })
      .then(data => { if (live) setBook(data); })
      .catch(e => { if (live) setError({ message: e.message }); });
    return () => { live = false; controller.abort(); };
  }, [groupId, revision, assessments]);

  useEffect(() => {
    if (!assessmentId) { setHistory(null); return undefined; }
    let live = true;
    const controller = new AbortController();
    assessments(`/${assessmentId}/scores`, { signal: controller.signal })
      .then(data => { if (live) setHistory(data); })
      .catch(e => { if (live) setError({ message: e.message }); });
    return () => { live = false; controller.abort(); };
  }, [assessmentId, revision, assessments]);

  // Ao trocar de avaliação ou recarregar a turma, os campos mostram as notas vigentes.
  useEffect(() => {
    if (!book || !assessmentId) { setScores({}); return; }
    setScores(Object.fromEntries(book.students.map(s => [s.student_id, asText(s.scores.find(x => x.assessment_id === assessmentId)?.score)])));
  }, [book, assessmentId]);

  function chooseGroup(e) { setGroupId(e.target.value); setAssessmentId(''); setBook(null); setSuccess(''); setError(null); setForm(emptyAssessment()); }
  async function send(path, payload, message, done) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setSuccess(''); setError(null);
    const body = JSON.stringify(payload);
    if (!attempt.current || attempt.current.body !== body || attempt.current.path !== path) attempt.current = { body, path, key: crypto.randomUUID() };
    try {
      const result = await assessments(path, { method:'POST', body, headers:{ 'Idempotency-Key': attempt.current.key } });
      attempt.current = null; done(result); setSuccess(typeof message === 'function' ? message(result) : message); setRevision(n => n + 1);
    } catch (e) {
      const names = Object.fromEntries((book?.students || []).map(s => [s.student_id, s.student_name]));
      const items = (e.body?.items || []).map(i => `${names[i.student_id] || 'Aluno'}: ${i.error}`);
      setError({ message: e.message, items });
    } finally { saving.current = false; setBusy(false); }
  }
  function saveType(e) {
    e.preventDefault();
    send('/types', { code: typeForm.code, name: typeForm.name, default_weight: Number(typed(typeForm.default_weight)) },
      'Tipo de avaliação salvo.', () => setTypeForm(emptyType()));
  }
  function saveAssessment(e) {
    e.preventDefault();
    const weight = typed(form.weight);
    send('', { class_group_id: groupId, assessment_type_id: form.assessment_type_id, title: form.title, held_on: form.held_on,
      weight: weight ? Number(weight) : null }, 'Avaliação criada. Escolha-a abaixo para lançar as notas.',
    result => { setForm(emptyAssessment()); setAssessmentId(result.item.id); });
  }
  function saveScores(e) {
    e.preventDefault();
    const { scores: batch, errors } = buildScores(book.students, assessmentId, scores, reason);
    if (errors.length) { setSuccess(''); setError({ message: 'Confira as notas antes de salvar.', items: errors }); return; }
    if (!batch.length) { setError(null); setSuccess('Nenhuma nota nova ou alterada para salvar.'); return; }
    send(`/${assessmentId}/scores`, { scores: batch },
      r => `Notas salvas: ${r.launched} lançada(s) e ${r.corrected} corrigida(s).`, () => setReason(''));
  }

  const year = id => refs.years.find(y => y.id === id);
  const group = refs.groups.find(g => g.id === groupId);
  const limits = year(group?.academic_year_id);
  const type = refs.types.find(t => t.id === form.assessment_type_id);
  const assessment = book?.assessments.find(a => a.id === assessmentId);
  const students = book?.students || [];
  const current = s => s.scores.find(x => x.assessment_id === assessmentId);
  const correcting = students.some(s => { const c = current(s); const text = typed(scores[s.student_id]);
    return c && text !== '' && Number(text) !== c.score; });
  const cell = (s, a) => { const c = s.scores.find(x => x.assessment_id === a.id); return c ? `${decimal(c.score)}${c.corrected ? '*' : ''}` : '—'; };
  return <main className="dashboard-page">
    <header className="topbar"><div><strong>Alfa Gestão Escolar</strong><span>{user.name}</span></div>
      <button className="secondary-button" onClick={logout}>Sair</button></header>
    <div className="page-content">
      <nav className="structure-tabs" aria-label="Áreas da secretaria"><Link to="/secretaria">Estrutura escolar</Link><Link to="/secretaria/pessoas">Alunos e responsáveis</Link><Link to="/secretaria/matriculas">Matrículas</Link><Link to="/secretaria/profissionais">Profissionais</Link><Link to="/secretaria/notas" aria-current="page">Notas</Link><Link to="/secretaria/captacao">Captação</Link></nav>
      <h1>Notas e avaliações</h1>
      <p>Escolha a turma, crie a avaliação e lance as notas de 0 a 10. A média do aluno é Σ(nota × peso) / Σ(peso), nas avaliações em que ele tem nota. Use dados fictícios neste piloto.</p>
      {success && <p className="success-message" role="status">{success}</p>}
      {error && <div className="error-message" role="alert">{error.message}
        {!!error.items?.length && <ul>{error.items.map(item => <li key={item}>{item}</li>)}</ul>}
        <button className="secondary-button" onClick={() => { setError(null); setRevision(n => n + 1); }}>Atualizar dados</button></div>}
      {loading ? <p role="status">Carregando turmas…</p> : <>
        <section className="panel"><h2>Turma</h2>
          <form className="structure-form" onSubmit={e => e.preventDefault()}><fieldset disabled={busy}>
            <div><label htmlFor="grades-group">Turma</label><select id="grades-group" value={groupId} onChange={chooseGroup}>
              <option value="">Selecione</option>{refs.groups.map(g => <option key={g.id} value={g.id}>{`${g.code} · ${year(g.academic_year_id)?.code || 'Período indisponível'}`}</option>)}</select></div>
            {!refs.groups.length && <p>Cadastre primeiro uma turma em Estrutura escolar.</p>}
          </fieldset></form>
        </section>
        {groupId && !book && <p role="status">Carregando a turma…</p>}
        {book && <>
          <section className="panel"><h2>Nova avaliação</h2>
            <form className="structure-form" onSubmit={saveAssessment}><fieldset disabled={busy}>
              <div><label htmlFor="grades-type">Tipo de avaliação</label><select id="grades-type" required value={form.assessment_type_id} onChange={e => setForm(f => ({ ...f, assessment_type_id: e.target.value }))}>
                <option value="">Selecione</option>{refs.types.map(t => <option key={t.id} value={t.id}>{`${t.name} · peso ${decimal(t.default_weight, 0)}`}</option>)}</select></div>
              <label>Título<input required maxLength={120} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}/></label>
              <label>Data<input type="date" required min={limits?.starts_on} max={limits?.ends_on} value={form.held_on} onChange={e => setForm(f => ({ ...f, held_on: e.target.value }))}/></label>
              <label>Peso (opcional)<input inputMode="decimal" placeholder={type ? `Padrão: ${decimal(type.default_weight, 0)}` : 'Padrão do tipo'} value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}/></label>
              {!refs.types.length && <p>Cadastre primeiro um tipo de avaliação, no fim da página.</p>}
              <button className="primary-button" disabled={busy || !refs.types.length}>{busy ? 'Salvando…' : 'Criar avaliação'}</button>
            </fieldset></form>
          </section>
          <section className="panel"><h2>Lançar notas</h2>
            <form className="structure-form" onSubmit={e => e.preventDefault()}><fieldset disabled={busy}>
              <div><label htmlFor="grades-assessment">Avaliação</label><select id="grades-assessment" value={assessmentId} onChange={e => { setAssessmentId(e.target.value); setReason(''); setSuccess(''); }}>
                <option value="">Selecione</option>{book.assessments.map(a => <option key={a.id} value={a.id}>{`${a.title} · ${civilDate(a.held_on)} · peso ${decimal(a.weight, 0)}`}</option>)}</select></div>
            </fieldset></form>
            {!students.length && <p>Nenhum aluno matriculado nesta turma.</p>}
            {assessment && !!students.length && <form onSubmit={saveScores}><fieldset disabled={busy} className="plain-fieldset">
              <div className="table-wrapper"><table>
                <thead><tr><th>Aluno</th><th>Nota atual</th><th>Nota</th></tr></thead>
                <tbody>{students.map(s => { const c = current(s); return <tr key={s.student_id}>
                  <td>{s.student_name}</td><td>{c ? `${decimal(c.score)}${c.corrected ? ' (corrigida)' : ''}` : 'Sem nota'}</td>
                  <td><input aria-label={`Nota de ${s.student_name}`} inputMode="decimal" maxLength={5} value={scores[s.student_id] ?? ''}
                    onChange={e => { const value = e.target.value; setScores(v => ({ ...v, [s.student_id]: value })); }}/></td></tr>; })}</tbody>
              </table></div>
              {correcting && <div className="structure-form"><label>Motivo da correção<input maxLength={300} value={reason} onChange={e => setReason(e.target.value)}/></label>
                <p>Mudar uma nota já lançada grava uma correção. A nota anterior continua no histórico.</p></div>}
              <button className="primary-button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar notas'}</button>
            </fieldset></form>}
          </section>
          <section className="panel"><h2>Histórico da turma</h2>
            {!book.assessments.length ? <p>Nenhuma avaliação nesta turma.</p> : <>
              <div className="table-wrapper"><table>
                <thead><tr><th>Aluno</th>{book.assessments.map(a => <th key={a.id}>{`${a.title} (${civilDate(a.held_on)}, peso ${decimal(a.weight, 0)})`}</th>)}<th>Média</th></tr></thead>
                <tbody>{students.map(s => <tr key={s.student_id}><td>{s.student_name}</td>{book.assessments.map(a => <td key={a.id}>{cell(s, a)}</td>)}<td>{decimal(s.average)}</td></tr>)}</tbody>
              </table></div>
              <p>* nota corrigida. A nota original fica no histórico de correções da avaliação.</p>
            </>}
          </section>
          {assessment && history && <section className="panel"><h2>Histórico de lançamentos — {assessment.title}</h2>
            {!history.items.length ? <p>Nenhuma nota lançada nesta avaliação.</p> : <div className="table-wrapper"><table>
              <thead><tr>{['Aluno','Nota','Situação','Motivo da correção','Lançada por','Quando'].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{history.items.map(i => <tr key={i.id}><td>{i.student_name}</td><td>{decimal(i.score)}</td><td>{i.current ? 'Vigente' : 'Substituída'}</td>
                <td>{i.reason || '—'}</td><td>{i.created_by_name}</td><td>{new Date(i.created_at).toLocaleString('pt-BR')}</td></tr>)}</tbody>
            </table></div>}
          </section>}
        </>}
        <section className="panel"><h2>Tipos de avaliação</h2>
          {!refs.types.length ? <p>Nenhum tipo cadastrado.</p> : <ul>{refs.types.map(t => <li key={t.id}>{`${t.code} · ${t.name} · peso padrão ${decimal(t.default_weight, 0)}`}</li>)}</ul>}
          <form className="structure-form" onSubmit={saveType}><fieldset disabled={busy}>
            <label>Código<input required maxLength={20} value={typeForm.code} onChange={e => setTypeForm(f => ({ ...f, code: e.target.value }))}/></label>
            <label>Nome do tipo<input required maxLength={80} value={typeForm.name} onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))}/></label>
            <label>Peso padrão<input required inputMode="decimal" value={typeForm.default_weight} onChange={e => setTypeForm(f => ({ ...f, default_weight: e.target.value }))}/></label>
            <button className="primary-button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar tipo'}</button>
          </fieldset></form>
        </section>
      </>}
      <section className="panel"><h2>Escopo desta tela</h2><p>Nesta entrega, a secretaria lança as notas com o acesso de administrador. A conta do professor, os bimestres, o boletim e o aviso às famílias são entregas posteriores. Nenhuma nota é apagada: a correção grava um novo lançamento com o motivo.</p></section>
    </div>
  </main>;
}
