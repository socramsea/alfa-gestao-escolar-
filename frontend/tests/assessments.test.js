import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentsRequest, buildScores, parseScore } from '../src/auth/assessments-api.js';

test('notas: envia credencial e chave de reenvio e mostra a mensagem do servidor em portugues',async t=>{
  const body={scores:[{student_id:'aluno',score:7.5}]};
  const mock=t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'/api/assessments/avaliacao/scores');
    assert.equal(options.headers.Authorization,'Bearer token');
    assert.equal(options.headers['Idempotency-Key'],'mesma-chave');
    assert.deepEqual(JSON.parse(options.body),body);
    return Response.json({launched:1,corrected:0});
  });
  const data=await assessmentsRequest('token','/avaliacao/scores',{method:'POST',body:JSON.stringify(body),headers:{'Idempotency-Key':'mesma-chave'}});
  assert.equal(data.launched,1);mock.mock.restore();
  const items=[{index:0,student_id:'aluno',error:'Este aluno já tem nota. Para mudar, envie a correção com o motivo.'}];
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Notas não salvas: corrija os itens indicados. Nenhuma nota foi gravada.',items},{status:409}));
  await assert.rejects(()=>assessmentsRequest('token','/avaliacao/scores'),e=>e.status===409 && /Nenhuma nota foi gravada/.test(e.message) && e.body.items[0].error===items[0].error);
});
test('notas: sem mensagem do servidor usa texto proprio; sessao expirada e falha de rede',async t=>{
  for(const [status,message] of [[400,/Confira os dados/],[401,/Sessão expirada/],[403,/não pode lançar notas/],[404,/não está disponível/],[409,/Recarregue a turma/],[500,/Não foi possível concluir/]]){
    const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({},{status}));
    await assert.rejects(()=>assessmentsRequest('token','/types'),e=>e.status===status && message.test(e.message));
    mock.mock.restore();
  }
  const expired=t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Identidade invalida ou acesso bloqueado'},{status:401}));
  await assert.rejects(()=>assessmentsRequest('token','/types'),/Sessão expirada/);
  expired.mock.restore();
  t.mock.method(globalThis,'fetch',async()=>{throw Error('detalhe interno');});
  await assert.rejects(()=>assessmentsRequest('token','/types'),/não grava a nota duas vezes/);
});
test('notas: aceita virgula ou ponto, de 0 a 10, com ate duas casas',()=>{
  assert.equal(parseScore('7,5'),7.5);assert.equal(parseScore('10'),10);assert.equal(parseScore(' 0 '),0);assert.equal(parseScore('8.25'),8.25);
  for(const bad of ['10,5','11','-1','7,555','abc','','1e1','7,']) assert.equal(parseScore(bad),null,bad);
});
test('notas: o lote leva notas novas e corrigidas com motivo, e ignora as iguais e as vazias',()=>{
  const students=[
    {student_id:'ana',student_name:'Ana',scores:[{assessment_id:'p1',student_assessment_id:'n-ana',score:8}]},
    {student_id:'bruno',student_name:'Bruno',scores:[{assessment_id:'p1',student_assessment_id:'n-bruno',score:5.5}]},
    {student_id:'carla',student_name:'Carla',scores:[]},
    {student_id:'davi',student_name:'Davi',scores:[]}];
  const typed={ana:'8,0',bruno:'6,5',carla:'9',davi:''};
  assert.deepEqual(buildScores(students,'p1',typed,'Questão recontada'),{errors:[],scores:[
    {student_id:'bruno',score:6.5,corrects_id:'n-bruno',reason:'Questão recontada'},{student_id:'carla',score:9}]});
  assert.deepEqual(buildScores(students,'p1',typed,'  ').errors,['Informe o motivo da correção das notas alteradas.']);
  assert.deepEqual(buildScores(students,'p1',{carla:'12'},'').errors,['Carla: a nota deve ser um número de 0 a 10, com até duas casas decimais.']);
  assert.deepEqual(buildScores(students,'p1',{carla:'7'},''),{errors:[],scores:[{student_id:'carla',score:7}]},'nota nova não pede motivo');
});
