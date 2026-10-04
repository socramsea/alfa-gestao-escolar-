import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const onlineEnrollmentTables = ['enrollment_form_settings','online_enrollments','online_enrollment_links',
  'online_enrollment_link_revocations','online_enrollment_access_attempts','online_enrollment_submissions',
  'online_enrollment_reviews','online_enrollment_events'];
// Campos que cada escola pode tornar obrigatórios; nome, nascimento, um responsável e o aceite são sempre exigidos.
export const optionalRequirements = ['child_cpf','child_health','guardian_cpf','guardian_email','address','second_guardian'];
export const applicationStates = ['convidada','enviada','correcao','aprovada','recusada'];
export const LINK_TTL_DAYS = 15;

export function fail(statusCode) { const e = new Error('Erro de matrícula online'); e.statusCode = statusCode; throw e; }
function administrator(user) { if (!['school_admin','platform_admin'].includes(user.role)) fail(403); }

const clean = v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const line = max => z.string().trim().min(1).max(max).refine(v => clean(v) && !/[\r\n]/.test(v));
const multiline = max => z.string().trim().min(1).max(max).refine(clean);
const optional = schema => z.preprocess(v => typeof v === 'string' && !v.trim() ? null : v,
  schema.nullable().optional().transform(v => v ?? null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return v >= '1900-01-01' && !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === v
    && v <= new Date().toISOString().slice(0,10);
});
const phone = line(30).refine(v => /^[+\d().\s-]+$/.test(v) && (v.match(/\d/g) || []).length >= 10);
const email = z.string().trim().email().max(150).transform(v => v.toLowerCase());

export function validCpf(value) {
  const d = value.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = n => { let sum = 0; for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}
const cpf = z.string().trim().refine(validCpf).transform(v => v.replace(/\D/g, ''));

const guardianSchema = z.object({ full_name: line(150), relationship: line(80), phone, email: optional(email),
  cpf: optional(cpf), is_legal: z.boolean(), is_financial: z.boolean() }).strict();
const addressSchema = z.object({ zip_code: optional(line(9).refine(v => /^\d{5}-?\d{3}$/.test(v))),
  street: optional(line(160)), number: optional(line(20)), complement: optional(line(80)), district: optional(line(80)),
  city: optional(line(80)), state: optional(line(2).refine(v => /^[A-Za-z]{2}$/.test(v)).transform(v => v.toUpperCase())) }).strict();

// Ficha enviada pela família. As exigências de cada escola são aplicadas por requirementsCheck.
export const submissionSchema = z.object({
  child: z.object({ full_name: line(150), social_name: optional(line(150)), cpf: optional(cpf),
    health_notes: optional(multiline(2000)) }).strict(),
  guardians: z.array(guardianSchema).min(1).max(2),
  address: addressSchema.default({}),
  accept_terms: z.literal(true)
}).strict();

export function requirementsCheck(data, required) {
  const need = new Set(required);
  if (!data.guardians.some(g => g.is_financial)) return false;
  if (!data.guardians.some(g => g.is_legal)) return false;
  if (need.has('child_cpf') && !data.child.cpf) return false;
  if (need.has('child_health') && !data.child.health_notes) return false;
  if (need.has('guardian_cpf') && data.guardians.some(g => !g.cpf)) return false;
  if (need.has('guardian_email') && !data.guardians[0].email) return false;
  if (need.has('second_guardian') && data.guardians.length < 2) return false;
  if (need.has('address') && ['zip_code','street','number','district','city','state'].some(k => !data.address[k])) return false;
  return true;
}

export const resources = {
  settings: z.object({ required_fields: z.array(z.enum(optionalRequirements)).max(optionalRequirements.length)
    .refine(v => new Set(v).size === v.length), terms_text: optional(multiline(20000)) }).strict(),
  applications: z.union([
    z.object({ lead_id: z.string().uuid(), child_birth_date: date.optional() }).strict(),
    z.object({ child_name: line(150), child_birth_date: date, guardian_name: line(150), guardian_phone: phone }).strict()
  ]),
  links: z.object({ application_id: z.string().uuid() }).strict(),
  reviews: z.object({ submission_id: z.string().uuid(), decision: z.enum(['aprovada','correcao','recusada']),
    note: optional(multiline(1000)), class_group_id: z.string().uuid().optional(), level_id: z.string().uuid().optional() })
    .strict().refine(v => v.decision === 'aprovada' ? v.class_group_id && v.level_id : v.note)
};

export const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export const hashToken = token => createHash('sha256').update(token).digest('hex');
const lock = (client, parts) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [parts]);

