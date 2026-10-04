import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';

export const admissionTables = ['school_site_addresses','school_site_versions','site_images','admission_leads',
  'admission_lead_updates','visit_slots','visit_slot_closures','visit_bookings','visit_booking_outcomes','admission_events'];
export const sources = ['site','whatsapp','indicacao','instagram','presencial','outro'];
export const interests = ['visita','matricula','informacoes'];
export const updateStatuses = ['em_contato','visitou','matriculado','desistiu'];
export const leadStatuses = ['novo','em_contato','visita_agendada','visitou','matriculado','desistiu'];
// Desfechos do atendimento: só uma anotação da equipe reabre; nada automático volta a situação.
const finalStatuses = ['matriculado','desistiu'];
export const outcomes = ['compareceu','nao_compareceu','cancelada'];
export const imageTypes = ['image/jpeg','image/png','image/webp'];
// Horários de visita são combinados no fuso da escola. Escolas fora deste fuso exigem especificação.
export const SCHOOL_TIME_ZONE = 'America/Sao_Paulo';

export function fail(statusCode) { const e = new Error('Erro de captação'); e.statusCode = statusCode; throw e; }
function administrator(user) { if (!['school_admin','platform_admin'].includes(user.role)) fail(403); }

const clean = v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const line = max => z.string().trim().min(1).max(max).refine(v => clean(v) && !/[\r\n]/.test(v));
const multiline = max => z.string().trim().min(1).max(max).refine(clean);
const optional = schema => z.preprocess(v => typeof v === 'string' && !v.trim() ? null : v,
  schema.nullable().optional().transform(v => v ?? null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return v >= '1900-01-01' && v <= '2200-12-31' && !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === v;
});
const phone = line(30).refine(v => /^[+\d().\s-]+$/.test(v) && (v.match(/\d/g) || []).length >= 10);
const email = z.string().trim().email().max(150).transform(v => v.toLowerCase());
const imageId = z.string().uuid().nullable().optional().transform(v => v ?? null);

// Conteúdo do site: só os blocos previstos, com limites de tamanho; nada de HTML ou script.
const pairs = (titleMax, textMax, max) => z.array(z.object({ title: line(titleMax), text: optional(multiline(textMax)) }).strict()).max(max).default([]);
export const contentSchema = z.object({
  hero: z.object({ title: line(120), subtitle: optional(multiline(400)), image_id: imageId }).strict(),
  about: z.object({ title: line(120), text: optional(multiline(3000)) }).strict(),
  highlights: pairs(80, 400, 8),
  routine: pairs(80, 600, 12),
  levels: z.array(z.object({ name: line(80), ages: optional(line(60)), shifts: optional(line(80)),
    description: optional(multiline(600)) }).strict()).max(12).default([]),
  uniform: z.object({ intro: optional(multiline(1000)), where_to_buy: optional(multiline(400)),
    items: z.array(z.object({ name: line(80), description: optional(multiline(400)), price: optional(line(30)),
      required: z.boolean(), image_id: imageId }).strict()).max(24).default([]) }).strict(),
  faq: z.array(z.object({ question: line(200), answer: multiline(1500) }).strict()).max(40).default([]),
  location: z.object({ address: optional(multiline(300)), opening_hours: optional(line(160)) }).strict(),
  contact: z.object({ whatsapp: optional(phone), email: optional(email), instagram: optional(line(60)) }).strict(),
  enrollment: z.object({ open: z.boolean(), year: z.number().int().min(2000).max(2100).nullable().optional()
    .transform(v => v ?? null), intro: optional(multiline(600)) }).strict()
}).strict();

export function imageIds(content) {
  return [...new Set([content.hero.image_id, ...content.uniform.items.map(i => i.image_id)].filter(Boolean))];
}

const leadFields = {
  guardian_name: line(150), guardian_phone: phone, guardian_email: optional(email),
  child_name: line(150), child_birth_date: optional(date), desired_level: optional(line(80)),
  how_heard: optional(line(120)), message: optional(multiline(1000)), interest: z.enum(interests)
};
// Pré-matrícula enviada pelo site: consentimento obrigatório e campo-isca vazio.
export const publicLeadSchema = z.object({ ...leadFields, slot_id: z.string().uuid().nullable().optional()
  .transform(v => v ?? null), consent: z.literal(true), website: z.literal('').optional() }).strict();

