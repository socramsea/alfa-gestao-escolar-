import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool as admin } from '../../src/config/admin-db.js';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { admissionTables, create } from '../../src/modules/admissions/service.js';
import { submissionLimiter } from '../../src/modules/admissions/public.routes.js';
if(process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures')throw Error('Fixtures explicitas obrigatorias');
const base=process.env.TEST_BASE_URL;
const password=randomUUID();
const fixtures=[0,1].map(i=>({school_id:randomUUID(),sub:randomUUID(),email:`${randomUUID()}@captacao.test`,slug:`escola-${randomUUID().slice(0,8)}-${i}`}));
const [a,b]=fixtures;
// PNG 1x1 fictício.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const future=(days=3)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const content=(extra={})=>({hero:{title:'Escola fictícia'},about:{title:'Sobre'},location:{},contact:{},
  uniform:{items:[{name:'Camiseta',required:true}]},enrollment:{open:true,year:2027},
  levels:[{name:'Infantil 4'}],faq:[{question:'Tem integral?',answer:'Sim.'}],...extra});
const lead=(extra={})=>({guardian_name:'Responsável Fictícia',guardian_phone:'(11) 98765-4321',child_name:'Criança Fictícia',
  interest:'visita',consent:true,...extra});
async function api(who,path,data,key=randomUUID(),headers={}) {
  return fetch(`${base}/api/${path}`,{method:data!==undefined?'POST':'GET',
    headers:{...(who?{Authorization:`Bearer ${who.token}`}:{}),'Content-Type':'application/json','Idempotency-Key':key,...headers},
    ...(data!==undefined?{body:Buffer.isBuffer(data)?data:JSON.stringify(data)}:{})});
}
async function add(who,path,data,status=201) {
  const res=await api(who,`admissions/${path}`,data);assert.equal(res.status,status,await res.clone().text());return (await res.json()).item;
}
const publicSite=slug=>fetch(`${base}/api/public/sites/${slug}`);
const submit=(slug,data,key=randomUUID())=>fetch(`${base}/api/public/sites/${slug}/leads`,{method:'POST',
  headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(data)});
const count=(table,f=a)=>admin.query(`SELECT count(*)::int AS n FROM public.${table} WHERE school_id=$1`,[f.school_id]).then(r=>r.rows[0].n);
before(async()=>{
  const hash=await bcrypt.hash(password,12);
  for(const f of fixtures){
    await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Captação fictícia','active')",[f.school_id]);
    await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'Fixture',$3,$4,'school_admin')",[f.sub,f.school_id,f.email,hash]);
    const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});
    assert.equal(login.status,200);f.token=(await login.json()).token;
    await add(f,'site/address',{slug:f.slug});
    await add(f,'site/versions',{published:true,content:content()});
    f.slot=await add(f,'visit-slots',{date:future(),time:'09:00',capacity:2});
  }
});
after(async()=>{
  try{
    for(const table of ['admission_events','visit_booking_outcomes','visit_bookings','visit_slot_closures','visit_slots',
      'admission_lead_updates','admission_leads','school_site_versions','site_images','school_site_addresses','users']){
      await admin.query(`DELETE FROM public.${table} WHERE school_id=ANY($1::uuid[])`,[fixtures.map(f=>f.school_id)]);
    }
    await admin.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[fixtures.map(f=>f.school_id)]);
  }finally{await Promise.all([admin.end(),pool.end(),authPool.end()]);}
});

test('site: codigo unico na plataforma e imutavel; publicado mostra conteudo, horarios e nome so da propria escola',async()=>{
  assert.equal((await api(a,'admissions/site/address',{slug:b.slug})).status,409);
  assert.equal((await api(a,'admissions/site/address',{slug:`outro-${randomUUID().slice(0,6)}`})).status,409);
  for(const slug of ['ab','com espaco','-hifen','hifen-','dois--hifens','acentuação','x'.repeat(61)])assert.equal((await api(b,'admissions/site/address',{slug})).status,400);
  const res=await publicSite(a.slug);assert.equal(res.status,200);
  const site=await res.json();
  assert.equal(site.school_name,'Captação fictícia');assert.equal(site.content.hero.title,'Escola fictícia');
  assert.deepEqual(site.visit_slots.map(s=>s.id),[a.slot.id]);
  assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal((await publicSite('nao-existe-mesmo')).status,404);
  assert.equal((await publicSite('INVALIDO')).status,404);
});

