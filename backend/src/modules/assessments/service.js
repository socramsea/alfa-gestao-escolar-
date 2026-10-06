import { createHash } from 'node:crypto';
import { z } from 'zod';

// Notas e avaliações: tipos de avaliação, avaliações da turma e notas lançadas em lote.
// Nada é alterado nem apagado: a correção de uma nota é uma linha nova com corrects_id.
export const assessmentTables = ['assessment_types','assessments','student_assessments','assessment_events','outbox_events'];
export const MAX_SCORES = 200;

// Erros de regra com mensagem para a secretaria; a rota devolve a mensagem como está.
export class AssessmentError extends Error {
  constructor(statusCode, message, extra = {}) { super(message); this.statusCode = statusCode; this.expose = true; this.extra = extra; }
}
export function reject(statusCode, message, extra) { throw new AssessmentError(statusCode, message, extra); }
function administrator(user) { if (!['school_admin','platform_admin'].includes(user.role)) reject(403, 'Seu perfil não pode lançar notas.'); }
const lock = (client, key) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const civil = date => date.split('-').reverse().join('/');

// Mensagens próprias de cada campo têm prioridade; o resto cai numa mensagem genérica em português.
const portuguese = (issue, ctx) => {
  const english = z.defaultErrorMap(issue, { data: ctx.data, defaultError: '' }).message;
  if (ctx.defaultError !== english) return { message: ctx.defaultError };
  if (issue.code === 'unrecognized_keys') return { message: `Campo não permitido: ${issue.keys.join(', ')}.` };
  return { message: 'Dados inválidos.' };
};
export function parse(schema, data) {
  const parsed = schema.safeParse(data, { errorMap: portuguese });
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  return reject(400, issue.message, { field: issue.path.join('.') || null });
}

const control = /[\u0000-\u001f\u007f]/;
const required = message => ({ required_error: message, invalid_type_error: message });
const text = (max, missing, tooLong) => z.string(required(missing)).trim().min(1, missing).max(max, tooLong)
  .refine(v => !control.test(v), 'O texto tem caracteres inválidos.');
const uuid = (missing, invalid) => z.string(required(missing)).uuid(invalid);
const twoDecimals = v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const decimal = (missing, range, valid) => z.number(required(missing)).refine(Number.isFinite, missing)
  .refine(valid, range).refine(twoDecimals, 'Use no máximo duas casas decimais.');
const weight = (missing) => decimal(missing, 'O peso deve ser maior que 0 e no máximo 100.', v => v > 0 && v <= 100);
const date = z.string(required('Informe a data da avaliação.')).regex(/^\d{4}-\d{2}-\d{2}$/, 'Data da avaliação inválida.')
  .refine(v => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v; },
    'Data da avaliação inválida.');
const body = shape => z.object(shape, required('Envie os dados da avaliação.')).strict();

