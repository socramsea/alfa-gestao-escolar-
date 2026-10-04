import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('administrador cadastra profissional, atribui a turma, encerra a atribuicao; persiste apos reload e nova sessao',async({page,request})=>{
  if(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD)throw Error('Ambiente E2E isolado obrigatorio');
  const tag=Date.now().toString();
  const member=`Profissional Fictício ${tag}`,year=`P${tag}`,group=`TP${tag}`;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Pré-requisitos de estrutura criados pela API pública com a mesma conta; profissional e atribuição são feitos pela tela.
  // Usa etapa própria: structure.spec.js roda depois e espera cadastrar 'infantil' em escola sem essa etapa.
  const session=await request.post('/api/auth/login',{data:{email:process.env.E2E_EMAIL,password:process.env.E2E_PASSWORD}});
  expect(session.status()).toBe(200);const {token}=await session.json();
  async function add(path,data,accepted=[201]){
    const res=await request.post(`/api/${path}`,{data,headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':randomUUID()}});
    expect(accepted).toContain(res.status());return (await res.json()).item;
  }
  await add('structure/stages',{code:'fundamental_initial'},[201,409]);
  const y=await add('structure/academic-years',{code:year,starts_on:'2027-02-01',ends_on:'2027-12-20'});
  const s=await add('structure/shifts',{code:`MP${tag}`,name:'Manhã profissionais'});
  const l=await add('structure/levels',{code:`GP${tag}`,name:`Série profissionais ${tag}`,stage_code:'fundamental_initial'});
  await add('structure/class-groups',{code:group,stage_code:'fundamental_initial',academic_year_id:y.id,shift_id:s.id,level_ids:[l.id]});
  async function login(){
    await page.goto('/');await page.getByLabel(/e-mail/i).fill(process.env.E2E_EMAIL);
    await page.getByLabel(/senha/i).fill(process.env.E2E_PASSWORD);
    await page.getByRole('button',{name:/entrar/i}).click();
    await expect(page.getByRole('heading',{name:'Estrutura escolar',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Profissionais',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Profissionais',exact:true})).toBeVisible();
  }
  const save=()=>page.getByRole('button',{name:'Salvar cadastro',exact:true}).click();
  const row=page.getByRole('row').filter({hasText:member});
  await login();
  await page.getByLabel('Nome completo',{exact:true}).fill(member);await save();
  await expect(page.getByText('Cadastro salvo na sua escola.',{exact:true})).toBeVisible();
  await expect(row).toHaveCount(1);await expect(row).toContainText('Sem contato');
  await page.getByRole('button',{name:'Atribuições',exact:true}).click();
  async function fill(){
    const option=page.getByLabel('Profissional',{exact:true}).locator('option').filter({hasText:member});
    await expect(option).toHaveCount(1);
    await page.getByLabel('Profissional',{exact:true}).selectOption(await option.getAttribute('value'));
    await page.getByLabel('Turma',{exact:true}).selectOption({label:`${group} · ${year}`});
    await page.getByLabel('Papel na turma',{exact:true}).selectOption('regente');
    await page.getByLabel('Início',{exact:true}).fill('2027-02-01');
  }
  await fill();await save();
  await expect(page.getByText('Cadastro salvo na sua escola.',{exact:true})).toBeVisible();
  await expect(row).toHaveCount(1);await expect(row).toContainText(group);await expect(row).toContainText('Regente');
  await expect(row).toContainText('20/12/2027');await expect(row).toContainText('Em aberto');
  await fill();await save();
  await expect(page.getByRole('alert')).toContainText('já tem atribuição nesta turma');
  await expect(row).toHaveCount(1);
  const open=page.getByLabel('Atribuição em aberto',{exact:true}).locator('option').filter({hasText:member});
  await expect(open).toHaveCount(1);
  await page.getByLabel('Atribuição em aberto',{exact:true}).selectOption(await open.getAttribute('value'));
  await page.getByLabel('Último dia na turma',{exact:true}).fill('2027-06-30');
  await page.getByRole('button',{name:'Encerrar atribuição',exact:true}).click();
  await expect(page.getByText('Atribuição encerrada na data informada.',{exact:true})).toBeVisible();
  await expect(row).toContainText('30/06/2027');await expect(row).toContainText('Encerrada');
  await expect(page.getByLabel('Atribuição em aberto',{exact:true}).locator('option').filter({hasText:member})).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'Atribuições',exact:true}).click();
  await expect(row).toHaveCount(1);await expect(row).toContainText('Encerrada');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Sair',exact:true}).click();
  await page.goto('/secretaria/profissionais');await expect(page.getByRole('button',{name:/entrar/i})).toBeVisible();
  await login();await expect(row).toHaveCount(1);
  expect(errors).toEqual([]);
});