test('site: ultima versao vale, despublicar esconde e historico e preservado',async()=>{
  await add(a,'site/versions',{published:true,content:content({hero:{title:'Versão nova'}})});
  assert.equal((await (await publicSite(a.slug)).json()).content.hero.title,'Versão nova');
  await add(a,'site/versions',{published:false,content:content({hero:{title:'Rascunho'}})});
  assert.equal((await publicSite(a.slug)).status,404);
  assert.equal((await submit(a.slug,lead())).status,404);
  const state=await (await api(a,'admissions/site')).json();
  assert.equal(state.current.content.hero.title,'Rascunho');assert.equal(state.current.published,false);
  assert.equal(await count('school_site_versions'),3);
  await add(a,'site/versions',{published:true,content:content()});
  assert.equal((await publicSite(a.slug)).status,200);
});

test('site: conteudo estrito e versao exige endereco definido',async()=>{
  for(const bad of [content({script:'x'}),content({hero:{title:''}}),content({hero:{title:'ok',extra:1}}),
    content({uniform:{items:[{name:'Camiseta'}]}}),content({faq:Array.from({length:41},()=>({question:'q',answer:'r'}))})]){
    assert.equal((await api(a,'admissions/site/versions',{published:true,content:bad})).status,400);
  }
  const school=randomUUID(),user=randomUUID();
  await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Sem endereço','active')",[school]);
  await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'x',$3,'x','school_admin')",[user,school,`${user}@captacao.test`]);
  try{
    await assert.rejects(()=>withTenant({school_id:school,sub:user},(c,u)=>create(c,u,'site-versions',{published:true,content:content()},randomUUID())),e=>e.statusCode===409);
  }finally{await admin.query('DELETE FROM users WHERE id=$1',[user]);await admin.query('DELETE FROM schools WHERE id=$1',[school]);}
});

test('fotos: assinatura conferida; publicas somente quando referenciadas na versao publicada da propria escola',async()=>{
  const upload=(who,body,type='image/png')=>api(who,'admissions/site/images',body,randomUUID(),{'Content-Type':type});
  assert.equal((await upload(a,Buffer.from('<svg onload="alert(1)"/>'))).status,400);
  assert.equal((await upload(a,PNG,'image/jpeg')).status,400);
  assert.equal((await upload(a,Buffer.alloc(0))).status,400);
  const res=await upload(a,PNG);assert.equal(res.status,201);const image=(await res.json()).item;
  assert.equal(image.content_type,'image/png');
  const preview=await api(a,`admissions/site/images/${image.id}`);assert.equal(preview.status,200);
  assert.equal((await api(b,`admissions/site/images/${image.id}`)).status,404);
  const url=slug=>fetch(`${base}/api/public/sites/${slug}/images/${image.id}`);
  assert.equal((await url(a.slug)).status,404);
  assert.equal((await api(b,'admissions/site/versions',{published:true,content:content({hero:{title:'B',image_id:image.id}})})).status,404);
  await add(a,'site/versions',{published:true,content:content({uniform:{items:[{name:'Camiseta',required:true,image_id:image.id}]}})});
  const served=await url(a.slug);assert.equal(served.status,200);
  assert.equal(served.headers.get('content-type'),'image/png');assert.equal(served.headers.get('x-content-type-options'),'nosniff');
  assert.match(served.headers.get('content-security-policy'),/default-src 'none'/);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()),PNG);
  assert.equal((await url(b.slug)).status,404);
  await add(a,'site/versions',{published:true,content:content()});
  assert.equal((await url(a.slug)).status,404);
});

