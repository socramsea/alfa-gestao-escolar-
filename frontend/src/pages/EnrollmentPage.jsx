import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const initial=()=>({student_id:'',academic_year_id:'',class_group_id:'',level_id:''});
const date=value=>value?.split('-').reverse().join('/')||'';
export default function EnrollmentPage(){
  const {user,logout,people,structure,enroll}=useAuth();
  const [students,setStudents]=useState([]),[years,setYears]=useState([]),[groups,setGroups]=useState([]),[levels,setLevels]=useState([]),[items,setItems]=useState([]);
  const [form,setForm]=useState(initial);const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[revision,setRevision]=useState(0);
  const [page,setPage]=useState(1),[more,setMore]=useState(false);
  const saving=useRef(false),attempt=useRef(null);
  useEffect(()=>{
    let live=true;const controller=new AbortController();setLoading(true);setError('');
    async function all(request,resource){const result=[];let page=1;for(;;){const data=await request(`${resource}?page=${page++}`,{signal:controller.signal});result.push(...data.items);if(!data.has_more)return result;}}
    Promise.all([all(people,'students'),all(structure,'academic-years'),all(structure,'class-groups'),all(structure,'levels'),enroll(`?page=${page}`,{signal:controller.signal})])
      .then(([s,y,g,l,e])=>{if(live){setStudents(s);setYears(y);setGroups(g);setLevels(l);setItems(e.items);setMore(e.has_more);}})
      .catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;controller.abort();};
  },[people,structure,enroll,page,revision]);
  const availableGroups=groups.filter(g=>g.academic_year_id===form.academic_year_id);
  const availableLevels=levels.filter(l=>l.stage_code===groups.find(g=>g.id===form.class_group_id)?.stage_code
    && groups.find(g=>g.id===form.class_group_id)?.level_ids?.includes(l.id));
  function setField(e){const {name,value}=e.target;setForm(f=>({...f,[name]:value,
    ...(name==='academic_year_id'?{class_group_id:'',level_id:''}:{}),...(name==='class_group_id'?{level_id:''}:{})}));}
  async function submit(e){
    e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('');setSuccess('');
    const payload={student_id:form.student_id,class_group_id:form.class_group_id,level_id:form.level_id};const body=JSON.stringify(payload);
    if(!attempt.current||attempt.current.body!==body)attempt.current={body,key:crypto.randomUUID()};
    try{await enroll('',{method:'POST',body,headers:{'Idempotency-Key':attempt.current.key}});setForm(initial());attempt.current=null;setSuccess('Matrícula confirmada na turma selecionada.');setRevision(n=>n+1);}
    catch(e){setError(e.message);}finally{saving.current=false;setBusy(false);}
  }
  const yearName=id=>years.find(y=>y.id===id)?.code||'';
  const groupName=id=>{const g=groups.find(x=>x.id===id);return g?`${g.code} · ${yearName(g.academic_year_id)}`:'Turma indisponível';};
  const levelName=id=>levels.find(l=>l.id===id)?.name||'Grupo/série indisponível';
  return <main className="dashboard-page">
    <header className="topbar"><div><strong>Alfa Gestão Escolar</strong><span>{user.name}</span></div><button className="secondary-button" onClick={logout}>Sair</button></header>
    <div className="page-content">
      <nav className="structure-tabs" aria-label="Áreas da secretaria"><Link to="/secretaria">Estrutura escolar</Link><Link to="/secretaria/pessoas">Alunos e responsáveis</Link><Link to="/secretaria/matriculas" aria-current="page">Matrículas</Link><Link to="/secretaria/profissionais">Profissionais</Link></nav>
      <h1>Matrículas</h1><p>Confirme a matrícula de um aluno em uma turma e grupo/série do período. Use dados fictícios neste piloto.</p>
      {success&&<p className="success-message" role="status">{success}</p>}
      {error&&<div className="error-message" role="alert">{error} <button className="secondary-button" onClick={()=>setRevision(n=>n+1)}>Atualizar dados</button></div>}
      {loading?<p role="status">Carregando cadastros…</p>:<>
        <section className="panel"><h2>Confirmar matrícula</h2>
          <form className="structure-form" onSubmit={submit}><fieldset disabled={busy||!!error}>
            <div><label htmlFor="enrollment-student">Aluno</label><select id="enrollment-student" required name="student_id" value={form.student_id} onChange={setField}><option value="">Selecione</option>{students.map(s=><option key={s.id} value={s.id}>{s.full_name} · {date(s.birth_date)} · ID {s.id}</option>)}</select></div>
            <div><label htmlFor="enrollment-year">Período letivo</label><select id="enrollment-year" required name="academic_year_id" value={form.academic_year_id} onChange={setField}><option value="">Selecione</option>{years.map(y=><option key={y.id} value={y.id}>{y.code} · {date(y.starts_on)} a {date(y.ends_on)}</option>)}</select></div>
            <div><label htmlFor="enrollment-group">Turma (obrigatória)</label><select id="enrollment-group" required name="class_group_id" value={form.class_group_id} onChange={setField} disabled={!form.academic_year_id}><option value="">Selecione</option>{availableGroups.map(g=><option key={g.id} value={g.id}>{g.code} · {g.stage_code}</option>)}</select>{form.academic_year_id&&!availableGroups.length&&<span>Nenhuma turma cadastrada neste período.</span>}</div>
            <div><label htmlFor="enrollment-level">Grupo/série</label><select id="enrollment-level" required name="level_id" value={form.level_id} onChange={setField} disabled={!form.class_group_id}><option value="">Selecione</option>{availableLevels.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select>{form.class_group_id&&!availableLevels.length&&<span>Esta turma não possui grupo/série compatível.</span>}</div>
            {!students.length&&<p>Cadastre o aluno primeiro na área Alunos e responsáveis.</p>}
            <button className="primary-button" disabled={busy||!students.length}>{busy?'Salvando…':'Confirmar matrícula'}</button>
          </fieldset></form>
        </section>
        <section className="panel"><h2>Matrículas da escola</h2>{!items.length?<p>Nenhuma matrícula nesta página.</p>:<div className="table-wrapper"><table><thead><tr><th>Aluno</th><th>Período</th><th>Turma</th><th>Grupo/série</th><th>Confirmada em</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.student_name} · ID {item.student_id}</td><td>{item.academic_year_code}</td><td>{groupName(item.class_group_id)}</td><td>{levelName(item.level_id)}</td><td>{new Date(item.created_at).toLocaleDateString('pt-BR')}</td></tr>)}</tbody></table></div>}
          <div className="structure-tabs"><button className="secondary-button" disabled={page===1||busy} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page}</span><button className="secondary-button" disabled={!more||busy} onClick={()=>setPage(p=>p+1)}>Próxima</button></div></section>
      </>}
      <section className="panel"><h2>Escopo desta entrega</h2><p>Uma matrícula por aluno em cada período letivo. Turma é obrigatória. Controle de vagas, renovação, transferência, edição e cancelamento ainda não estão implementados.</p></section>
    </div>
  </main>;
}
