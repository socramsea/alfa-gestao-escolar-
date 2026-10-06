import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import ImportPanel from './ImportPanel.jsx';

const tabs = [['students','Alunos'],['guardians','Responsáveis'],['student-guardians','Vínculos'],['import','Importar planilha']];
const initial = () => ({ full_name:'', birth_date:'', phone:'', email:'', student_id:'', guardian_id:'', relationship:'', is_legal:false });
const civil = date => date?.split('-').reverse().join('/') || '';
export default function PeoplePage() {
  const { user, logout, people } = useAuth();
  const [tab,setTab] = useState('students');
  const [form,setForm] = useState(initial);
  const [items,setItems] = useState([]);
  const [refs,setRefs] = useState({ students:[], guardians:[] });
  const [page,setPage] = useState(1);
  const [more,setMore] = useState(false);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const [revision,setRevision] = useState(0);
  const saving = useRef(false);
  const attempt = useRef(null);
  useEffect(() => {
    if(tab==='import'){setLoading(false);return undefined;}
    let live=true;
    const controller=new AbortController();
    setLoading(true); setError('');
    async function all(resource) {
      const items=[]; let page=1;
      for (;;) {
        const data=await people(`${resource}?page=${page++}`,{signal:controller.signal});
        items.push(...data.items);
        if (!data.has_more) return items;
      }
    }
    Promise.all([people(`${tab}?page=${page}`,{signal:controller.signal}),
      tab === 'student-guardians' ? Promise.all([all('students'),all('guardians')]) : Promise.resolve([[],[]])])
      .then(([data,[students,guardians]])=>{
        if(live){setItems(data.items);setMore(data.has_more);setRefs({students,guardians});}
      }).catch(e=>{if(live)setError(e.message);})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;controller.abort();};
  },[tab,page,revision,people]);
  function field(e) { const {name,value,type,checked}=e.target; setForm(f=>({...f,[name]:type === 'checkbox' ? checked : value})); }
  function switchTab(value) {
    if(value===tab)return;
    setLoading(true);setItems([]);setTab(value);setPage(1);setForm(initial());setSuccess('');
  }
  async function save(e) {
    e.preventDefault();if(saving.current)return;
    saving.current=true;setBusy(true);setSuccess('');setError('');
    const payload=tab === 'students' ? {full_name:form.full_name,birth_date:form.birth_date}
      : tab === 'guardians' ? {full_name:form.full_name,phone:form.phone.trim() || null,email:form.email.trim() || null}
        : {student_id:form.student_id,guardian_id:form.guardian_id,relationship:form.relationship,is_legal:form.is_legal};
    const body=JSON.stringify(payload);
    if(!attempt.current || attempt.current.body!==body || attempt.current.tab!==tab)attempt.current={body,tab,key:crypto.randomUUID()};
    try {
      await people(tab,{method:'POST',body,headers:{'Idempotency-Key':attempt.current.key}});
      setSuccess('Cadastro salvo na sua escola.');setForm(initial());attempt.current=null;setPage(1);setRevision(n=>n+1);
    } catch(e) {setError(e.message);}
    finally {saving.current=false;setBusy(false);}
  }
  const studentLabel = s => `${s.full_name} · ${civil(s.birth_date)} · ID ${s.id}`;
  const guardianLabel = g => `${g.full_name} · ${g.email || g.phone || 'Sem contato'} · ID ${g.id}`;
  const student = id => refs.students.find(s=>s.id===id);
  const guardian = id => refs.guardians.find(g=>g.id===id);
  return <main className="dashboard-page">
    <header className="topbar"><div><strong>Alfa Gestão Escolar</strong><span>{user.name}</span></div>
      <button className="secondary-button" onClick={logout}>Sair</button></header>
    <div className="page-content">
      <nav className="structure-tabs" aria-label="Áreas da secretaria"><Link to="/secretaria">Estrutura escolar</Link><Link to="/secretaria/pessoas" aria-current="page">Alunos e responsáveis</Link><Link to="/secretaria/matriculas">Matrículas</Link><Link to="/secretaria/profissionais">Profissionais</Link><Link to="/secretaria/notas">Notas</Link><Link to="/secretaria/captacao">Captação</Link></nav>
      <h1>Alunos e responsáveis</h1><p>Cadastre as pessoas e vincule cada responsável ao aluno. Use dados fictícios neste piloto.</p>
      <nav className="structure-tabs" aria-label="Cadastros de pessoas">{tabs.map(([key,label])=><button key={key} className={tab===key?'primary-button':'secondary-button'} aria-current={tab===key?'page':undefined} disabled={busy} onClick={()=>switchTab(key)}>{label}</button>)}</nav>
      {success && <p className="success-message" role="status">{success}</p>}
      {error && <div className="error-message" role="alert">{error} <button className="secondary-button" onClick={()=>setRevision(n=>n+1)}>Atualizar dados</button></div>}
      {tab==='import' ? <ImportPanel /> : loading ? <p role="status">Carregando cadastros…</p> : <>
        <section className="panel"><h2>Novo cadastro — {tabs.find(t=>t[0]===tab)[1]}</h2>
          <form className="structure-form" onSubmit={save}><fieldset disabled={busy}>
            {tab !== 'student-guardians' && <label>Nome completo<input required name="full_name" maxLength={150} value={form.full_name} onChange={field}/></label>}
            {tab === 'students' && <label>Data de nascimento<input type="date" required name="birth_date" min="1900-01-01" max={new Date().toISOString().slice(0,10)} value={form.birth_date} onChange={field}/></label>}
            {tab === 'guardians' && <><label>Telefone (opcional)<input type="tel" name="phone" maxLength={30} value={form.phone} onChange={field}/></label>
              <label>E-mail (opcional)<input type="email" name="email" maxLength={150} value={form.email} onChange={field}/></label></>}
            {tab === 'student-guardians' && <>
              <div><label htmlFor="people-student">Aluno</label><select id="people-student" required name="student_id" value={form.student_id} onChange={field}><option value="">Selecione</option>{refs.students.map(s=><option key={s.id} value={s.id}>{studentLabel(s)}</option>)}</select></div>
              <div><label htmlFor="people-guardian">Responsável</label><select id="people-guardian" required name="guardian_id" value={form.guardian_id} onChange={field}><option value="">Selecione</option>{refs.guardians.map(g=><option key={g.id} value={g.id}>{guardianLabel(g)}</option>)}</select></div>
              <label>Parentesco ou relação<input required name="relationship" maxLength={80} placeholder="Ex.: mãe, pai, avó, tutor" value={form.relationship} onChange={field}/></label>
              <label className="check-label"><input type="checkbox" name="is_legal" checked={form.is_legal} onChange={field}/>Responsável legal</label>
              <p>O vínculo não cria uma conta nem concede acesso ao portal.</p>
              {(!refs.students.length || !refs.guardians.length) && <p>Cadastre primeiro um aluno e um responsável.</p>}
            </>}
            <button className="primary-button" disabled={busy || (tab==='student-guardians' && (!refs.students.length || !refs.guardians.length))}>{busy?'Salvando…':'Salvar cadastro'}</button>
          </fieldset></form>
        </section>
        <section className="panel"><h2>Cadastros da escola</h2>
          {!items.length ? <p>Nenhum cadastro nesta página.</p> : <div className="table-wrapper"><table>
            <thead><tr>{(tab==='students'?['Aluno','Nascimento','Identificação']:tab==='guardians'?['Responsável','Contatos','Identificação']:['Aluno','Responsável','Relação','Responsável legal']).map(label=><th key={label}>{label}</th>)}</tr></thead>
            <tbody>{items.map(item=><tr key={item.id}>{tab==='students'?<><td>{item.full_name}</td><td>{civil(item.birth_date)}</td><td>{item.id}</td></>:tab==='guardians'?<><td>{item.full_name}</td><td>{[item.phone,item.email].filter(Boolean).join(' · ') || 'Sem contato'}</td><td>{item.id}</td></>:<><td>{student(item.student_id) ? studentLabel(student(item.student_id)) : 'Aluno indisponível'}</td><td>{guardian(item.guardian_id) ? guardianLabel(guardian(item.guardian_id)) : 'Responsável indisponível'}</td><td>{item.relationship}</td><td>{item.is_legal?'Sim':'Não'}</td></>}</tr>)}</tbody>
          </table></div>}
          <div className="structure-tabs"><button className="secondary-button" disabled={page===1 || busy} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page}</span><button className="secondary-button" disabled={!more || busy} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>
        </section>
      </>}
      <section className="panel"><h2>Escopo deste cadastro</h2><p>Cadastro e consulta de alunos, responsáveis e vínculos. Matrículas estão disponíveis na área própria; edição, exclusão e portal da família são entregas posteriores.</p></section>
    </div>
  </main>;
}