test('pre-matricula publica: protocolo, campos opcionais, consentimento, campo-isca e validacao estrita',async()=>{
  const res=await submit(a.slug,lead({child_birth_date:'2022-04-22',desired_level:'Infantil 4',guardian_email:'  RESP@EXAMPLE.TEST ',
    message:'Gostaria de conhecer',how_heard:'Indicação',website:''}));
  assert.equal(res.status,201);const body=await res.json();
  assert.match(body.protocol,/^PM-[A-HJ-NP-Z2-9]{6}$/);assert.equal(body.visit_starts_at,null);
  const {rows:[row]}=await admin.query('SELECT * FROM admission_leads WHERE school_id=$1 AND protocol=$2',[a.school_id,body.protocol]);
  assert.equal(row.source,'site');assert.equal(row.guardian_email,'resp@example.test');assert.ok(row.consent_at);
  assert.equal(Object.keys(body).sort().join(),'protocol,visit_starts_at');
  const before=await count('admission_leads');
  for(const bad of [lead({consent:false}),lead({consent:undefined}),lead({website:'spam'}),lead({guardian_phone:'123'}),
    lead({child_name:' '}),lead({interest:'outro'}),lead({source:'site'}),lead({school_id:b.school_id}),
    lead({child_birth_date:'2022-02-30'}),lead({message:'x'.repeat(1001)})]){
    assert.equal((await submit(a.slug,bad)).status,400);
  }
  assert.equal((await fetch(`${base}/api/public/sites/${a.slug}/leads`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(lead())})).status,400);
  assert.equal(await count('admission_leads'),before);
});

test('pre-matricula publica: reenvio devolve o mesmo protocolo; dados diferentes com a mesma chave 409',async()=>{
  const key=randomUUID();
  const first=await submit(a.slug,lead({slot_id:a.slot.id}),key);assert.equal(first.status,201);
  const again=await submit(a.slug,lead({slot_id:a.slot.id}),key);assert.equal(again.status,200);
  const [x,y]=[await first.json(),await again.json()];
  assert.equal(x.protocol,y.protocol);assert.ok(x.visit_starts_at);assert.equal(new Date(x.visit_starts_at).getTime(),new Date(y.visit_starts_at).getTime());
  assert.equal((await submit(a.slug,lead({child_name:'Outra'}),key)).status,409);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM admission_leads WHERE school_id=$1 AND request_key=$2',[a.school_id,key])).rows[0].n,1);
  // Mesma chave em outra escola é outro pedido.
  assert.equal((await submit(b.slug,lead(),key)).status,201);
});

test('visitas: capacidade respeitada sob envios simultaneos; horario de outra escola ou fechado recusado sem gravar',async()=>{
  const slot=await add(a,'visit-slots',{date:future(4),time:'10:00',capacity:1});
  const before=await count('admission_leads');
  const results=await Promise.all([0,1,2].map(i=>submit(a.slug,lead({child_name:`Concorrente ${i}`,slot_id:slot.id}))));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409,409]);
  assert.equal(await count('admission_leads'),before+1);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM visit_bookings WHERE slot_id=$1',[slot.id])).rows[0].n,1);
  const site=await (await publicSite(a.slug)).json();assert.ok(!site.visit_slots.some(s=>s.id===slot.id));
  assert.equal((await submit(a.slug,lead({slot_id:b.slot.id}))).status,409);
  const closed=await add(a,'visit-slots',{date:future(4),time:'15:00',capacity:3});
  await add(a,'visit-slot-closures',{slot_id:closed.id});
  assert.equal((await submit(a.slug,lead({slot_id:closed.id}))).status,409);
  assert.equal(await count('admission_leads'),before+1);
  assert.equal((await api(a,'admissions/visit-slots',{date:'2020-01-01',time:'09:00',capacity:2})).status,400);
  assert.equal((await api(a,'admissions/visit-slots',{date:future(),time:'09:00',capacity:2})).status,409);
  for(const bad of [{date:future(),time:'25:00',capacity:2},{date:future(),time:'09:00',capacity:0},{date:future(),time:'09:00',capacity:21}]){
    assert.equal((await api(a,'admissions/visit-slots',bad)).status,400);
  }
});

