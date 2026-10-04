import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('escola define regras e convida; familia completa a ficha no celular; secretaria aprova e a matricula aparece',async({page,browser,request})=>{
  if(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD)throw Error('Ambiente E2E isolado obrigatorio');
  const tag=Date.now().toString();
  const child=`Criança Online ${tag}`,group=`TO${tag}`,level=`GO${tag}`;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Estrutura criada pela API com a mesma conta; usa etapa própria para não interferir em structure.spec.js.
  const session=await request.post('/api/auth/login',{data:{email:process.env.E2E_EMAIL,password:process.env.E2E_PASSWORD}});
  expect(session.status()).toBe(200);const {token}=await session.json();
  async function add(path,data,accepted=[201]){
    const res=await request.post(`/api/${path}`,{data,headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':randomUUID()}});
    expect(accepted).toContain(res.status());return (await res.json()).item;
  }
  await add('structure/stages',{code:'fundamental_final'},[201,409]);
  const y=await add('structure/academic-years',{code:`O${tag}`,starts_on:'2027-02-01',ends_on:'2027-12-20'});
  const s=await add('structure/shifts',{code:`MO${tag}`,name:'Manhã online'});
  const l=await add('structure/levels',{code:level,name:`6º ano ${tag}`,stage_code:'fundamental_final'});
  await add('structure/class-groups',{code:group,stage_code:'fundamental_final',academic_year_id:y.id,shift_id:s.id,level_ids:[l.id]});

  await page.goto('/');await page.getByLabel(/e-mail/i).fill(process.env.E2E_EMAIL);
  await page.getByLabel(/senha/i).fill(process.env.E2E_PASSWORD);
  await page.getByRole('button',{name:/entrar/i}).click();
  await expect(page.getByRole('heading',{name:'Estrutura escolar',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Captação',exact:true}).click();
  await page.getByRole('button',{name:'Matrícula online',exact:true}).click();

  // Regras desta escola: CPF dos responsáveis e regulamento.
  await page.getByRole('button',{name:'Regras da escola',exact:true}).click();
  await page.getByLabel('CPF dos responsáveis',{exact:true}).check();
  await page.getByLabel(/Regulamento/).fill('Regulamento fictício: horários, uniforme e comunicação.');
  await page.getByRole('button',{name:'Salvar regras',exact:true}).click();
  await expect(page.getByText(/Regras salvas/)).toBeVisible();
  await page.getByRole('button',{name:'Fechar regras',exact:true}).click();

  await page.getByRole('button',{name:'Nova ficha',exact:true}).click();
  await page.getByLabel('Nome da criança',{exact:true}).fill(child);
  // A escola digita o nascimento errado; a família não entra até a secretaria corrigir.
  await page.getByLabel('Nascimento',{exact:true}).fill('2015-03-01');
  await page.getByLabel('Responsável',{exact:true}).fill('Responsável Online Fictícia');
  await page.getByLabel('WhatsApp com DDD',{exact:true}).fill('(11) 98765-4321');
  await page.getByRole('button',{name:'Criar ficha',exact:true}).click();
  await expect(page.getByRole('heading',{name:child,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Gerar link para a família',exact:true}).click();
  const message=await page.locator('.message-preview').textContent();
  const url=message.match(/https?:\/\/\S+\/matricula\/[A-Za-z0-9_-]+/)[0];

  // Família no celular: confirma a data, completa e envia.
  const phone=await browser.newContext({viewport:{width:390,height:844}});
  const familyPage=await phone.newPage();familyPage.on('pageerror',e=>errors.push(e.message));
  await familyPage.goto(url);
  await familyPage.getByLabel('Data de nascimento da criança').fill('2015-03-10');
  await familyPage.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(familyPage.getByRole('alert')).toContainText('Não conseguimos confirmar');
  await page.getByText('Corrigir data de nascimento',{exact:true}).click();
  await page.getByLabel('Data correta',{exact:true}).fill('2015-03-10');
  await page.getByRole('button',{name:'Salvar data correta',exact:true}).click();
  await expect(page.getByText(/Data de nascimento corrigida/)).toBeVisible();
  await expect(page.getByText(/Nascimento 10\/03\/2015 \(corrigido em/)).toBeVisible();
  await familyPage.getByLabel('Data de nascimento da criança').fill('2015-03-10');
  await familyPage.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(familyPage.getByRole('heading',{name:'Ficha de matrícula'})).toBeVisible();
  await expect(familyPage.getByLabel('Nome completo').first()).toHaveValue(child);
  await familyPage.getByLabel('Parentesco').fill('Mãe');
  await familyPage.getByLabel('CPF',{exact:true}).fill('529.982.247-25');
  await familyPage.getByLabel(/Saúde/).fill('Nenhuma');
  await expect(familyPage.getByRole('region',{name:'Regulamento da escola'})).toContainText('Regulamento fictício');
  await familyPage.getByRole('checkbox',{name:/Declaro que as informações são verdadeiras/}).check();
  await familyPage.getByRole('button',{name:'Enviar para a escola',exact:true}).click();
  await expect(familyPage.getByRole('heading',{name:'Recebemos a ficha!'})).toBeVisible();

  // Secretaria analisa e aprova na turma.
  await page.getByRole('button',{name:'Fechar',exact:true}).last().click();
  await page.getByRole('button',{name:'Para analisar',exact:true}).click();
  await page.getByRole('button',{name:`Abrir ficha de ${child}`}).click();
  await expect(page.getByText('529.982.247-25').or(page.getByText('52998224725'))).toBeVisible();
  await page.getByLabel('Turma',{exact:true}).selectOption({label:`${group} · O${tag}`});
  await page.getByLabel('Série ou grupo',{exact:true}).selectOption({label:`${level} · 6º ano ${tag}`});
  await page.getByRole('button',{name:'Aprovar e matricular',exact:true}).click();
  await expect(page.getByText('Matrícula aprovada: aluno, responsáveis e matrícula criados.')).toBeVisible();

  await page.getByRole('link',{name:'Matrículas',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:child})).toContainText(group);

  await familyPage.reload();
  await familyPage.getByLabel('Data de nascimento da criança').fill('2015-03-10');
  await familyPage.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(familyPage.getByRole('heading',{name:'Matrícula confirmada'})).toBeVisible();
  await phone.close();
  expect(errors).toEqual([]);
});
