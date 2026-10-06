import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('secretaria cria avaliacoes, lanca notas, corrige com motivo e ve a media ponderada; persiste apos reload',async({page,request})=>{
  if(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD)throw Error('Ambiente E2E isolado obrigatorio');
  const tag=Date.now().toString();
  const year=`N${tag}`,group=`TN${tag}`,ana=`Ana Notas ${tag}`,bruno=`Bruno Notas ${tag}`,typeName=`Prova ${tag}`;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Turma e alunos matriculados entram pela API com a mesma conta; tipo, avaliações e notas são feitos pela tela.
  // Usa etapa própria: structure.spec.js espera cadastrar 'infantil' numa escola sem essa etapa.
  const session=await request.post('/api/auth/login',{data:{email:process.env.E2E_EMAIL,password:process.env.E2E_PASSWORD}});
  expect(session.status()).toBe(200);const {token}=await session.json();
  async function add(path,data,accepted=[201]){
    const res=await request.post(`/api/${path}`,{data,headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':randomUUID()}});
    expect(accepted).toContain(res.status());return (await res.json()).item;
  }
  await add('structure/stages',{code:'fundamental_initial'},[201,409]);
  const y=await add('structure/academic-years',{code:year,starts_on:'2027-02-01',ends_on:'2027-12-20'});
  const s=await add('structure/shifts',{code:`MN${tag}`,name:'Manhã notas'});
  const l=await add('structure/levels',{code:`GN${tag}`,name:`Série notas ${tag}`,stage_code:'fundamental_initial'});
  const g=await add('structure/class-groups',{code:group,stage_code:'fundamental_initial',academic_year_id:y.id,shift_id:s.id,level_ids:[l.id]});
  for(const full_name of [ana,bruno]){
    const student=await add('people/students',{full_name,birth_date:'2016-04-02'});
    await add('enrollments',{student_id:student.id,class_group_id:g.id,level_id:l.id});
  }
  async function open(){
    await page.goto('/');await page.getByLabel(/e-mail/i).fill(process.env.E2E_EMAIL);
    await page.getByLabel(/senha/i).fill(process.env.E2E_PASSWORD);
    await page.getByRole('button',{name:/entrar/i}).click();
    await expect(page.getByRole('heading',{name:'Estrutura escolar',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Notas',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Notas e avaliações',exact:true})).toBeVisible();
    await page.getByLabel('Turma',{exact:true}).selectOption({label:`${group} · ${year}`});
    await expect(page.getByRole('heading',{name:'Nova avaliação',exact:true})).toBeVisible();
  }
  const status=text=>expect(page.getByRole('status')).toHaveText(text);
  const classHistory=page.locator('section').filter({has:page.getByRole('heading',{name:'Histórico da turma',exact:true})});
  const studentRow=name=>classHistory.getByRole('row').filter({hasText:name});
  async function assessment(title,date,weight){
    await page.getByLabel('Tipo de avaliação',{exact:true}).selectOption({label:`${typeName} · peso 2`});
    await page.getByLabel('Título',{exact:true}).fill(title);
    await page.getByLabel('Data',{exact:true}).fill(date);
    await page.getByLabel('Peso (opcional)',{exact:true}).fill(weight);
    await page.getByRole('button',{name:'Criar avaliação',exact:true}).click();
    await status('Avaliação criada. Escolha-a abaixo para lançar as notas.');
  }
  async function scores(values){
    for(const [name,value] of values)await page.getByLabel(`Nota de ${name}`,{exact:true}).fill(value);
    await page.getByRole('button',{name:'Salvar notas',exact:true}).click();
  }
  await open();
  await page.getByLabel('Código',{exact:true}).fill(`P${tag}`);
  await page.getByLabel('Nome do tipo',{exact:true}).fill(typeName);
  await page.getByLabel('Peso padrão',{exact:true}).fill('2');
  await page.getByRole('button',{name:'Salvar tipo',exact:true}).click();
  await status('Tipo de avaliação salvo.');
  await assessment('Prova 1','2027-04-10','');
  await scores([[ana,'8'],[bruno,'5,5']]);
  await status('Notas salvas: 2 lançada(s) e 0 corrigida(s).');
  await assessment('Trabalho','2027-03-20','1');
  await scores([[ana,'5'],[bruno,'7']]);
  await status('Notas salvas: 2 lançada(s) e 0 corrigida(s).');
  await expect(studentRow(ana)).toContainText('7,0');
  await expect(studentRow(bruno)).toContainText('6,0');
  // Nota fora da escala não sai do navegador.
  await scores([[ana,'11']]);
  await expect(page.getByRole('alert')).toContainText(`${ana}: a nota deve ser um número de 0 a 10`);
  await page.getByLabel(`Nota de ${ana}`,{exact:true}).fill('5');
  // Correção: a nota da Prova 1 do Bruno muda com motivo; a anterior fica no histórico.
  await page.getByLabel('Avaliação',{exact:true}).selectOption({label:'Prova 1 · 10/04/2027 · peso 2'});
  await expect(page.getByLabel(`Nota de ${bruno}`,{exact:true})).toHaveValue('5,5');
  await page.getByLabel(`Nota de ${bruno}`,{exact:true}).fill('6,5');
  await page.getByRole('button',{name:'Salvar notas',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Informe o motivo da correção das notas alteradas.');
  await page.getByLabel('Motivo da correção',{exact:true}).fill('Questão 3 recontada');
  await page.getByRole('button',{name:'Salvar notas',exact:true}).click();
  await status('Notas salvas: 0 lançada(s) e 1 corrigida(s).');
  await expect(studentRow(bruno)).toContainText('6,5*');
  await expect(studentRow(bruno)).toContainText('6,67');
  const launches=page.locator('section').filter({has:page.getByRole('heading',{name:'Histórico de lançamentos — Prova 1',exact:true})});
  await expect(launches.getByRole('row').filter({hasText:'Substituída'})).toContainText('5,5');
  await expect(launches.getByRole('row').filter({hasText:'Questão 3 recontada'})).toContainText('Vigente');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Notas e avaliações',exact:true})).toBeVisible();
  await page.getByLabel('Turma',{exact:true}).selectOption({label:`${group} · ${year}`});
  await expect(studentRow(ana)).toContainText('7,0');
  await expect(studentRow(bruno)).toContainText('6,67');
  expect(errors).toEqual([]);
});