export const resources = {
  'site-address': z.object({ slug: z.string().trim().toLowerCase().min(3).max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) }).strict(),
  'site-versions': z.object({ published: z.boolean(), content: contentSchema }).strict(),
  leads: z.object({ ...leadFields, source: z.enum(sources.filter(s => s !== 'site')), consent: z.literal(true) }).strict(),
  'lead-updates': z.object({ lead_id: z.string().uuid(), status: z.enum(updateStatuses).nullable().optional()
    .transform(v => v ?? null), note: optional(multiline(1000)) }).strict().refine(v => v.status || v.note),
  'visit-slots': z.object({ date, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    capacity: z.number().int().min(1).max(20) }).strict(),
  'visit-slot-closures': z.object({ slot_id: z.string().uuid() }).strict(),
  'visit-bookings': z.object({ lead_id: z.string().uuid(), slot_id: z.string().uuid() }).strict(),
  'visit-outcomes': z.object({ booking_id: z.string().uuid(), outcome: z.enum(outcomes) }).strict()
};

export const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const lock = (client, parts) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [parts]);
// Chave compartilhada com site_public.submit_lead: a capacidade do horário vale para a equipe e para o site.
const slotLock = (client, slotId) => lock(client, `visit-slot:${slotId}`);

const activeBookings = `(SELECT count(*) FROM public.visit_bookings b
  WHERE b.school_id=vs.school_id AND b.slot_id=vs.id AND NOT EXISTS (SELECT 1 FROM public.visit_booking_outcomes o
    WHERE o.school_id=b.school_id AND o.booking_id=b.id AND o.outcome='cancelada'))::int`;

// Situação derivada do histórico: final registrada > visita ativa > última situação > novo.
const leadProjection = `l.id,l.school_id,l.protocol,l.source,l.interest,l.guardian_name,l.guardian_phone,l.guardian_email,
  l.child_name,l.child_birth_date::text AS child_birth_date,l.desired_level,l.how_heard,l.message,l.consent_at,l.created_at,
  CASE WHEN st.status IN ('matriculado','desistiu') THEN st.status
    WHEN nb.id IS NOT NULL THEN 'visita_agendada' ELSE COALESCE(st.status,'novo') END AS status,
  nb.id AS active_booking_id, nb.starts_at AS next_visit_at`;
const leadJoins = `FROM public.admission_leads l
  LEFT JOIN LATERAL (SELECT u.status FROM public.admission_lead_updates u
    WHERE u.school_id=l.school_id AND u.lead_id=l.id AND u.status IS NOT NULL ORDER BY u.created_at DESC,u.id DESC LIMIT 1) st ON true
  LEFT JOIN LATERAL (SELECT b.id,vs.starts_at FROM public.visit_bookings b
    JOIN public.visit_slots vs ON vs.school_id=b.school_id AND vs.id=b.slot_id
    WHERE b.school_id=l.school_id AND b.lead_id=l.id AND NOT EXISTS (SELECT 1 FROM public.visit_booking_outcomes o
      WHERE o.school_id=b.school_id AND o.booking_id=b.id) ORDER BY b.created_at DESC LIMIT 1) nb ON true`;

async function findLead(client, user, id) {
  const { rows:[lead] } = await client.query(`SELECT ${leadProjection} ${leadJoins} WHERE l.school_id=$1 AND l.id=$2`,
    [user.school_id, id]);
  return lead;
}

export async function listLeads(client, user, page, status) {
  administrator(user);
  const { rows } = await client.query(`SELECT * FROM (SELECT ${leadProjection} ${leadJoins} WHERE l.school_id=$1) x
    WHERE $3::text IS NULL OR x.status=$3 ORDER BY x.created_at DESC,x.id DESC LIMIT 101 OFFSET $2`,
  [user.school_id, (page-1)*100, status]);
  const { rows: counts } = await client.query(`SELECT status, count(*)::int AS count
    FROM (SELECT ${leadProjection} ${leadJoins} WHERE l.school_id=$1) x GROUP BY status`, [user.school_id]);
  return { items: rows.slice(0,100), page, has_more: rows.length>100,
    counts: Object.fromEntries(leadStatuses.map(s => [s, counts.find(c => c.status===s)?.count ?? 0])) };
}

