import { test, expect } from '@playwright/test';
test('administrador cadastra aluno, responsavel e vinculo; persiste apos reload e nova sessao',async({page})=>{
  if(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD)throw Error('Ambiente E2E isolado obrigatorio');
  const tag=Date.now().toString();
  const student=`Aluno Fictício ${tag}`,guardian=`Responsável Fictício ${tag}`;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function login(){
    await page.goto('/');await page.getByLabel(/e-mail/i).fill(process.env.E2E_EMAIL);
    await page.getByLabel(/senha/i).fill(process.env.E2E_PASSWORD);
    await page.getByRole('button',{name:/entrar/i}).click();
    await expect(page.getByRole('heading',{name:'Estrutura escolar',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'Alunos e responsáveis',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Alunos e responsáveis',exact:true})).toBeVisible();
  }
  async function save(){await page.getByRole('button',{name:'Salvar cadastro',exact:true}).click();await expect(page.getByText('Cadastro salvo na sua escola.',{exact:true})).toBeVisible();}
  await login();
  await page.getByLabel('Nome completo',{exact:true}).fill(student);
  await page.getByLabel('Data de nascimento',{exact:true}).fill('2020-02-29');await save();
  await expect(page.getByRole('row').filter({hasText:student})).toHaveCount(1);
  await page.getByRole('button',{name:'Responsáveis',exact:true}).click();
  await page.getByLabel('Nome completo',{exact:true}).fill(guardian);await save();
  await expect(page.getByRole('row').filter({hasText:guardian})).toContainText('Sem contato');
  await page.getByRole('button',{name:'Vínculos',exact:true}).click();
  const studentOption=page.getByLabel('Aluno',{exact:true}).locator('option').filter({hasText:student});
  const guardianOption=page.getByLabel('Responsável',{exact:true}).locator('option').filter({hasText:guardian});
  await expect(studentOption).toHaveCount(1);await expect(guardianOption).toHaveCount(1);
  const studentId=await studentOption.getAttribute('value'),guardianId=await guardianOption.getAttribute('value');
  async function fillLink(){
    await page.getByLabel('Aluno',{exact:true}).selectOption(studentId);
    await page.getByLabel('Responsável',{exact:true}).selectOption(guardianId);
    await page.getByLabel('Parentesco ou relação',{exact:true}).fill('Mãe');
    await page.getByLabel('Responsável legal',{exact:true}).check();
  }
  await fillLink();await save();
  let row=page.getByRole('row').filter({hasText:student});
  await expect(row).toHaveCount(1);await expect(row).toContainText(guardian);await expect(row).toContainText('Sim');
  await fillLink();await page.getByRole('button',{name:'Salvar cadastro',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Esse vínculo já existe');
  await expect(row).toHaveCount(1);
  await page.reload();await page.getByRole('button',{name:'Vínculos',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:student})).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Sair',exact:true}).click();
  await page.goto('/secretaria/pessoas');await expect(page.getByRole('button',{name:/entrar/i})).toBeVisible();
  await login();await page.getByRole('button',{name:'Vínculos',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:student})).toHaveCount(1);
  expect(errors).toEqual([]);
});
