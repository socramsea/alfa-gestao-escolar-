import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('administrador matricula aluno em turma; duplicidade recusada; persiste apos reload e nova sessao',async({page,request})=>{
  if(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD)throw Error('Ambiente E2E isolado obrigatorio');
  const tag=Date.now().toString();
  const student=`Aluno Matrícula ${tag}`,year=`E${tag}`,group=`TE${tag}`,level=`Grupo matrícula ${tag}`;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Pré-requisitos criados pela API pública com a mesma conta; a matrícula em si é feita pela tela.
  // Usa etapa própria: structure.spec.js roda depois e espera cadastrar 'infantil' em escola sem essa etapa.
  const session=await request.post('/api/auth/login',{data:{email:process.env.E2E_EMAIL,password:process.env.E2E_PASSWORD}});
  expect(session.status()).toBe(200);const {token}=await session.json();
  async function add(path,data,accepted=[201]){
    const res=await request.post(`/api/${path}`,{data,headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':randomUUID()}});
    expect(accepted).toContain(res.status());return (await res.json()).item;
  }
  await add('structure/stages',{code:'fundamental_initial'},[201,409]);
  const y=await add('structure/academic-years',{code:year,starts_on:'2027-02-01',ends_on:'2027-12-20'});
  const s=await add('structure/shifts',{code:`ME${tag}`,name:'Manhã matrícula'});
  const l=await add('structure/levels',{code:`GE${tag}`,name:level,stage_code:'fundamental_initial'});
  await add('structure/class-groups',{code:group,stage_code:'fundamental_initial',academic_year_id:y.id,shift_id:s.id,level_ids:[l.id]});
  await add('people/students',{full_name:student,birth_date:'2020-02-29'});
  async function login(){
    await page.goto('/');await page.getByLabel(/e-mail/i).fill(process.env.E2E_EMAIL);
    await page.getByLabel(/senha/i).fill(process.env.E2E_PASSWORD);
    await page.getByRole('button',{name:/entrar/i}).click();
    await expect(page.getByRole('heading',{name:'Estrutura escolar',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Matrículas',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Matrículas',exact:true})).toBeVisible();
  }
  const groupField=page.getByLabel('Turma (obrigatória)',{exact:true}),levelField=page.getByLabel('Grupo/série',{exact:true});
  async function fill(){
    const option=page.getByLabel('Aluno',{exact:true}).locator('option').filter({hasText:student});
    await expect(option).toHaveCount(1);
    await page.getByLabel('Aluno',{exact:true}).selectOption(await option.getAttribute('value'));
    await page.getByLabel('Período letivo',{exact:true}).selectOption(y.id);
    await groupField.selectOption({label:`${group} · fundamental_initial`});
    await levelField.selectOption({label:level});
  }
  const row=page.getByRole('row').filter({hasText:student});
  await login();
  await expect(groupField).toBeDisabled();await expect(levelField).toBeDisabled();
  await fill();await page.getByRole('button',{name:'Confirmar matrícula',exact:true}).click();
  await expect(page.getByText('Matrícula confirmada na turma selecionada.',{exact:true})).toBeVisible();
  await expect(row).toHaveCount(1);await expect(row).toContainText(year);await expect(row).toContainText(group);await expect(row).toContainText(level);
  await fill();await page.getByRole('button',{name:'Confirmar matrícula',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('já possui matrícula neste período');
  await page.reload();await expect(row).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Sair',exact:true}).click();
  await page.goto('/secretaria/matriculas');await expect(page.getByRole('button',{name:/entrar/i})).toBeVisible();
  await login();await expect(row).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('lista de matriculas navega entre paginas do servidor',async({page})=>{
  if(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD)throw Error('Ambiente E2E isolado obrigatorio');
  // Somente a listagem é simulada; criar mais de 100 matrículas reais alteraria as contagens conferidas pelo smoke.
  const requested=[];
  await page.route(/\/api\/enrollments\/\?page=\d+$/,route=>{
    const number=Number(new URL(route.request().url()).searchParams.get('page'));requested.push(number);
    return route.fulfill({json:{page:number,has_more:number===1,items:[{id:`fixture-${number}`,student_id:`aluno-${number}`,
      student_name:`Aluno da página ${number}`,academic_year_code:'2027',class_group_id:'turma',level_id:'serie',created_at:'2027-02-01T12:00:00Z'}]}});
  });
  await page.goto('/');await page.getByLabel(/e-mail/i).fill(process.env.E2E_EMAIL);
  await page.getByLabel(/senha/i).fill(process.env.E2E_PASSWORD);
  await page.getByRole('button',{name:/entrar/i}).click();
  await expect(page.getByRole('heading',{name:'Estrutura escolar',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Matrículas',exact:true}).click();
  const previous=page.getByRole('button',{name:'Anterior',exact:true}),next=page.getByRole('button',{name:'Próxima',exact:true});
  await expect(page.getByRole('row').filter({hasText:'Aluno da página 1'})).toHaveCount(1);
  await expect(page.getByText('Página 1',{exact:true})).toBeVisible();await expect(previous).toBeDisabled();
  await next.click();
  await expect(page.getByRole('row').filter({hasText:'Aluno da página 2'})).toHaveCount(1);
  await expect(page.getByRole('row').filter({hasText:'Aluno da página 1'})).toHaveCount(0);
  await expect(page.getByText('Página 2',{exact:true})).toBeVisible();await expect(next).toBeDisabled();
  await previous.click();
  await expect(page.getByRole('row').filter({hasText:'Aluno da página 1'})).toHaveCount(1);
  expect(requested).toEqual([1,2,1]);
});
