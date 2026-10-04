import { test, expect } from '@playwright/test';
test('escola publica o site, abre horario; familia faz pre-matricula pelo celular; secretaria registra a visita; persiste apos reload',async({page,browser})=>{
  if(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD)throw Error('Ambiente E2E isolado obrigatorio');
  const tag=Date.now().toString();
  const title=`Escola Fictícia E2E ${tag}`,piece=`Camiseta ${tag}`,child=`Criança Fictícia ${tag}`;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByLabel(/e-mail/i).fill(process.env.E2E_EMAIL);
  await page.getByLabel(/senha/i).fill(process.env.E2E_PASSWORD);
  await page.getByRole('button',{name:/entrar/i}).click();
  await expect(page.getByRole('heading',{name:'Estrutura escolar',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Captação',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Captação',exact:true})).toBeVisible();

  // Site: o endereço é definido uma vez por escola; reaproveita o existente em execuções seguintes.
  await page.getByRole('button',{name:'Site da escola',exact:true}).click();
  const address=page.getByRole('heading',{name:'Endereço do site',exact:true});
  await expect(address.or(page.getByRole('heading',{name:'Site da escola',exact:true}))).toBeVisible();
  if(await address.isVisible()){
    await page.getByLabel(/^Endereço/).fill(`escola-e2e-${tag}`);
    await page.getByRole('button',{name:'Definir endereço',exact:true}).click();
    await expect(page.getByText('Endereço definido.',{exact:true})).toBeVisible();
  }
  const link=page.locator('a[href*="/escola/"]').first();
  const siteUrl=await link.getAttribute('href');
  await page.getByLabel('Título',{exact:true}).first().fill(title);
  await page.getByRole('button',{name:'Adicionar peça',exact:true}).click();
  await page.getByLabel('Peça',{exact:true}).last().fill(piece);
  await page.getByLabel('Preço',{exact:true}).last().fill('R$ 45,00');
  await page.getByRole('button',{name:'Adicionar turma',exact:true}).click();
  await page.getByLabel('Nome',{exact:true}).last().fill(`Infantil ${tag}`);
  await page.getByRole('button',{name:'Salvar e publicar',exact:true}).click();
  await expect(page.getByText('Site salvo e publicado.',{exact:true})).toBeVisible();

  // Um único horário: só segunda-feira, uma semana, 9h, uma família.
  await page.getByRole('button',{name:'Visitas',exact:true}).click();
  for(const day of ['Ter','Qua','Qui','Sex'])await page.getByRole('button',{name:day,exact:true}).click();
  await page.getByLabel('Horários',{exact:true}).fill('09:00');
  await page.getByLabel('Próximas semanas',{exact:true}).fill('1');
  await page.getByLabel('Famílias por horário',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Abrir horários',exact:true}).click();
  await expect(page.getByRole('status')).toContainText(/horário\(s\) aberto\(s\)/);

  // Família no celular, sem login.
  const phone=await browser.newContext({viewport:{width:390,height:844}});
  const family=await phone.newPage();family.on('pageerror',e=>errors.push(e.message));
  await family.goto(siteUrl);
  await expect(family.getByRole('heading',{name:title})).toBeVisible();
  await expect(family.getByRole('heading',{name:piece})).toBeVisible();
  await family.getByLabel('Nome da criança',{exact:true}).fill(child);
  await family.getByLabel('Turma de interesse',{exact:true}).selectOption(`Infantil ${tag}`);
  await family.getByLabel('Seu nome',{exact:true}).fill('Responsável Fictícia E2E');
  await family.getByLabel('WhatsApp com DDD',{exact:true}).fill('(11) 98765-4321');
  await family.locator('.slot-times .choice').last().click();
  await family.getByRole('checkbox').check();
  await family.getByRole('button',{name:'Enviar e agendar visita',exact:true}).click();
  await expect(family.getByRole('heading',{name:'Recebemos sua pré-matrícula!'})).toBeVisible();
  const protocol=(await family.locator('.protocol').textContent()).trim();
  expect(protocol).toMatch(/^PM-[A-HJ-NP-Z2-9]{6}$/);
  await expect(family.getByText(/Visita agendada:/)).toBeVisible();
  if(process.env.E2E_SCREENSHOT)await family.screenshot({path:process.env.E2E_SCREENSHOT.replace(/\.png$/,'-site.png'),fullPage:true});
  await phone.close();

  // Secretaria encontra a pré-matrícula e registra o comparecimento.
  await page.getByRole('button',{name:'Interessados',exact:true}).click();
  const row=page.getByRole('row').filter({hasText:protocol});
  await expect(row).toHaveCount(1);await expect(row).toContainText(child);await expect(row).toContainText('Visita agendada');
  await row.getByRole('button',{name:`Abrir ${protocol}`}).click();
  await expect(page.getByRole('heading',{name:`${child} · ${protocol}`})).toBeVisible();
  await page.getByRole('button',{name:'Compareceu',exact:true}).click();
  await expect(page.getByText('Comparecimento registrado.',{exact:true})).toBeVisible();
  await expect(row).toContainText('Visitou');
  await page.reload();
  await page.getByRole('button',{name:'Interessados',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:protocol})).toContainText('Visitou');
  expect(errors).toEqual([]);
});
