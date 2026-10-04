import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const tabs = [['stages','1. Etapas'],['academic-years','2. Períodos'],['levels','3. Grupos e séries'],
  ['shifts','4. Turnos'],['class-groups','5. Turmas']];
const initial = () => ({ code: '', name: '', stage_code: '', starts_on: '', ends_on: '', academic_year_id: '', shift_id: '', level_ids: [] });
export default function StructurePage() {
  const { user, logout, structure } = useAuth();
  const [tab,setTab] = useState('stages');
  const [catalog,setCatalog] = useState(null);
  const [refs,setRefs] = useState({ stages: [], 'academic-years': [], levels: [], shifts: [] });
  const [items,setItems] = useState([]);
  const [page,setPage] = useState(1);
  const [more,setMore] = useState(false);
  const [form,setForm] = useState(initial);
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const [revision,setRevision] = useState(0);
  const attempt = useRef(null);
  const saving = useRef(false);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLoading(true); setError('');
    async function all(resource) {
      const rows = []; let p = 1;
      for (;;) {
        const result = await structure(`${resource}?page=${p++}`, { signal: controller.signal });
        rows.push(...result.items);
        if (!result.has_more) return rows;
      }
    }
    Promise.all([structure('catalog', { signal: controller.signal }),
      structure(`${tab}?page=${page}`, { signal: controller.signal }),
      Promise.all(['stages','academic-years','levels','shifts'].map(async r => [r,await all(r)]))])
      .then(([c,data,references]) => {
        if (!live) return;
        setCatalog(c); setItems(data.items); setMore(data.has_more); setRefs(Object.fromEntries(references));
      }).catch(e => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [tab,page,revision,structure]);
  const stageName = code => catalog?.stages.find(s => s.code === code)?.name || code;
  const field = e => setForm(f => ({ ...f, [e.target.name]: e.target.value,
    ...(e.target.name === 'stage_code' ? { level_ids: [] } : {}) }));
  async function save(e) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setSuccess('');
    const payload = tab === 'stages' ? { code: form.code }
      : tab === 'academic-years' ? { code: form.code, starts_on: form.starts_on, ends_on: form.ends_on }
      : tab === 'levels' ? { code: form.code, name: form.name, stage_code: form.stage_code }
      : tab === 'shifts' ? { code: form.code, name: form.name }
      : { code: form.code, stage_code: form.stage_code, academic_year_id: form.academic_year_id,
        shift_id: form.shift_id, level_ids: [...form.level_ids].sort() };
    const body = JSON.stringify(payload);
    if (!attempt.current || attempt.current.body !== body || attempt.current.tab !== tab) {
      attempt.current = { body, tab, key: crypto.randomUUID() };
    }
    try {
      await structure(tab, { method: 'POST', body, headers: { 'Idempotency-Key': attempt.current.key } });
      setSuccess('Cadastro salvo na sua escola.'); setForm(initial()); attempt.current = null;
      setPage(1); setRevision(n => n+1);
    } catch (err) { setError(err.message); }
    finally { saving.current = false; setBusy(false); }
  }
  function select(name,label,options) {
    return <div><label htmlFor={`structure-${name}`}>{label}</label><select id={`structure-${name}`} required name={name} value={form[name]} onChange={field}>
      <option value="">Selecione</option>{options.map(([value,text]) => <option key={value} value={value}>{text}</option>)}
    </select></div>;
  }
  return <main className="dashboard-page">
    <header className="topbar"><div><strong>Alfa Gestão Escolar</strong><span>{user.name}</span></div>
      <button className="secondary-button" onClick={logout}>Sair</button></header>
    <div className="page-content">
      <nav className="structure-tabs" aria-label="Áreas da secretaria"><Link to="/secretaria" aria-current="page">Estrutura escolar</Link><Link to="/secretaria/pessoas">Alunos e responsáveis</Link><Link to="/secretaria/matriculas">Matrículas</Link><Link to="/secretaria/profissionais">Profissionais</Link></nav>
      <p className="eyebrow">Configuração da escola</p><h1>Estrutura escolar</h1>
      <p>Prepare as etapas, os períodos e as turmas da sua escola. Os cadastros são salvos no sistema.</p>
      <nav className="structure-tabs" aria-label="Cadastros da estrutura">{tabs.map(([key,label]) =>
        <button key={key} className={tab === key ? 'primary-button' : 'secondary-button'} aria-current={tab === key ? 'page' : undefined}
          disabled={busy} onClick={() => { if (key === tab) return; setLoading(true); setItems([]); setTab(key); setPage(1); setForm(initial()); setSuccess(''); }}>{label}</button>)}</nav>
      {success && <p className="success-message" role="status">{success}</p>}
      {error && <div className="error-message" role="alert">{error} <button className="secondary-button" onClick={() => setRevision(n => n+1)}>Atualizar dados</button></div>}
      {loading ? <p role="status">Carregando cadastros…</p> : <>
        <section className="panel"><h2>Novo cadastro — {tabs.find(t => t[0] === tab)[1].slice(3)}</h2>
          <form onSubmit={save} className="structure-form"><fieldset disabled={busy || (!catalog && !!error)}>
            {tab === 'stages' ? select('code','Etapa oferecida', (catalog?.stages || []).filter(s => !refs.stages.some(r => r.code === s.code)).map(s => [s.code,s.name]))
              : <label>Código<input required name="code" maxLength={40} pattern="[A-Za-z0-9_-]+" value={form.code} onChange={field} placeholder="Ex.: MANHA, 2027, 6A" /></label>}
            {['levels','class-groups'].includes(tab) && select('stage_code','Etapa',refs.stages.map(s => [s.code,stageName(s.code)]))}
            {['levels','shifts'].includes(tab) && <label>Nome<input required name="name" maxLength={150} value={form.name} onChange={field} /></label>}
            {tab === 'academic-years' && <><label>Início<input type="date" required name="starts_on" min="1900-01-01" max="2200-12-31" value={form.starts_on} onChange={field} /></label>
              <label>Fim<input type="date" required name="ends_on" min={form.starts_on || '1900-01-01'} max="2200-12-31" value={form.ends_on} onChange={field} /></label></>}
            {tab === 'class-groups' && <>
              {select('academic_year_id','Período letivo',refs['academic-years'].map(y => [y.id,y.code]))}
              {select('shift_id','Turno',refs.shifts.map(s => [s.id,s.name]))}
              <div><p>Grupos/séries da turma (mesma etapa)</p>
                {refs.levels.filter(l => l.stage_code === form.stage_code).map(l => <label className="check-label" key={l.id}>
                  <input type="checkbox" checked={form.level_ids.includes(l.id)} onChange={e => setForm(f => ({ ...f,
                    level_ids: e.target.checked ? [...f.level_ids,l.id] : f.level_ids.filter(id => id !== l.id) }))} />{l.name}</label>)}
                {!refs.levels.some(l => l.stage_code === form.stage_code) && <p>Selecione a etapa e cadastre seus grupos/séries primeiro.</p>}</div>
            </>}
            <button className="primary-button" disabled={busy || (tab === 'class-groups' && !form.level_ids.length)}>{busy ? 'Salvando…' : 'Salvar cadastro'}</button>
          </fieldset></form>
        </section>
        <section className="panel"><h2>Cadastros da escola</h2>
          {!items.length ? <p>Nenhum cadastro nesta página.</p> : <div className="table-wrapper"><table>
            <thead><tr><th>Código</th><th>Descrição</th><th>Detalhes</th></tr></thead>
            <tbody>{items.map(item => <tr key={item.id}><td>{item.code}</td>
              <td>{tab === 'stages' ? stageName(item.code) : item.name || item.code}</td>
              <td>{tab === 'academic-years' ? `${item.starts_on?.slice(0,10) || ''} a ${item.ends_on?.slice(0,10) || ''}`
                : tab === 'levels' ? stageName(item.stage_code)
                : tab === 'class-groups' ? `${refs['academic-years'].find(y => y.id === item.academic_year_id)?.code || ''} · ${refs.shifts.find(s => s.id === item.shift_id)?.name || ''} · ${(item.level_ids || []).map(id => refs.levels.find(l => l.id === id)?.name || id).join(', ')}` : '—'}</td></tr>)}</tbody>
          </table></div>}
          <div className="structure-tabs"><button className="secondary-button" disabled={page === 1 || busy} onClick={() => setPage(p => p-1)}>Anterior</button>
            <span>Página {page}</span><button className="secondary-button" disabled={!more || busy} onClick={() => setPage(p => p+1)}>Próxima</button></div>
        </section>
      </>}
      <section className="panel"><h2>Escopo deste MVP</h2><p>Estrutura escolar disponível para testes. Matrículas, pedagógico, financeiro e portal da família ainda não estão implementados. Edição e exclusão de cadastros serão entregas posteriores.</p></section>
    </div>
  </main>;
}