test('captacao: situacao derivada do historico, reagendamento, comparecimento e contagens',async()=>{
  const created=await add(a,'leads',{...lead({interest:'matricula'}),source:'whatsapp'});
  assert.equal(created.status,'novo');assert.equal(created.source,'whatsapp');
  const status=async()=>(await (await api(a,`admissions/leads/${created.id}`)).json()).item;
  await add(a,'lead-updates',{lead_id:created.id,status:'em_contato',note:'Ligou pedindo valores'});
  assert.equal((await status()).status,'em_contato');
  const s1=await add(a,'visit-slots',{date:future(5),time:'09:00',capacity:2});
  const s2=await add(a,'visit-slots',{date:future(5),time:'14:30',capacity:2});
  const first=await add(a,'visit-bookings',{lead_id:created.id,slot_id:s1.id});
  assert.equal((await status()).status,'visita_agendada');
  const second=await add(a,'visit-bookings',{lead_id:created.id,slot_id:s2.id});
  let detail=await status();
  assert.equal(detail.active_booking_id,second.id);
  assert.deepEqual(detail.bookings.map(x=>x.outcome),[null,'cancelada']);
  assert.equal(detail.bookings[1].id,first.id);
  await add(a,'visit-outcomes',{booking_id:second.id,outcome:'compareceu'});
  assert.equal((await status()).status,'visitou');
  assert.equal((await api(a,'admissions/visit-outcomes',{booking_id:second.id,outcome:'nao_compareceu'})).status,409);
  await add(a,'lead-updates',{lead_id:created.id,status:'matriculado'});
  detail=await status();assert.equal(detail.status,'matriculado');
  assert.deepEqual(detail.updates.map(u=>u.status),['em_contato','visitou','matriculado']);
  assert.equal(detail.updates[0].author_name,'Fixture');
  assert.equal((await api(a,'admissions/visit-bookings',{lead_id:created.id,slot_id:s1.id})).status,409);
  const list=await (await api(a,'admissions/leads?status=matriculado')).json();
  assert.ok(list.items.some(i=>i.id===created.id));assert.ok(list.items.every(i=>i.status==='matriculado'));
  assert.ok(list.counts.matriculado>=1);
  for(const bad of [{lead_id:created.id},{lead_id:created.id,status:'novo'},{lead_id:created.id,note:'  '}]){
    assert.equal((await api(a,'admissions/lead-updates',bad)).status,400);
  }
});

test('visitas: horario com reserva pendente nao fecha; agenda lista reservas ativas da propria escola',async()=>{
  const slot=await add(a,'visit-slots',{date:future(6),time:'09:00',capacity:2});
  const l=await add(a,'leads',{...lead(),source:'presencial'});
  const booking=await add(a,'visit-bookings',{lead_id:l.id,slot_id:slot.id});
  assert.equal((await api(a,'admissions/visit-slot-closures',{slot_id:slot.id})).status,409);
  const agenda=await (await api(a,'admissions/visit-slots')).json();
  const row=agenda.items.find(i=>i.id===slot.id);
  assert.equal(row.bookings.length,1);assert.equal(row.bookings[0].protocol,l.protocol);assert.equal(row.closed,false);
  assert.ok(agenda.items.every(i=>i.school_id===a.school_id));
  await add(a,'visit-outcomes',{booking_id:booking.id,outcome:'cancelada'});
  await add(a,'visit-slot-closures',{slot_id:slot.id});
  assert.equal((await api(a,'admissions/visit-slot-closures',{slot_id:slot.id})).status,409);
  assert.equal((await (await api(a,'admissions/visit-slots')).json()).items.find(i=>i.id===slot.id).closed,true);
});

