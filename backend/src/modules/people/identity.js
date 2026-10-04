// Identificação de pessoas da escola, comum à matrícula online e à importação de planilha.

export function validCpf(value) {
  const d = value.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = n => { let sum = 0; for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}
// Telefone comparável: só dígitos, sem o código do país.
export const phoneKey = v => { const d = v.replace(/\D/g, ''); return d.length > 11 && d.startsWith('55') ? d.slice(2) : d; };
// Nome comparável: sem acentos, maiúsculas ou espaços repetidos.
export const nameKey = v => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Travas por telefone e CPF, em ordem fixa, para que gravações simultâneas não dupliquem o responsável.
export function guardianLockKeys(schoolId, guardians) {
  const keys = guardians.flatMap(g => [...(g.phone ? [`guardian-phone:${schoolId}:${phoneKey(g.phone)}`] : []),
    ...(g.cpf ? [`guardian-cpf:${schoolId}:${g.cpf}`] : [])]);
  return [...new Set(keys)].sort();
}

// Reaproveita o responsável já cadastrado na escola. Mesmo CPF é a mesma pessoa; sem CPF divergente,
// mesmo nome e telefone também. Outro nome no mesmo telefone (a avó, por exemplo) é outra pessoa.
// O cadastro reaproveitado não é alterado: o runtime não faz UPDATE.
export async function guardianFor(client, user, g) {
  if (g.cpf) {
    const { rows:[same] } = await client.query('SELECT id FROM public.guardians WHERE school_id=$1 AND cpf=$2', [user.school_id, g.cpf]);
    if (same) return { id: same.id, created: false };
  }
  if (g.phone) {
    const { rows } = await client.query(`SELECT id,full_name,phone FROM public.guardians
      WHERE school_id=$1 AND right(regexp_replace(phone,'[^0-9]','','g'),8)=$2 AND ($3::text IS NULL OR cpf IS NULL)
      ORDER BY created_at,id`, [user.school_id, phoneKey(g.phone).slice(-8), g.cpf ?? null]);
    const same = rows.find(r => phoneKey(r.phone) === phoneKey(g.phone) && nameKey(r.full_name) === nameKey(g.full_name));
    if (same) return { id: same.id, created: false };
  }
  const { rows:[created] } = await client.query(`INSERT INTO public.guardians(school_id,full_name,phone,email,cpf)
    VALUES($1,$2,$3,$4,$5) RETURNING id`, [user.school_id, g.full_name, g.phone ?? null, g.email ?? null, g.cpf ?? null]);
  return { id: created.id, created: true };
}