const stateExpression = `CASE
  WHEN EXISTS (SELECT 1 FROM public.online_enrollment_reviews rv WHERE rv.school_id=a.school_id AND rv.application_id=a.id AND rv.decision='aprovada') THEN 'aprovada'
  WHEN EXISTS (SELECT 1 FROM public.online_enrollment_reviews rv WHERE rv.school_id=a.school_id AND rv.application_id=a.id AND rv.decision='recusada') THEN 'recusada'
  WHEN NOT EXISTS (SELECT 1 FROM public.online_enrollment_submissions sb WHERE sb.school_id=a.school_id AND sb.application_id=a.id) THEN 'convidada'
  WHEN EXISTS (SELECT 1 FROM public.online_enrollment_submissions sb WHERE sb.school_id=a.school_id AND sb.application_id=a.id
    AND NOT EXISTS (SELECT 1 FROM public.online_enrollment_reviews rv WHERE rv.school_id=sb.school_id AND rv.submission_id=sb.id)) THEN 'enviada'
  ELSE 'correcao' END`;
const projection = `a.id,a.school_id,a.lead_id,a.child_name,a.child_birth_date::text AS child_birth_date,a.guardian_name,
  a.guardian_phone,a.created_at,${stateExpression} AS state,
  (SELECT max(sb.created_at) FROM public.online_enrollment_submissions sb WHERE sb.school_id=a.school_id AND sb.application_id=a.id) AS submitted_at`;

async function findApplication(client, user, id) {
  const { rows:[item] } = await client.query(`SELECT ${projection} FROM public.online_enrollments a WHERE a.school_id=$1 AND a.id=$2`,
    [user.school_id, id]);
  return item;
}