export const typeSchema = body({
  code: z.string(required('Informe o código do tipo de avaliação.')).trim().toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, 'O código usa de 1 a 20 letras sem acento, números, - ou _.'),
  name: text(80, 'Informe o nome do tipo de avaliação.', 'O nome passa de 80 caracteres.'),
  default_weight: weight('Informe o peso padrão.')
});
export const assessmentSchema = body({
  class_group_id: uuid('Escolha a turma.', 'Turma inválida.'),
  assessment_type_id: uuid('Escolha o tipo de avaliação.', 'Tipo de avaliação inválido.'),
  title: text(120, 'Informe o título da avaliação.', 'O título passa de 120 caracteres.'),
  held_on: date,
  weight: weight('Informe o peso.').nullable().optional().transform(v => v ?? null)
});
const scoreItem = z.object({
  student_id: uuid('Informe o aluno.', 'Aluno inválido.'),
  score: decimal('Informe a nota.', 'A nota deve estar entre 0 e 10.', v => v >= 0 && v <= 10),
  corrects_id: uuid('Informe a nota corrigida.', 'Nota corrigida inválida.').nullable().optional().transform(v => v ?? null),
  reason: z.string(required('Informe o motivo da correção.')).trim().max(300, 'O motivo passa de 300 caracteres.')
    .refine(v => !control.test(v), 'O texto tem caracteres inválidos.').nullable().optional().transform(v => v || null)
}, required('Envie cada nota com aluno e valor.')).strict()
  .superRefine((v, ctx) => { if (v.corrects_id && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Informe o motivo da correção.' }); })
  // O motivo só existe na correção; na primeira nota ele é ignorado.
  .transform(v => ({ ...v, reason: v.corrects_id ? v.reason : null }));
export const scoresSchema = body({
  scores: z.array(scoreItem, required('Envie a lista de notas.'))
    .min(1, 'Informe pelo menos uma nota.').max(MAX_SCORES, `Envie no máximo ${MAX_SCORES} notas por vez.`)
});

// Idempotência: a mesma chave com os mesmos dados devolve o resultado original; com outros dados, conflito.
async function remember(client, user, operation, key, data, work, replay) {
  const hash = digest(data);
  await lock(client, JSON.stringify(['assessments', user.school_id, user.id, operation, key]));
  const { rows: [previous] } = await client.query(`SELECT payload_hash,entity_id,result FROM public.assessment_events
    WHERE school_id=$1 AND user_id=$2 AND operation=$3 AND request_key=$4`, [user.school_id, user.id, operation, key]);
  if (previous) {
    if (previous.payload_hash !== hash) reject(409, 'Esta chave de envio já foi usada com outros dados. Recarregue a página e tente de novo.');
    return { ...(await replay(previous)), replayed: true };
  }
  const { entityId, result, response } = await work();
  // A auditoria guarda referências e hash; as notas ficam só na tabela de notas.
  await client.query(`INSERT INTO public.assessment_events(school_id,user_id,operation,request_key,payload_hash,entity_id,result)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [user.school_id, user.id, operation, key, hash, entityId, result ?? null]);
  return { ...response, replayed: false };
}

const typeProjection = `SELECT t.id,t.code,t.name,t.default_weight::float8 AS default_weight,t.created_at
  FROM public.assessment_types t WHERE t.school_id=$1`;
async function findType(client, user, id) {
  const { rows: [item] } = await client.query(`${typeProjection} AND t.id=$2`, [user.school_id, id]);
  return item;
}
export async function listTypes(client, user, page) {
  administrator(user);
  const { rows } = await client.query(`${typeProjection} ORDER BY t.created_at,t.id LIMIT 101 OFFSET $2`, [user.school_id, (page - 1) * 100]);
  return { items: rows.slice(0, 100), page, has_more: rows.length > 100 };
}
export async function createType(client, user, data, key) {
  administrator(user);
  const item = id => findType(client, user, id).then(found => found ?? reject(404, 'Tipo de avaliação não encontrado na sua escola.'));
  return remember(client, user, 'types', key, data, async () => {
    const { rows: [{ id }] } = await client.query(`INSERT INTO public.assessment_types(school_id,code,name,default_weight)
      VALUES($1,$2,$3,$4) RETURNING id`, [user.school_id, data.code, data.name, data.default_weight.toFixed(2)]);
    return { entityId: id, response: { item: await item(id) } };
  }, async previous => ({ item: await item(previous.entity_id) }));
}

const assessmentProjection = `SELECT a.id,a.class_group_id,a.academic_year_id,a.assessment_type_id,t.code AS type_code,t.name AS type_name,
    a.title,a.held_on::text AS held_on,a.weight::float8 AS weight,a.created_at,
    (SELECT count(*)::int FROM public.student_assessments s
      WHERE s.school_id=a.school_id AND s.assessment_id=a.id AND s.corrects_id IS NULL) AS scored_count
  FROM public.assessments a
  JOIN public.assessment_types t ON t.school_id=a.school_id AND t.id=a.assessment_type_id
  WHERE a.school_id=$1`;
async function findAssessment(client, user, id) {
  const { rows: [item] } = await client.query(`${assessmentProjection} AND a.id=$2`, [user.school_id, id]);
  return item;
}
export async function createAssessment(client, user, data, key) {
  administrator(user);
  const item = id => findAssessment(client, user, id).then(found => found ?? reject(404, 'Avaliação não encontrada na sua escola.'));
  return remember(client, user, 'assessments', key, data, async () => {
    // O período letivo vem do cadastro da turma, nunca do navegador.
    const { rows: [group] } = await client.query(`SELECT g.academic_year_id,y.starts_on::text AS starts_on,y.ends_on::text AS ends_on
      FROM public.class_groups g JOIN public.academic_years y ON y.school_id=g.school_id AND y.id=g.academic_year_id
      WHERE g.school_id=$1 AND g.id=$2`, [user.school_id, data.class_group_id]);
    if (!group) reject(404, 'Turma não encontrada na sua escola.', { field: 'class_group_id' });
    const type = await findType(client, user, data.assessment_type_id);
    if (!type) reject(404, 'Tipo de avaliação não encontrado na sua escola.', { field: 'assessment_type_id' });
    if (data.held_on < group.starts_on || data.held_on > group.ends_on) {
      reject(400, `A data da avaliação precisa ficar dentro do período letivo da turma, de ${civil(group.starts_on)} a ${civil(group.ends_on)}.`,
        { field: 'held_on' });
    }
    const { rows: [{ id }] } = await client.query(`INSERT INTO public.assessments
      (school_id,academic_year_id,class_group_id,assessment_type_id,title,held_on,weight,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [user.school_id, group.academic_year_id, data.class_group_id, type.id, data.title, data.held_on,
      (data.weight ?? type.default_weight).toFixed(2), user.id]);
    return { entityId: id, response: { item: await item(id) } };
  }, async previous => ({ item: await item(previous.entity_id) }));
}

// Nota vigente: a que ninguém corrigiu. A média do aluno na turma é Σ(nota × peso) / Σ(peso)
// sobre as avaliações em que ele tem nota, com duas casas decimais.
const currentScores = `SELECT c.id,c.school_id,c.assessment_id,c.student_id,c.score,c.corrects_id
  FROM public.student_assessments c
  WHERE c.school_id=$1 AND NOT EXISTS(SELECT 1 FROM public.student_assessments n
    WHERE n.school_id=c.school_id AND n.corrects_id=c.id)`;
export async function gradebook(client, user, classGroupId) {
  administrator(user);
  const { rows: [group] } = await client.query(`SELECT g.id,g.code,g.academic_year_id,y.code AS academic_year_code
    FROM public.class_groups g JOIN public.academic_years y ON y.school_id=g.school_id AND y.id=g.academic_year_id
    WHERE g.school_id=$1 AND g.id=$2`, [user.school_id, classGroupId]);
  if (!group) reject(404, 'Turma não encontrada na sua escola.');
  const { rows: assessments } = await client.query(`${assessmentProjection} AND a.class_group_id=$2
    ORDER BY a.held_on,a.created_at,a.id`, [user.school_id, classGroupId]);
  const { rows: students } = await client.query(`WITH current AS (${currentScores}),
    marks AS (SELECT c.*,a.weight FROM current c
      JOIN public.assessments a ON a.school_id=c.school_id AND a.id=c.assessment_id
      WHERE a.class_group_id=$2)
    SELECT e.student_id,s.full_name AS student_name,
      (SELECT round(sum(m.score*m.weight)/sum(m.weight),2)::float8 FROM marks m WHERE m.student_id=e.student_id) AS average,
      (SELECT count(*)::int FROM marks m WHERE m.student_id=e.student_id) AS graded_count,
      COALESCE((SELECT json_agg(json_build_object('assessment_id',m.assessment_id,'student_assessment_id',m.id,
        'score',m.score::float8,'corrected',m.corrects_id IS NOT NULL) ORDER BY m.assessment_id)
        FROM marks m WHERE m.student_id=e.student_id),'[]') AS scores
    FROM public.enrollments e
    JOIN public.students s ON s.school_id=e.school_id AND s.id=e.student_id
    WHERE e.school_id=$1 AND e.class_group_id=$2
    ORDER BY s.full_name,s.id`, [user.school_id, classGroupId]);
  return { class_group: group, assessments, students };
}

export async function scoreHistory(client, user, assessmentId) {
  administrator(user);
  const assessment = await findAssessment(client, user, assessmentId);
  if (!assessment) reject(404, 'Avaliação não encontrada na sua escola.');
  const { rows: items } = await client.query(`SELECT s.id,s.student_id,st.full_name AS student_name,s.score::float8 AS score,
      s.corrects_id,s.reason,s.created_at,u.name AS created_by_name,
      NOT EXISTS(SELECT 1 FROM public.student_assessments n WHERE n.school_id=s.school_id AND n.corrects_id=s.id) AS current
    FROM public.student_assessments s
    JOIN public.students st ON st.school_id=s.school_id AND st.id=s.student_id
    JOIN public.users u ON u.school_id=s.school_id AND u.id=s.created_by
    WHERE s.school_id=$1 AND s.assessment_id=$2
    ORDER BY st.full_name,s.student_id,s.created_at,s.id`, [user.school_id, assessmentId]);
  return { assessment, items };
}

// Lançamento em lote, tudo ou nada. Sem nota anterior, grava a nota; com nota anterior, só aceita a correção
// da nota vigente (corrects_id) com motivo. Cada nota gravada publica o evento nota_lancada no canal interno.
export async function launchScores(client, user, assessmentId, data, key) {
  administrator(user);
  return remember(client, user, 'scores', key, { assessment_id: assessmentId, ...data }, async () => {
    // Um lançamento por vez na mesma avaliação: a nota vigente conferida abaixo não muda até o fim da transação.
    await lock(client, JSON.stringify(['assessment-scores', user.school_id, assessmentId]));
    const { rows: [assessment] } = await client.query(`SELECT id,class_group_id,academic_year_id FROM public.assessments
      WHERE school_id=$1 AND id=$2`, [user.school_id, assessmentId]);
    if (!assessment) reject(404, 'Avaliação não encontrada na sua escola.');
    const { rows: enrolled } = await client.query(`SELECT student_id FROM public.enrollments
      WHERE school_id=$1 AND class_group_id=$2 AND academic_year_id=$3`, [user.school_id, assessment.class_group_id, assessment.academic_year_id]);
    const { rows: current } = await client.query(`${currentScores} AND c.assessment_id=$2`, [user.school_id, assessmentId]);
    const students = new Set(enrolled.map(r => r.student_id));
    const scores = new Map(current.map(r => [r.student_id, r]));
    const seen = new Set();
    const errors = [];
    data.scores.forEach((item, index) => {
      const problem = (message, conflict = false) => errors.push({ index, student_id: item.student_id, error: message, conflict });
      const previous = scores.get(item.student_id);
      if (seen.has(item.student_id)) return problem('Aluno repetido neste envio.');
      seen.add(item.student_id);
      if (!students.has(item.student_id)) return problem('O aluno não está matriculado nesta turma.');
      if (!previous) return item.corrects_id ? problem('Este aluno ainda não tem nota para corrigir.', true) : null;
      if (!item.corrects_id) return problem('Este aluno já tem nota. Para mudar, envie a correção com o motivo.', true);
      if (item.corrects_id !== previous.id) return problem('A nota deste aluno mudou desde que a lista foi aberta. Recarregue e tente de novo.', true);
      if (Number(previous.score).toFixed(2) === item.score.toFixed(2)) return problem('A nota corrigida é igual à nota atual.');
      return null;
    });
    if (errors.length) {
      reject(errors.some(e => e.conflict) ? 409 : 400, 'Notas não salvas: corrija os itens indicados. Nenhuma nota foi gravada.',
        { items: errors.map(({ conflict: _conflict, ...e }) => e) });
    }
    // Notas e eventos na mesma instrução: ou entram juntos, ou nada entra.
    const { rows: inserted } = await client.query(`WITH inserted AS (
        INSERT INTO public.student_assessments(school_id,assessment_id,student_id,score,corrects_id,reason,created_by)
        SELECT $1,$2,x.student_id,x.score,x.corrects_id,x.reason,$3
        FROM unnest($4::uuid[],$5::numeric[],$6::uuid[],$7::text[]) AS x(student_id,score,corrects_id,reason)
        RETURNING id,student_id,score,corrects_id),
      published AS (
        INSERT INTO public.outbox_events(school_id,topic,entity_id,payload)
        SELECT $1,'nota_lancada',i.id,jsonb_build_object('student_assessment_id',i.id,'assessment_id',$2::uuid,
          'student_id',i.student_id,'corrects_id',i.corrects_id)
        FROM inserted i)
      SELECT id,student_id,corrects_id FROM inserted`,
    [user.school_id, assessmentId, user.id, data.scores.map(s => s.student_id), data.scores.map(s => s.score.toFixed(2)),
      data.scores.map(s => s.corrects_id), data.scores.map(s => s.reason)]);
    // Aviso no canal do banco, entregue só se a transação for confirmada; leva apenas o tópico.
    await client.query("SELECT pg_notify('alfa_eventos', $1)", [JSON.stringify({ topic: 'nota_lancada' })]);
    const byStudent = new Map(inserted.map(r => [r.student_id, r.id]));
    // O registro de idempotência guarda só referências; a resposta é remontada da tabela de notas.
    const result = { assessment_id: assessmentId, launched: inserted.filter(r => !r.corrects_id).length,
      corrected: inserted.filter(r => r.corrects_id).length, student_assessment_ids: data.scores.map(s => byStudent.get(s.student_id)) };
    return { entityId: assessmentId, result, response: await launchResponse(client, user, result) };
  }, async previous => launchResponse(client, user, previous.result));
}
async function launchResponse(client, user, result) {
  const { rows } = await client.query(`SELECT id,student_id,score::float8 AS score,corrects_id FROM public.student_assessments
    WHERE school_id=$1 AND id=ANY($2::uuid[])`, [user.school_id, result.student_assessment_ids]);
  const byId = new Map(rows.map(r => [r.id, r]));
  return { assessment_id: result.assessment_id, launched: result.launched, corrected: result.corrected,
    scores: result.student_assessment_ids.map(id => { const r = byId.get(id);
      return { student_id: r.student_id, student_assessment_id: r.id, score: r.score, corrects_id: r.corrects_id }; }) };
}