test('captacao: listagem isolada e IDOR recusado sem escrita',async()=>{
  const mine=await add(b,'leads',{...lead(),source:'indicacao'});
  const list=await (await api(a,'admissions/leads')).json();
  assert.ok(list.items.every(i=>i.school_id===a.school_id));assert.ok(!list.items.some(i=>i.id===mine.id));
  assert.equal((await api(a,`admissions/leads/${mine.id}`)).status,404);
  const before=await Promise.all(admissionTables.map(t=>count(t,b)));
  for(const [path,data] of [['lead-updates',{lead_id:mine.id,note:'x'}],['visit-bookings',{lead_id:mine.id,slot_id:a.slot.id}],
    ['visit-bookings',{lead_id:(await add(a,'leads',{...lead(),source:'outro'})).id,slot_id:b.slot.id}],
    ['visit-slot-closures',{slot_id:b.slot.id}],['visit-outcomes',{booking_id:randomUUID(),outcome:'compareceu'}]]){
    assert.equal((await api(a,`admissions/${path}`,data)).status,404,path);
  }
  assert.deepEqual(await Promise.all(admissionTables.map(t=>count(t,b))),before);
  assert.equal((await api(a,'admissions/leads',{...lead(),source:'outro',school_id:b.school_id})).status,400);
  assert.equal((await api(a,'admissions/leads?school_id=x')).status,400);
});

test('captacao: idempotencia da equipe, mesma chave em escolas diferentes e auditoria invalida revertida',async()=>{
  const key=randomUUID(),data={...lead({child_name:'Idempotente'}),source:'whatsapp'};
  const first=await api(a,'admissions/leads',data,key);assert.equal(first.status,201);
  const again=await api(a,'admissions/leads',data,key);assert.equal(again.status,200);
  assert.equal((await first.json()).item.id,(await again.json()).item.id);
  assert.equal((await api(a,'admissions/leads',{...data,child_name:'Outra'},key)).status,409);
  assert.equal((await api(b,'admissions/leads',data,key)).status,201);
  const rollbackKey=randomUUID(),before=await count('admission_leads');
  await assert.rejects(()=>withTenant(a,(c,u)=>create(c,{...u,id:b.sub},'leads',{...data,child_name:'Rollback'},rollbackKey)),e=>e.code==='23503');
  assert.equal(await count('admission_leads'),before);
  assert.equal((await admin.query('SELECT 1 FROM admission_events WHERE request_key=$1',[rollbackKey])).rowCount,0);
});

test('captacao: sem token, perfis nao administrativos e escola suspensa negados; site suspenso some',async()=>{
  assert.equal((await fetch(`${base}/api/admissions/leads`)).status,401);
  for(const role of ['teacher','guardian']){
    await admin.query('UPDATE users SET role=$1 WHERE id=$2',[role,a.sub]);
    try{
      assert.equal((await api(a,'admissions/leads')).status,403);
      assert.equal((await api(a,'admissions/site')).status,403);
      assert.equal((await api(a,'admissions/leads',{...lead(),source:'outro'})).status,403);
    }finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
  }
  await admin.query("UPDATE schools SET status='suspended' WHERE id=$1",[a.school_id]);
  try{
    assert.equal((await api(a,'admissions/leads')).status,401);
    assert.equal((await publicSite(a.slug)).status,404);
    assert.equal((await submit(a.slug,lead())).status,404);
  }finally{await admin.query("UPDATE schools SET status='active' WHERE id=$1",[a.school_id]);}
  assert.equal((await publicSite(a.slug)).status,200);
});

test('captacao: RLS sem contexto, alfa_auth sem leitura e runtime sem UPDATE/DELETE',async()=>{
  for(const table of admissionTables){
    assert.equal((await pool.query(`SELECT * FROM public.${table}`)).rowCount,0,table);
    await assert.rejects(()=>authPool.query(`SELECT * FROM public.${table}`),e=>e.code==='42501');
    for(const f of fixtures)await withTenant(f,async c=>{
      const {rows}=await c.query(`SELECT school_id FROM public.${table}`);assert.ok(rows.every(r=>r.school_id===f.school_id));
    });
    await assert.rejects(()=>withTenant(a,c=>c.query(`DELETE FROM public.${table}`)),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`UPDATE public.${table} SET school_id=school_id`)),e=>e.code==='42501');
  }
  await assert.rejects(()=>withTenant(a,c=>c.query(`INSERT INTO public.admission_leads(school_id,protocol,source,interest,guardian_name,
    guardian_phone,child_name,consent_at) VALUES($1,'PM-AAAAAA','outro','visita','x','11999999999','y',now())`,[b.school_id])),e=>e.code==='42501');
});