export async function leadDetail(client, user, id) {
  administrator(user);
  const lead = await findLead(client, user, id);
  if (!lead) fail(404);
  const { rows: updates } = await client.query(`SELECT u.id,u.status,u.note,u.created_at,us.name AS author_name
    FROM public.admission_lead_updates u
    LEFT JOIN public.admission_events e ON e.school_id=u.school_id AND e.entity_id=u.id AND e.operation='lead-updates'
    LEFT JOIN public.users us ON us.school_id=e.school_id AND us.id=e.user_id
    WHERE u.school_id=$1 AND u.lead_id=$2 ORDER BY u.created_at,u.id`, [user.school_id, id]);
  const { rows: bookings } = await client.query(`SELECT b.id,b.slot_id,vs.starts_at,o.outcome,b.created_at
    FROM public.visit_bookings b JOIN public.visit_slots vs ON vs.school_id=b.school_id AND vs.id=b.slot_id
    LEFT JOIN public.visit_booking_outcomes o ON o.school_id=b.school_id AND o.booking_id=b.id
    WHERE b.school_id=$1 AND b.lead_id=$2 ORDER BY b.created_at DESC`, [user.school_id, id]);
  return { item: { ...lead, updates, bookings } };
}

export async function listSlots(client, user, page) {
  administrator(user);
  const { rows } = await client.query(`SELECT vs.id,vs.school_id,vs.starts_at,vs.capacity,
      EXISTS (SELECT 1 FROM public.visit_slot_closures c WHERE c.school_id=vs.school_id AND c.slot_id=vs.id) AS closed,
      COALESCE((SELECT json_agg(json_build_object('booking_id',b.id,'lead_id',l.id,'protocol',l.protocol,
        'child_name',l.child_name,'guardian_name',l.guardian_name,'guardian_phone',l.guardian_phone,'outcome',o.outcome)
        ORDER BY b.created_at)
        FROM public.visit_bookings b JOIN public.admission_leads l ON l.school_id=b.school_id AND l.id=b.lead_id
        LEFT JOIN public.visit_booking_outcomes o ON o.school_id=b.school_id AND o.booking_id=b.id
        WHERE b.school_id=vs.school_id AND b.slot_id=vs.id AND (o.outcome IS NULL OR o.outcome<>'cancelada')),'[]') AS bookings
    FROM public.visit_slots vs WHERE vs.school_id=$1 AND vs.starts_at >= now() - interval '1 day'
    ORDER BY vs.starts_at,vs.id LIMIT 101 OFFSET $2`, [user.school_id, (page-1)*100]);
  return { items: rows.slice(0,100), page, has_more: rows.length>100 };
}

