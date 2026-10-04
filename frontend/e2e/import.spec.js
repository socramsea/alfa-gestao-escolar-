import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const sample=fileURLToPath(new URL('../../docs/exemplos/planilha-alunos-ficticia.xlsx',import.meta.url));
test('secretaria arrasta a planilha, confere a previa e importa; alunos, responsavel e matriculas aparecem',async({page,request})=>{
  if(!process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD)throw Error('Ambiente E2E isolado obrigatorio');
  const tag=Date.now().toString();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Período próprio, com as turmas T1 e T2 da planilha de exemplo, para não interferir nos outros specs.
  // A etapa infantil fica para structure.spec.js, que a cadastra pela tela e espera sucesso.
  const session=await request.post('/api/auth/login',{data:{email:process.env.E2E_EMAIL,password:process.env.E2E_PASSWORD}});
  expect(session.status()).toBe(200);const {token}=await session.json();
  async function add(path,data,accepted=[201]){
    const res=await request.post(`/api/${path}`,{data,headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':randomUUID()}});
    expect(accepted).toContain(res.status());return (await res.json()).item;
  }
  await add('structure/stages',{code:'fundamental_initial'},[201,409]);
  const year=await add('structure/academic-years',{code:`IMP${tag}`,starts_on:'2027-02-01',ends_on:'2027-12-20'});
  const shift=await add('structure/shifts',{code:`MI${tag}`,name:'Manhã importação'});
  const g4=await add('structure/levels',{code:`I1${tag}`,name:`1º ano ${tag}`,stage_code:'fundamental_initial'});
  const g5=await add('structure/levels',{code:`I2${tag}`,name:`2º ano ${tag}`,stage_code:'fundamental_initial'});
  await add('structure/class-groups',{code:'T1',stage_code:'fundamental_initial',academic_year_id:year.id,shift_id:shift.id,level_ids:[g4.id]});
  await add('structure/class-groups',{code:'T2',stage_code:'fundamental_initial',academic_year_id:year.id,shift_id:shift.id,level_ids:[g5.id]});

  await page.goto('/');await page.getByLabel(/e-mail/i).fill(process.env.E2E_EMAIL);
  await page.getByLabel(/senha/i).fill(process.env.E2E_PASSWORD);
  await page.getByRole('button',{name:/entrar/i}).click();
  await expect(page.getByRole('heading',{name:'Estrutura escolar',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Alunos e responsáveis',exact:true}).click();
  await page.getByRole('button',{name:'Importar planilha',exact:true}).click();

  // Planilha Excel de exemplo: colunas reconhecidas pelo título e prévia sem gravar nada.
  await page.locator('#import-file').setInputFiles(sample);
  await expect(page.getByText('planilha-alunos-ficticia.xlsx: 12 linha(s).',{exact:false})).toBeVisible();
  await expect(page.getByLabel('Nome do aluno (obrigatório)')).toHaveValue('0');
  await expect(page.getByLabel('Telefone (WhatsApp) do responsável')).toHaveValue('5');
  await expect(page.getByLabel('Turma (código)')).toHaveValue('2');
  await page.getByLabel('Período letivo das turmas (obrigatório)').selectOption({label:`IMP${tag}`});
  await page.getByRole('button',{name:'Conferir antes de importar',exact:true}).click();
  const preview=page.getByRole('region',{name:'Prévia'});
  await expect(preview).toContainText('11 aluno(s) novo(s)');
  await expect(preview.getByRole('row').filter({hasText:'mesmo aluno da linha 3'})).toHaveCount(1);
  await expect(preview.getByRole('row').filter({hasText:'mesmo responsável da linha 2'})).toHaveCount(1);
  await expect(preview.getByRole('button',{name:'Importar 12 linha(s)',exact:true})).toBeEnabled();
  await preview.getByRole('button',{name:'Voltar',exact:true}).click();

  // CSV com dois irmãos e uma linha com erro: importa só as linhas sem erro.
  const mother=`Mãe Importada ${tag}`,first=`Irmão Importado ${tag}`,second=`Irmã Importada ${tag}`;
  const phone=`(11) 9${tag.slice(-4)}-${tag.slice(-8,-4)}`;
  const csv=['Aluno;Nascimento;Responsável;Celular;Turma',`${first};10/05/2022;${mother};${phone};T1`,
    `${second};11/06/2021;${mother};${phone};T2`,`Data Errada ${tag};31/02/2021;;;`].join('\n');
  await page.locator('#import-file').setInputFiles({name:'lista.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.getByLabel('Período letivo das turmas (obrigatório)').selectOption({label:`IMP${tag}`});
  await page.getByRole('button',{name:'Conferir antes de importar',exact:true}).click();
  await expect(preview.getByRole('row').filter({hasText:'Data de nascimento inválida'})).toHaveCount(1);
  await preview.getByRole('button',{name:'Importar só as 2 linha(s) sem erro',exact:true}).click();
  await expect(page.getByText(/Importação concluída\. 2 aluno\(s\) novo\(s\).*1 responsável\(is\) novo\(s\).*2 matrícula\(s\)/)).toBeVisible();

  await page.getByRole('button',{name:'Alunos',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:first})).toHaveCount(1);
  await page.getByRole('button',{name:'Responsáveis',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:mother})).toHaveCount(1);
  await page.getByRole('link',{name:'Matrículas',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:second})).toContainText('T2');
  expect(errors).toEqual([]);
});