test('fronteira publica: somente alfa_app executa; owner NOLOGIN; startup recusa funcao ou RLS alterados',async()=>{
  await assert.rejects(()=>authPool.query("SELECT site_public.site('x')"),e=>e.code==='42501');
  await assert.rejects(()=>pool.query('SET ROLE alfa_site_owner'),e=>e.code==='42501');
  for(const sql of ['ALTER FUNCTION site_public.site(text) SECURITY INVOKER','DROP FUNCTION site_public.site(text)',
    'CREATE FUNCTION site_public.probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$']){
    await assert.rejects(()=>pool.query(sql),e=>e.code==='42501');
  }
  const {rows:[owner]}=await admin.query(`SELECT rolcanlogin,rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname='alfa_site_owner'`);
  assert.ok(Object.values(owner).every(v=>v===false));
  await testDatabaseConnection();
  for(const [change,restore] of [
    ['ALTER FUNCTION site_public.site(text) SECURITY INVOKER','ALTER FUNCTION site_public.site(text) SECURITY DEFINER'],
    ['GRANT EXECUTE ON FUNCTION site_public.image(text,uuid) TO PUBLIC','REVOKE EXECUTE ON FUNCTION site_public.image(text,uuid) FROM PUBLIC'],
    ['ALTER FUNCTION site_public.submit_lead(text,uuid,text,jsonb,uuid) RESET search_path',
      'ALTER FUNCTION site_public.submit_lead(text,uuid,text,jsonb,uuid) SET search_path = pg_catalog, pg_temp'],
    ['ALTER TABLE public.admission_leads NO FORCE ROW LEVEL SECURITY','ALTER TABLE public.admission_leads FORCE ROW LEVEL SECURITY']]){
    await admin.query(change);
    try{await assert.rejects(()=>testDatabaseConnection(),/RLS obrigatorio|Fronteira publica/);}
    finally{await admin.query(restore);}
  }
  await testDatabaseConnection();
});

test('captacao: paginacao estavel sem repeticao nem mistura de escolas',async()=>{
  await admin.query(`INSERT INTO admission_leads(school_id,protocol,source,interest,guardian_name,guardian_phone,child_name,consent_at)
    SELECT $1,'PM-'||translate(lpad(n::text,6,'0'),'0123456789','ABCDEFGHJK'),'outro','informacoes','Pagina','11999999999','Criança '||n,now()
    FROM generate_series(1,120) n`,[b.school_id]);
  const seen=new Set();let page=1,more=true;
  while(more){
    const data=await (await api(b,`admissions/leads?page=${page++}`)).json();
    for(const item of data.items){assert.ok(!seen.has(item.id));seen.add(item.id);assert.equal(item.school_id,b.school_id);}
    more=data.has_more;
  }
  assert.equal(seen.size,await count('admission_leads',b));
  assert.equal((await api(b,'admissions/leads?page=0')).status,400);
});

test('limite de envios publicos por origem, com janela deslizante e cabecalho de proxy so quando confiavel',()=>{
  let clock=0;const run=(limiter,req)=>{let result;limiter(req,null,e=>{result=e?.statusCode??200;});return result;};
  const req=(ip,real)=>({socket:{remoteAddress:ip},headers:real?{'x-real-ip':real}:{}});
  const limiter=submissionLimiter({max:2,windowMs:1000,now:()=>clock});
  assert.deepEqual([1,2,3].map(()=>run(limiter,req('10.0.0.1'))),[200,200,429]);
  assert.equal(run(limiter,req('10.0.0.2')),200);
  assert.equal(run(limiter,req('10.0.0.1','1.2.3.4')),429);
  clock=1001;assert.equal(run(limiter,req('10.0.0.1')),200);
  const proxied=submissionLimiter({max:1,windowMs:1000,trustProxy:true,now:()=>clock});
  assert.equal(run(proxied,req('172.18.0.5','1.2.3.4')),200);
  assert.equal(run(proxied,req('172.18.0.5','5.6.7.8')),200);
  assert.equal(run(proxied,req('172.18.0.5','1.2.3.4')),429);
});