export async function siteState(client, user) {
  administrator(user);
  const { rows:[address] } = await client.query('SELECT slug,created_at FROM public.school_site_addresses WHERE school_id=$1',
    [user.school_id]);
  const { rows:[current] } = await client.query(`SELECT id,content,published,created_at FROM public.school_site_versions
    WHERE school_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [user.school_id]);
  const { rows: images } = await client.query(`SELECT id,content_type,octet_length(data) AS size,created_at
    FROM public.site_images WHERE school_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200`, [user.school_id]);
  return { address: address ?? null, current: current ?? null, images };
}

export async function siteImage(client, user, id) {
  administrator(user);
  const { rows:[image] } = await client.query('SELECT content_type,data FROM public.site_images WHERE school_id=$1 AND id=$2',
    [user.school_id, id]);
  if (!image) fail(404);
  return image;
}

// Assinaturas dos formatos aceitos: o tipo declarado precisa coincidir com o conteúdo.
export function sniffImage(buffer) {
  if (buffer.length >= 3 && buffer[0]===0xff && buffer[1]===0xd8 && buffer[2]===0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0,4).toString('latin1')==='RIFF' && buffer.subarray(8,12).toString('latin1')==='WEBP') return 'image/webp';
  return null;
}

const finders = {
  'site-address': async (client, user) => (await client.query(
    'SELECT school_id AS id,slug,created_at FROM public.school_site_addresses WHERE school_id=$1', [user.school_id])).rows[0],
  'site-versions': async (client, user, id) => (await client.query(
    'SELECT id,content,published,created_at FROM public.school_site_versions WHERE school_id=$1 AND id=$2', [user.school_id, id])).rows[0],
  'site-images': async (client, user, id) => (await client.query(
    'SELECT id,content_type,octet_length(data) AS size,created_at FROM public.site_images WHERE school_id=$1 AND id=$2', [user.school_id, id])).rows[0],
  leads: findLead,
  'lead-updates': async (client, user, id) => (await client.query(
    'SELECT id,lead_id,status,note,created_at FROM public.admission_lead_updates WHERE school_id=$1 AND id=$2', [user.school_id, id])).rows[0],
  'visit-slots': async (client, user, id) => (await client.query(
    'SELECT id,school_id,starts_at,capacity,created_at FROM public.visit_slots WHERE school_id=$1 AND id=$2', [user.school_id, id])).rows[0],
  'visit-slot-closures': async (client, user, id) => (await client.query(
    'SELECT id,slot_id,created_at FROM public.visit_slot_closures WHERE school_id=$1 AND id=$2', [user.school_id, id])).rows[0],
  'visit-bookings': async (client, user, id) => (await client.query(`SELECT b.id,b.lead_id,b.slot_id,vs.starts_at,b.created_at
    FROM public.visit_bookings b JOIN public.visit_slots vs ON vs.school_id=b.school_id AND vs.id=b.slot_id
    WHERE b.school_id=$1 AND b.id=$2`, [user.school_id, id])).rows[0],
  'visit-outcomes': async (client, user, id) => (await client.query(
    'SELECT id,booking_id,outcome,created_at FROM public.visit_booking_outcomes WHERE school_id=$1 AND id=$2', [user.school_id, id])).rows[0]
};

async function openSlot(client, user, slotId) {
  const { rows:[slot] } = await client.query(`SELECT vs.id,vs.capacity,${activeBookings} AS taken FROM public.visit_slots vs
    WHERE vs.school_id=$1 AND vs.id=$2 AND vs.starts_at > now()
      AND NOT EXISTS (SELECT 1 FROM public.visit_slot_closures c WHERE c.school_id=vs.school_id AND c.slot_id=vs.id)`,
  [user.school_id, slotId]);
  if (!slot) fail(404);
  if (slot.taken >= slot.capacity) fail(409);
}

const PROTOCOL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const protocol = () => `PM-${Array.from({ length: 6 }, () => PROTOCOL_ALPHABET[randomInt(PROTOCOL_ALPHABET.length)]).join('')}`;

const inserts = {
  async 'site-address'(client, user, data) {
    const { rows:[item] } = await client.query(`INSERT INTO public.school_site_addresses(school_id,slug) VALUES($1,$2)
      RETURNING school_id AS id`, [user.school_id, data.slug]);
    return item.id;
  },
  async 'site-versions'(client, user, data) {
    const { rowCount } = await client.query('SELECT 1 FROM public.school_site_addresses WHERE school_id=$1', [user.school_id]);
    if (!rowCount) fail(409);
    const ids = imageIds(data.content);
    if (ids.length) {
      const { rows } = await client.query('SELECT id FROM public.site_images WHERE school_id=$1 AND id=ANY($2::uuid[])',
        [user.school_id, ids]);
      if (rows.length !== ids.length) fail(404);
    }
    const { rows:[item] } = await client.query(`INSERT INTO public.school_site_versions(school_id,content,published)
      VALUES($1,$2,$3) RETURNING id`, [user.school_id, data.content, data.published]);
    return item.id;
  },
  async 'site-images'(client, user, data) {
    const { rows:[item] } = await client.query(`INSERT INTO public.site_images(school_id,content_type,data)
      VALUES($1,$2,$3) RETURNING id`, [user.school_id, data.content_type, data.bytes]);
    return item.id;
  },
  async leads(client, user, data) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { rows:[item] } = await client.query(`INSERT INTO public.admission_leads(school_id,protocol,source,interest,
        guardian_name,guardian_phone,guardian_email,child_name,child_birth_date,desired_level,how_heard,message,consent_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) ON CONFLICT (school_id,protocol) DO NOTHING RETURNING id`,
      [user.school_id, protocol(), data.source, data.interest, data.guardian_name, data.guardian_phone, data.guardian_email,
        data.child_name, data.child_birth_date, data.desired_level, data.how_heard, data.message]);
      if (item) return item.id;
    }
    throw new Error('Protocolo indisponivel');
  },
  async 'lead-updates'(client, user, data) {
    if (!(await findLead(client, user, data.lead_id))) fail(404);
    const { rows:[item] } = await client.query(`INSERT INTO public.admission_lead_updates(school_id,lead_id,status,note)
      VALUES($1,$2,$3,$4) RETURNING id`, [user.school_id, data.lead_id, data.status, data.note]);
    return item.id;
  },
  async 'visit-slots'(client, user, data) {
    const { rows:[item] } = await client.query(`INSERT INTO public.visit_slots(school_id,starts_at,capacity)
      SELECT $1,($2::date + $3::time) AT TIME ZONE $5,$4 WHERE ($2::date + $3::time) AT TIME ZONE $5 > now()
      RETURNING id`, [user.school_id, data.date, data.time, data.capacity, SCHOOL_TIME_ZONE]);
    if (!item) fail(400);
    return item.id;
  },
  async 'visit-slot-closures'(client, user, data) {
    await slotLock(client, data.slot_id);
    const { rows:[slot] } = await client.query(`SELECT ${activeBookings} AS taken FROM public.visit_slots vs
      WHERE vs.school_id=$1 AND vs.id=$2`, [user.school_id, data.slot_id]);
    if (!slot) fail(404);
    // Reservas pendentes (sem resultado) precisam ser remarcadas ou canceladas antes do fechamento.
    const { rowCount: pending } = await client.query(`SELECT 1 FROM public.visit_bookings b WHERE b.school_id=$1 AND b.slot_id=$2
      AND NOT EXISTS (SELECT 1 FROM public.visit_booking_outcomes o WHERE o.school_id=b.school_id AND o.booking_id=b.id)`,
    [user.school_id, data.slot_id]);
    if (pending) fail(409);
    const { rows:[item] } = await client.query(`INSERT INTO public.visit_slot_closures(school_id,slot_id) VALUES($1,$2)
      RETURNING id`, [user.school_id, data.slot_id]);
    return item.id;
  },
  async 'visit-bookings'(client, user, data) {
    await lock(client, `lead-booking:${data.lead_id}`);
    const lead = await findLead(client, user, data.lead_id);
    if (!lead) fail(404);
    if (finalStatuses.includes(lead.status)) fail(409);
    await slotLock(client, data.slot_id);
    await openSlot(client, user, data.slot_id);
    // Reagendar cancela a visita pendente anterior; o histórico permanece.
    if (lead.active_booking_id) {
      await client.query(`INSERT INTO public.visit_booking_outcomes(school_id,booking_id,outcome) VALUES($1,$2,'cancelada')`,
        [user.school_id, lead.active_booking_id]);
    }
    const { rows:[item] } = await client.query(`INSERT INTO public.visit_bookings(school_id,lead_id,slot_id) VALUES($1,$2,$3)
      RETURNING id`, [user.school_id, data.lead_id, data.slot_id]);
    return item.id;
  },
  async 'visit-outcomes'(client, user, data) {
    const { rows:[booking] } = await client.query('SELECT lead_id FROM public.visit_bookings WHERE school_id=$1 AND id=$2',
      [user.school_id, data.booking_id]);
    if (!booking) fail(404);
    await lock(client, `lead-booking:${booking.lead_id}`);
    const lead = await findLead(client, user, booking.lead_id);
    const { rows:[item] } = await client.query(`INSERT INTO public.visit_booking_outcomes(school_id,booking_id,outcome)
      VALUES($1,$2,$3) RETURNING id`, [user.school_id, data.booking_id, data.outcome]);
    // O comparecimento fica no histórico da visita, mas não desfaz matrícula ou desistência já registradas.
    if (data.outcome === 'compareceu' && !finalStatuses.includes(lead.status)) {
      await client.query(`INSERT INTO public.admission_lead_updates(school_id,lead_id,status) VALUES($1,$2,'visitou')`,
        [user.school_id, booking.lead_id]);
    }
    return item.id;
  }
};

export async function create(client, user, operation, data, key) {
  administrator(user);
  const payloadHash = hash(operation === 'site-images' ? { content_type: data.content_type, sha256: data.sha256 } : data);
  await lock(client, JSON.stringify(['admissions', user.school_id, user.id, operation, key]));
  const { rows:[previous] } = await client.query(`SELECT payload_hash,entity_id FROM public.admission_events
    WHERE school_id=$1 AND user_id=$2 AND operation=$3 AND request_key=$4`, [user.school_id, user.id, operation, key]);
  if (previous) {
    if (previous.payload_hash !== payloadHash) fail(409);
    const item = await finders[operation](client, user, previous.entity_id);
    if (!item) fail(404);
    return { item, replayed: true };
  }
  const id = await inserts[operation](client, user, data);
  // Auditoria por referência e hash, sem duplicar dados pessoais.
  await client.query(`INSERT INTO public.admission_events(school_id,user_id,operation,request_key,payload_hash,entity_id)
    VALUES($1,$2,$3,$4,$5,$6)`, [user.school_id, user.id, operation, key, payloadHash, id]);
  return { item: await finders[operation](client, user, id), replayed: false };
}
