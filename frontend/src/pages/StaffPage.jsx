import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const tabs = [['members','Profissionais'],['assignments','Atribuições']];
const roles = [['regente','Regente'],['auxiliar','Auxiliar'],['especialista','Especialista']];
const initial = () => ({ full_name:'', phone:'', email:'', staff_member_id:'', class_group_id:'', role:'', starts_on:'', ends_on:'' });
const initialEnding = () => ({ assignment_id:'', ended_on:'' });
const civil = date => date?.split('-').reverse().join('/') || '';
export default function StaffPage() {
  const { user, logout, staff, structure } = useAuth();
  const [tab,setTab] = useState('members');
  const [form,setForm] = useState(initial);
  const [ending,setEnding] = useState(initialEnding);
  const [items,setItems] = useState([]);
  const [refs,setRefs] = useState({ members:[], groups:[], years:[] });
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
    let live=true;
    const controller=new AbortController();
    setLoading(true); setError('');
    async function all(request,resource) {
      const items=[]; let page=1;
      for (;;) {
        const data=await request(`${resource}?page=${page++}`,{signal:controller.signal});
        items.push(...data.items);
        if (!data.has_more) return items;
      }
    }
    Promise.all([staff(`${tab}?page=${page}`,{signal:controller.signal}),
      tab === 'assignments' ? Promise.all([all(staff,'members'),all(structure,'class-groups'),all(structure,'academic-years')]) : Promise.resolve([[],[],[]])])
      .then(([data,[members,groups,years]])=>{
        if(live){setItems(data.items);setMore(data.has_more);setRefs({members,groups,years});}
      }).catch(e=>{if(live)setError(e.message);})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;controller.abort();};
  },[tab,page,revision,staff,structure]);
  function field(e) { const {name,value}=e.target; setForm(f=>({...f,[name]:value})); }
  function endingField(e) { const {name,value}=e.target; setEnding(f=>({...f,[name]:value})); }
  function switchTab(value) {
    if(value===tab)return;
    setLoading(true);setItems([]);setTab(value);setPage(1);setForm(initial());setEnding(initialEnding());setSuccess('');
  }
  async function send(resource,payload,message,reset) {
    if(saving.current)return;
    saving.current=true;setBusy(true);setSuccess('');setError('');
    const body=JSON.stringify(payload);
    if(!attempt.current || attempt.current.body!==body || attempt.current.resource!==resource)attempt.current={body,resource,key:crypto.randomUUID()};
    try {
      await staff(resource,{method:'POST',body,headers:{'Idempotency-Key':attempt.current.key}});
      setSuccess(message);reset();attempt.current=null;setRevision(n=>n+1);
    } catch(e) {setError(e.message);}
    finally {saving.current=false;setBusy(false);}
  }
  function save(e) {
    e.preventDefault();
    const payload=tab === 'members' ? {full_name:form.full_name,phone:form.phone.trim() || null,email:form.email.trim() || null}
      : {staff_member_id:form.staff_member_id,class_group_id:form.class_group_id,role:form.role,starts_on:form.starts_on,ends_on:form.ends_on || null};
    send(tab,payload,'Cadastro salvo na sua escola.',()=>{setForm(initial());setPage(1);});
  }
  function end(e) {
    e.preventDefault();
    send('assignment-endings',{assignment_id:ending.assignment_id,ended_on:ending.ended_on},'Atribuição encerrada na data informada.',()=>setEnding(initialEnding()));
  }
  const year = id => refs.years.find(y=>y.id===id);
  const group = refs.groups.find(g=>g.id===form.class_group_id);
  const limits = year(group?.academic_year_id);
  const memberLabel = m => `${m.full_name} · ${m.email || m.phone || 'Sem contato'} · ID ${m.id}`;
  const groupLabel = g => `${g.code} · ${year(g.academic_year_id)?.code || 'Período indisponível'}`;
  const roleName = code => roles.find(r=>r[0]===code)?.[1] || code;
  const assignmentLabel = a => `${a.staff_member_name} · ${a.class_group_code} · ${a.academic_year_code} · ${roleName(a.role)} · desde ${civil(a.starts_on)}`;
  const open = items.filter(a=>!a.ended_on);
  const target = open.find(a=>a.id===ending.assignment_id);
  const missing = !refs.members.length || !refs.groups.length;
  return <main className="dashboard-page">
    <header className="topbar"><div><strong>Alfa Gestão Escolar</strong><span>{user.name}</span></div>
      <button className="secondary-button" onClick={logout}>Sair</button></header>
    <div className="page-content">
      <nav className="structure-tabs" aria-label="Áreas da secretaria"><Link to="/secretaria">Estrutura escolar</Link><Link to="/secretaria/pessoas">Alunos e responsáveis</Link><Link to="/secretaria/matriculas">Matrículas</Link><Link to="/secretaria/profissionais" aria-current="page">Profissionais</Link><Link to="/secretaria/captacao">Captação</Link></nav>
      <h1>Profissionais</h1><p>Cadastre os profissionais e atribua cada um às turmas em que atua. Use dados fictícios neste piloto.</p>
      <nav className="structure-tabs" aria-label="Cadastros de profissionais">{tabs.map(([key,label])=><button key={key} className={tab===key?'primary-button':'secondary-button'} aria-current={tab===key?'page':undefined} disabled={busy} onClick={()=>switchTab(key)}>{label}</button>)}</nav>
      {success && <p className="success-message" role="status">{success}</p>}
      {error && <div className="error-message" role="alert">{error} <button className="secondary-button" onClick={()=>setRevision(n=>n+1)}>Atualizar dados</button></div>}
      {loading ? <p role="status">Carregando cadastros…</p> : <>
        <section className="panel"><h2>Novo cadastro — {tabs.find(t=>t[0]===tab)[1]}</h2>
          <form className="structure-form" onSubmit={save}><fieldset disabled={busy}>
            {tab === 'members' ? <>
              <label>Nome completo<input required name="full_name" maxLength={150} value={form.full_name} onChange={field}/></label>
              <label>Telefone (opcional)<input type="tel" name="phone" maxLength={30} value={form.phone} onChange={field}/></label>
              <label>E-mail (opcional)<input type="email" name="email" maxLength={150} value={form.email} onChange={field}/></label>
              <p>O cadastro não cria conta de acesso para o profissional.</p>
            </> : <>
              <div><label htmlFor="staff-member">Profissional</label><select id="staff-member" required name="staff_member_id" value={form.staff_member_id} onChange={field}><option value="">Selecione</option>{refs.members.map(m=><option key={m.id} value={m.id}>{memberLabel(m)}</option>)}</select></div>
              <div><label htmlFor="staff-group">Turma</label><select id="staff-group" required name="class_group_id" value={form.class_group_id} onChange={field}><option value="">Selecione</option>{refs.groups.map(g=><option key={g.id} value={g.id}>{groupLabel(g)}</option>)}</select></div>
              <div><label htmlFor="staff-role">Papel na turma</label><select id="staff-role" required name="role" value={form.role} onChange={field}><option value="">Selecione</option>{roles.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></div>
              <label>Início<input type="date" required name="starts_on" min={limits?.starts_on} max={limits?.ends_on} value={form.starts_on} onChange={field}/></label>
              <label>Fim (opcional)<input type="date" name="ends_on" min={form.starts_on || limits?.starts_on} max={limits?.ends_on} value={form.ends_on} onChange={field}/></label>
              <p>Sem data de fim, a atribuição vale até o fim do período letivo da turma{limits ? ` (${civil(limits.ends_on)})` : ''}.</p>
              {missing && <p>Cadastre primeiro um profissional e uma turma.</p>}
            </>}
            <button className="primary-button" disabled={busy || (tab==='assignments' && missing)}>{busy?'Salvando…':'Salvar cadastro'}</button>
          </fieldset></form>
        </section>
        {tab === 'assignments' && <section className="panel"><h2>Encerrar atribuição</h2>
          <form className="structure-form" onSubmit={end}><fieldset disabled={busy}>
            <div><label htmlFor="staff-ending">Atribuição em aberto</label><select id="staff-ending" required name="assignment_id" value={ending.assignment_id} onChange={endingField}><option value="">Selecione</option>{open.map(a=><option key={a.id} value={a.id}>{assignmentLabel(a)}</option>)}</select></div>
            <label>Último dia na turma<input type="date" required name="ended_on" min={target?.starts_on} max={target?.effective_ends_on} value={ending.ended_on} onChange={endingField}/></label>
            <p>O encerramento não apaga a atribuição: o histórico de quem atuou na turma é preservado.</p>
            {!open.length && <p>Nenhuma atribuição em aberto nesta página.</p>}
            <button className="primary-button" disabled={busy || !open.length}>{busy?'Salvando…':'Encerrar atribuição'}</button>
          </fieldset></form>
        </section>}
        <section className="panel"><h2>Cadastros da escola</h2>
          {!items.length ? <p>Nenhum cadastro nesta página.</p> : <div className="table-wrapper"><table>
            <thead><tr>{(tab==='members'?['Profissional','Contatos','Identificação']:['Profissional','Turma','Papel','Início','Fim','Situação']).map(label=><th key={label}>{label}</th>)}</tr></thead>
            <tbody>{items.map(item=><tr key={item.id}>{tab==='members'
              ? <><td>{item.full_name}</td><td>{[item.phone,item.email].filter(Boolean).join(' · ') || 'Sem contato'}</td><td>{item.id}</td></>
              : <><td>{item.staff_member_name} · ID {item.staff_member_id}</td><td>{item.class_group_code} · {item.academic_year_code}</td><td>{roleName(item.role)}</td><td>{civil(item.starts_on)}</td><td>{civil(item.effective_ends_on)}</td><td>{item.ended_on ? 'Encerrada' : 'Em aberto'}</td></>}</tr>)}</tbody>
          </table></div>}
          <div className="structure-tabs"><button className="secondary-button" disabled={page===1 || busy} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page}</span><button className="secondary-button" disabled={!more || busy} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>
        </section>
      </>}
      <section className="panel"><h2>Escopo deste cadastro</h2><p>Cadastro de profissionais e atribuição às turmas, com vários profissionais por turma e datas de início e fim. Conta de acesso do professor, disciplinas, horários, edição e exclusão são entregas posteriores.</p></section>
    </div>
  </main>;
}