export async function currentSettings(client, user) {
  administrator(user);
  const { rows:[item] } = await client.query(`SELECT id,required_fields,terms_text,created_at FROM public.enrollment_form_settings
    WHERE school_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [user.school_id]);
  return { item: item ?? { id: null, required_fields: [], terms_text: null, created_at: null } };
}

export async function listApplications(client, user, page, state) {
  administrator(user);
  const { rows } = await client.query(`SELECT * FROM (SELECT ${projection} FROM public.online_enrollments a WHERE a.school_id=$1) x
    WHERE $3::text IS NULL OR x.state=$3 ORDER BY x.created_at DESC,x.id DESC LIMIT 101 OFFSET $2`,
  [user.school_id, (page-1)*100, state]);
  return { items: rows.slice(0,100), page, has_more: rows.length>100 };
}

export async function applicationDetail(client, user, id) {
  administrator(user);
  const item = await findApplication(client, user, id);
  if (!item) fail(404);
  const { rows: submissions } = await client.query(`SELECT sb.id,sb.data,sb.settings_id,sb.created_at,f.required_fields,
      rv.decision,rv.note,rv.created_at AS reviewed_at,rv.student_id,rv.enrollment_id
    FROM public.online_enrollment_submissions sb
    LEFT JOIN public.enrollment_form_settings f ON f.school_id=sb.school_id AND f.id=sb.settings_id
    LEFT JOIN public.online_enrollment_reviews rv ON rv.school_id=sb.school_id AND rv.submission_id=sb.id
    WHERE sb.school_id=$1 AND sb.application_id=$2 ORDER BY sb.created_at DESC,sb.id DESC`, [user.school_id, id]);
  const { rows: links } = await client.query(`SELECT l.id,l.expires_at,l.created_at,
      EXISTS (SELECT 1 FROM public.online_enrollment_link_revocations r WHERE r.school_id=l.school_id AND r.link_id=l.id) AS revoked,
      (SELECT count(*)::int FROM public.online_enrollment_access_attempts t WHERE t.school_id=l.school_id AND t.link_id=l.id AND t.success) AS accesses
    FROM public.online_enrollment_links l WHERE l.school_id=$1 AND l.application_id=$2 ORDER BY l.created_at DESC`, [user.school_id, id]);
  return { item: { ...item, submissions, links } };
}

const finders = {
  settings: async (client, user, id) => (await client.query(
    'SELECT id,required_fields,terms_text,created_at FROM public.enrollment_form_settings WHERE school_id=$1 AND id=$2', [user.school_id, id])).rows[0],
  applications: findApplication,
  links: async (client, user, id) => (await client.query(
    'SELECT id,application_id,expires_at,created_at FROM public.online_enrollment_links WHERE school_id=$1 AND id=$2', [user.school_id, id])).rows[0],
  reviews: async (client, user, id) => (await client.query(`SELECT id,application_id,submission_id,decision,note,student_id,
    enrollment_id,created_at FROM public.online_enrollment_reviews WHERE school_id=$1 AND id=$2`, [user.school_id, id])).rows[0]
};

const inserts = {
  async settings(client, user, data) {
    const { rows:[item] } = await client.query(`INSERT INTO public.enrollment_form_settings(school_id,required_fields,terms_text)
      VALUES($1,$2,$3) RETURNING id`, [user.school_id, data.required_fields, data.terms_text]);
    return item.id;
  },
  async applications(client, user, data) {
    let values = data;
    if (data.lead_id) {
      const { rows:[lead] } = await client.query(`SELECT id,child_name,child_birth_date::text AS child_birth_date,guardian_name,
        guardian_phone FROM public.admission_leads WHERE school_id=$1 AND id=$2`, [user.school_id, data.lead_id]);
      if (!lead) fail(404);
      const birth = data.child_birth_date ?? lead.child_birth_date;
      if (!birth) fail(400);
      values = { ...lead, lead_id: lead.id, child_birth_date: birth };
    }
    const { rows:[item] } = await client.query(`INSERT INTO public.online_enrollments(school_id,lead_id,child_name,child_birth_date,
      guardian_name,guardian_phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [user.school_id, values.lead_id ?? null, values.child_name, values.child_birth_date, values.guardian_name, values.guardian_phone]);
    return item.id;
  },
  async links(client, user, data, extra) {
    const application = await findApplication(client, user, data.application_id);
    if (!application) fail(404);
    if (['aprovada','recusada'].includes(application.state)) fail(409);
    await lock(client, `family-application-links:${data.application_id}`);
    // Um link ativo por ficha: gerar outro revoga os anteriores.
    await client.query(`INSERT INTO public.online_enrollment_link_revocations(school_id,link_id)
      SELECT l.school_id,l.id FROM public.online_enrollment_links l WHERE l.school_id=$1 AND l.application_id=$2
        AND NOT EXISTS (SELECT 1 FROM public.online_enrollment_link_revocations r WHERE r.school_id=l.school_id AND r.link_id=l.id)`,
    [user.school_id, data.application_id]);
    const { rows:[item] } = await client.query(`INSERT INTO public.online_enrollment_links(school_id,application_id,token_hash,expires_at)
      VALUES($1,$2,$3,now() + make_interval(days => $4)) RETURNING id`,
    [user.school_id, data.application_id, hashToken(extra.token), LINK_TTL_DAYS]);
    return item.id;
  },
  async reviews(client, user, data) {
    const { rows:[submission] } = await client.query(`SELECT sb.id,sb.application_id,sb.data,a.child_birth_date::text AS child_birth_date,a.lead_id
      FROM public.online_enrollment_submissions sb JOIN public.online_enrollments a ON a.school_id=sb.school_id AND a.id=sb.application_id
      WHERE sb.school_id=$1 AND sb.id=$2`, [user.school_id, data.submission_id]);
    if (!submission) fail(404);
    await lock(client, `family-application:${submission.application_id}`);
    const application = await findApplication(client, user, submission.application_id);
    // Só a ficha mais recente e ainda não analisada pode receber decisão.
    const { rows:[latest] } = await client.query(`SELECT sb.id FROM public.online_enrollment_submissions sb
      WHERE sb.school_id=$1 AND sb.application_id=$2 ORDER BY sb.created_at DESC,sb.id DESC LIMIT 1`, [user.school_id, submission.application_id]);
    if (application.state !== 'enviada' || latest.id !== submission.id) fail(409);

    let studentId = null, enrollmentId = null;
    if (data.decision === 'aprovada') {
      const { rows:[group] } = await client.query(`SELECT g.academic_year_id FROM public.class_groups g
        JOIN public.class_group_levels gl ON gl.school_id=g.school_id AND gl.class_group_id=g.id AND gl.stage_code=g.stage_code
        WHERE g.school_id=$1 AND g.id=$2 AND gl.level_id=$3`, [user.school_id, data.class_group_id, data.level_id]);
      if (!group) fail(404);
      const ficha = submission.data;
      const { rows:[student] } = await client.query(`INSERT INTO public.students(school_id,full_name,birth_date)
        VALUES($1,$2,$3) RETURNING id`, [user.school_id, ficha.child.full_name, submission.child_birth_date]);
      studentId = student.id;
      for (const g of ficha.guardians) {
        const { rows:[guardian] } = await client.query(`INSERT INTO public.guardians(school_id,full_name,phone,email)
          VALUES($1,$2,$3,$4) RETURNING id`, [user.school_id, g.full_name, g.phone, g.email]);
        await client.query(`INSERT INTO public.student_guardians(school_id,student_id,guardian_id,relationship,is_legal)
          VALUES($1,$2,$3,$4,$5)`, [user.school_id, studentId, guardian.id, g.relationship, g.is_legal]);
      }
      const { rows:[enrollment] } = await client.query(`INSERT INTO public.enrollments(school_id,student_id,academic_year_id,class_group_id,level_id)
        VALUES($1,$2,$3,$4,$5) RETURNING id`, [user.school_id, studentId, group.academic_year_id, data.class_group_id, data.level_id]);
      enrollmentId = enrollment.id;
    }
    const { rows:[item] } = await client.query(`INSERT INTO public.online_enrollment_reviews(school_id,application_id,submission_id,
      decision,note,student_id,enrollment_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [user.school_id, submission.application_id, submission.id, data.decision, data.note, studentId, enrollmentId]);
    // A captação acompanha o desfecho da matrícula.
    if (submission.lead_id && data.decision !== 'correcao') {
      // Mesma trava do registro de visita: o comparecimento lê o desfecho já gravado.
      await lock(client, `lead-booking:${submission.lead_id}`);
      await client.query(`INSERT INTO public.admission_lead_updates(school_id,lead_id,status,note) VALUES($1,$2,$3,$4)`,
        [user.school_id, submission.lead_id, data.decision === 'aprovada' ? 'matriculado' : 'desistiu', data.note]);
    }
    return item.id;
  }
};

export async function create(client, user, operation, data, key) {
  administrator(user);
  const payloadHash = hash(data);
  await lock(client, JSON.stringify(['online-enrollments', user.school_id, user.id, operation, key]));
  const { rows:[previous] } = await client.query(`SELECT payload_hash,entity_id FROM public.online_enrollment_events
    WHERE school_id=$1 AND user_id=$2 AND operation=$3 AND request_key=$4`, [user.school_id, user.id, operation, key]);
  if (previous) {
    if (previous.payload_hash !== payloadHash) fail(409);
    const item = await finders[operation](client, user, previous.entity_id);
    if (!item) fail(404);
    // O token do link só existe na resposta original; o reenvio pede um link novo.
    return { item, replayed: true, token: null };
  }
  const extra = operation === 'links' ? { token: randomBytes(32).toString('base64url') } : {};
  const id = await inserts[operation](client, user, data, extra);
  await client.query(`INSERT INTO public.online_enrollment_events(school_id,user_id,operation,request_key,payload_hash,entity_id)
    VALUES($1,$2,$3,$4,$5,$6)`, [user.school_id, user.id, operation, key, payloadHash, id]);
  return { item: await finders[operation](client, user, id), replayed: false, token: extra.token ?? null };
}
