import { createHash } from 'node:crypto';
import { z } from 'zod';
import { guardianFor, guardianLockKeys, nameKey, validCpf } from './identity.js';

// Importação de planilha: cria alunos, responsáveis, vínculos e, se houver turma, a matrícula.
// A tela lê a planilha e envia as linhas já com cada coluna no seu campo.
export const importTables = ['people_imports'];
export const MAX_IMPORT_ROWS = 500;
const fields = ['student_name','birth_date','student_cpf','guardian_name','guardian_phone','guardian_email','guardian_cpf',
  'relationship','class_code','level'];
const cell = z.union([z.string().max(300), z.null()]).optional();
export const importSchema = z.object({
  academic_year_id: z.string().uuid().nullable().optional().transform(v => v ?? null),
  guardians_are_legal: z.boolean(),
  rows: z.array(z.object({ line: z.number().int().min(1).max(100000),
    ...Object.fromEntries(fields.map(f => [f, cell])) }).strict()).min(1).max(MAX_IMPORT_ROWS)
}).strict();

export function fail(statusCode) { const e = new Error('Erro de importação'); e.statusCode = statusCode; throw e; }
function administrator(user) { if (!['school_admin','platform_admin'].includes(user.role)) fail(403); }
const lock = (client, key) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');

const control = /[\u0000-\u001f\u007f]/;
const clean = v => typeof v === 'string' && v.trim() ? v.trim() : null;
const today = () => new Date().toISOString().slice(0, 10);
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '1900-01-01' && v <= today()
  && !Number.isNaN(new Date(`${v}T00:00:00Z`).valueOf()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const phoneOk = v => v.length <= 30 && /^[+\d().\s-]+$/.test(v) && (v.match(/\d/g) || []).length >= 10;
const emailOk = v => z.string().email().max(150).safeParse(v).success;
const digits = v => v && v.replace(/\D/g, '');

// Confere uma linha sem consultar o banco; as mensagens aparecem para a secretaria na prévia.
function checkRow(raw, hasYear) {
  const v = Object.fromEntries(fields.map(f => [f, clean(raw[f])]));
  for (const f of ['student_name','guardian_name','relationship']) if (v[f]) v[f] = v[f].replace(/\s+/g, ' ');
  const errors = [];
  if (Object.values(v).some(x => x && control.test(x))) errors.push('A linha tem caracteres inválidos.');
  if (!v.student_name) errors.push('Informe o nome do aluno.');
  else if (v.student_name.length > 150) errors.push('O nome do aluno passa de 150 letras.');
  if (!v.birth_date) errors.push('Informe a data de nascimento do aluno.');
  else if (!validDate(v.birth_date)) errors.push('Data de nascimento inválida. Use dd/mm/aaaa.');
  if (v.student_cpf && !validCpf(v.student_cpf)) errors.push('CPF do aluno inválido.');
  const guardian = ['guardian_name','guardian_phone','guardian_email','guardian_cpf'].some(f => v[f]);
  if (guardian) {
    if (!v.guardian_name) errors.push('Informe o nome do responsável.');
    else if (v.guardian_name.length > 150) errors.push('O nome do responsável passa de 150 letras.');
    if (!v.guardian_phone && !v.guardian_cpf) errors.push('Informe o telefone ou o CPF do responsável.');
    if (v.guardian_phone && !phoneOk(v.guardian_phone)) errors.push('Telefone do responsável inválido. Inclua o DDD.');
    if (v.guardian_email && !emailOk(v.guardian_email)) errors.push('E-mail do responsável inválido.');
    if (v.guardian_cpf && !validCpf(v.guardian_cpf)) errors.push('CPF do responsável inválido.');
    if (v.relationship && v.relationship.length > 80) errors.push('O parentesco passa de 80 letras.');
  }
  if ((v.class_code || v.level) && !hasYear) errors.push('Escolha o período letivo para usar a turma.');
  if (v.level && !v.class_code) errors.push('Informe a turma junto com a série.');
  return { errors, value: { ...v, student_cpf: digits(v.student_cpf), guardian_cpf: digits(v.guardian_cpf),
    guardian_email: v.guardian_email?.toLowerCase() ?? null, guardian: guardian && !!v.guardian_name } };
}

const report = rows => rows.map(r => ({ line: r.line, status: r.errors.length ? 'erro' : r.status ?? 'pronto',
  actions: r.actions ?? [], errors: r.errors }));

// Com commit=false (prévia) e linhas com erro, as linhas válidas são processadas para mostrar o resultado;
// a prévia sempre é desfeita. Com commit=true e qualquer erro, nada é gravado.
async function run(client, user, data, commit) {
  administrator(user);
  // Uma importação por vez na escola: reenvios e importações simultâneas não duplicam alunos.
  await lock(client, `people-import:${user.school_id}`);
  const year = data.academic_year_id;
  if (year) {
    const { rowCount } = await client.query('SELECT 1 FROM public.academic_years WHERE school_id=$1 AND id=$2', [user.school_id, year]);
    if (!rowCount) fail(404);
  }
  const rows = data.rows.map(raw => ({ line: raw.line, ...checkRow(raw, !!year) }));

  let groups = new Map(), enrolled = new Set();
  if (year) {
    const { rows: found } = await client.query(`SELECT g.id, g.code, json_agg(json_build_object('id', l.id, 'code', l.code, 'name', l.name)
        ORDER BY l.code) AS levels
      FROM public.class_groups g
      JOIN public.class_group_levels gl ON gl.school_id = g.school_id AND gl.class_group_id = g.id
      JOIN public.school_levels l ON l.school_id = gl.school_id AND l.id = gl.level_id
      WHERE g.school_id = $1 AND g.academic_year_id = $2 GROUP BY g.id, g.code`, [user.school_id, year]);
    groups = new Map(found.map(g => [nameKey(g.code), g]));
    const { rows: current } = await client.query('SELECT student_id FROM public.enrollments WHERE school_id=$1 AND academic_year_id=$2',
      [user.school_id, year]);
    enrolled = new Set(current.map(e => e.student_id));
  }
  for (const r of rows) {
    if (r.errors.length || !r.value.class_code) continue;
    const { class_code: code, level: wanted } = r.value;
    const group = groups.get(nameKey(code));
    if (!group) { r.errors.push(`Turma ${code} não encontrada no período escolhido.`); continue; }
    const level = wanted ? group.levels.find(l => nameKey(l.code) === nameKey(wanted) || nameKey(l.name) === nameKey(wanted))
      : group.levels.length === 1 ? group.levels[0] : null;
    if (level) r.target = { group_id: group.id, level_id: level.id, code: group.code };
    else r.errors.push(wanted ? `A série ${wanted} não pertence à turma ${code}.` : `A turma ${code} tem mais de uma série. Informe a série.`);
  }

  const failed = rows.filter(r => r.errors.length).length;
  const summary = { rows: rows.length, rows_with_errors: failed, students_created: 0, students_existing: 0,
    guardians_created: 0, guardians_reused: 0, links_created: 0, enrollments_created: 0 };
  const created = { students: [], guardians: [], enrollments: [] };
  if (commit && failed) return { ok: false, rows: report(rows), summary, created };

  const valid = rows.filter(r => !r.errors.length);
  for (const key of guardianLockKeys(user.school_id, valid.filter(r => r.value.guardian)
    .map(r => ({ phone: r.value.guardian_phone, cpf: r.value.guardian_cpf })))) await lock(client, key);

  const { rows: students } = await client.query(`SELECT id, full_name, birth_date::text AS birth_date, cpf
    FROM public.students WHERE school_id=$1 ORDER BY created_at, id`, [user.school_id]);
  const byCpf = new Map(), byNameBirth = new Map();
  const remember = s => {
    if (s.cpf) byCpf.set(s.cpf, s.id);
    const key = `${nameKey(s.full_name)}|${s.birth_date}`;
    byNameBirth.set(key, [...(byNameBirth.get(key) ?? []), s]);
  };
  students.forEach(remember);
  const { rows: links } = await client.query('SELECT student_id, guardian_id FROM public.student_guardians WHERE school_id=$1', [user.school_id]);
  const linked = new Set(links.map(l => `${l.student_id}|${l.guardian_id}`));
  const newStudents = new Map(), existingStudents = new Set(), newGuardians = new Map(), reusedGuardians = new Set();

  for (const r of valid) {
    const v = r.value; r.actions = [];
    // Mesmo CPF é o mesmo aluno; sem CPF divergente, mesmo nome e nascimento também.
    let studentId = (v.student_cpf && byCpf.get(v.student_cpf)) || null;
    if (!studentId) {
      const same = (byNameBirth.get(`${nameKey(v.student_name)}|${v.birth_date}`) ?? []).find(s => !v.student_cpf || !s.cpf);
      studentId = same?.id ?? null;
    }
    if (!studentId) {
      const { rows: [s] } = await client.query(`INSERT INTO public.students(school_id, full_name, birth_date, cpf)
        VALUES($1,$2,$3,$4) RETURNING id`, [user.school_id, v.student_name, v.birth_date, v.student_cpf]);
      studentId = s.id;
      remember({ id: s.id, full_name: v.student_name, birth_date: v.birth_date, cpf: v.student_cpf });
      newStudents.set(s.id, r.line); created.students.push(s.id);
      r.status = 'novo'; r.actions.push('aluno novo');
    } else if (newStudents.has(studentId)) {
      r.status = 'novo'; r.actions.push(`mesmo aluno da linha ${newStudents.get(studentId)}`);
    } else {
      existingStudents.add(studentId);
      r.status = 'existente'; r.actions.push('aluno já cadastrado');
    }

    if (v.guardian) {
      const g = await guardianFor(client, user, { full_name: v.guardian_name, phone: v.guardian_phone,
        email: v.guardian_email, cpf: v.guardian_cpf });
      if (g.created) { newGuardians.set(g.id, r.line); created.guardians.push(g.id); r.actions.push('responsável novo'); }
      else if (newGuardians.has(g.id)) r.actions.push(`mesmo responsável da linha ${newGuardians.get(g.id)}`);
      else { reusedGuardians.add(g.id); r.actions.push('responsável já cadastrado'); }
      const key = `${studentId}|${g.id}`;
      if (linked.has(key)) r.actions.push('vínculo já existia');
      else {
        await client.query(`INSERT INTO public.student_guardians(school_id, student_id, guardian_id, relationship, is_legal)
          VALUES($1,$2,$3,$4,$5)`, [user.school_id, studentId, g.id, v.relationship ?? 'Responsável', data.guardians_are_legal]);
        linked.add(key); summary.links_created++; r.actions.push('vínculo criado');
      }
    }

    if (r.target) {
      if (enrolled.has(studentId)) r.actions.push('já matriculado neste período');
      else {
        const { rows: [e] } = await client.query(`INSERT INTO public.enrollments(school_id, student_id, academic_year_id, class_group_id, level_id)
          VALUES($1,$2,$3,$4,$5) RETURNING id`, [user.school_id, studentId, year, r.target.group_id, r.target.level_id]);
        enrolled.add(studentId); created.enrollments.push(e.id); summary.enrollments_created++;
        r.actions.push(`matrícula na turma ${r.target.code}`);
      }
    }
  }
  Object.assign(summary, { students_created: newStudents.size, students_existing: existingStudents.size,
    guardians_created: newGuardians.size, guardians_reused: reusedGuardians.size });
  return { ok: failed === 0, rows: report(rows), summary, created };
}

class Preview extends Error { constructor(result) { super('prévia'); this.result = result; } }

// A prévia faz a importação completa e desfaz a transação: mostra exatamente o que a importação faria.
export async function previewImport(withTenant, data) {
  try { await withTenant(async (client, user) => { throw new Preview(await run(client, user, data, false)); }); }
  catch (error) {
    if (!(error instanceof Preview)) throw error;
    const { rows, summary, ok } = error.result;
    return { rows, summary, can_import: ok };
  }
  throw new Error('Prévia sem resultado');
}

export async function commitImport(client, user, data, key) {
  administrator(user);
  const payloadHash = hash(data);
  await lock(client, JSON.stringify(['people-imports', user.school_id, user.id, key]));
  const { rows: [previous] } = await client.query(`SELECT payload_hash, result FROM public.people_imports
    WHERE school_id=$1 AND user_id=$2 AND request_key=$3`, [user.school_id, user.id, key]);
  if (previous) {
    if (previous.payload_hash !== payloadHash) fail(409);
    return { ok: true, rows: previous.result.rows, summary: previous.result.summary, replayed: true };
  }
  const result = await run(client, user, data, true);
  if (!result.ok) return { ...result, replayed: false };
  // Auditoria por referência: linhas, situações e ids criados, sem nomes, datas ou contatos.
  await client.query(`INSERT INTO public.people_imports(school_id, user_id, request_key, payload_hash, result)
    VALUES($1,$2,$3,$4,$5)`, [user.school_id, user.id, key, payloadHash,
    JSON.stringify({ summary: result.summary, rows: result.rows, created: result.created })]);
  return { ...result, replayed: false };
}
