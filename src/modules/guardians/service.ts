import { env } from '../../config/env.js';
import type { Db } from '../../shared/db.js';
import { notFound } from '../../shared/errors.js';
import { whatsAppLink } from '../../shared/whatsapp.js';
import { type Actor, recordAudit } from '../audit/service.js';
import { generateOpaqueToken, hashToken } from '../auth/tokens.js';

export type LinkPurpose = 'renewal' | 'admission';

/**
 * Gera o link pessoal do responsável. O token só existe nesta resposta; o banco
 * guarda apenas o hash. Links anteriores do mesmo responsável são revogados.
 */
export async function createAccessLink(
  db: Db,
  schoolId: string,
  guardianId: string,
  actor: Actor,
  purpose: LinkPurpose = 'renewal',
) {
  const { rows: guardians } = await db.query<{ full_name: string; phone: string | null; school_name: string }>(
    `SELECT g.full_name, g.phone, s.name AS school_name
       FROM guardians g JOIN schools s ON s.id = g.school_id
      WHERE g.id = $1 AND g.school_id = $2 AND g.deleted_at IS NULL`,
    [guardianId, schoolId],
  );
  const guardian = guardians[0];
  if (!guardian) throw notFound('Responsável não encontrado');

  const token = generateOpaqueToken();
  await db.query(
    `UPDATE guardian_access_links SET revoked_at = now()
      WHERE guardian_id = $1 AND school_id = $2 AND revoked_at IS NULL`,
    [guardianId, schoolId],
  );
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO guardian_access_links (school_id, guardian_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5)
     RETURNING expires_at`,
    [schoolId, guardianId, hashToken(token), env.PORTAL_LINK_TTL_DAYS, actor.type === 'user' ? actor.id : null],
  );

  await recordAudit(db, {
    schoolId,
    actor,
    action: 'guardian.access_link_created',
    entityType: 'guardian',
    entityId: guardianId,
    metadata: { purpose },
  });

  const url = `${env.PUBLIC_APP_URL}/r/${token}`;
  const firstName = guardian.full_name.split(' ')[0];
  const message =
    purpose === 'admission'
      ? `Olá, ${firstName}! Que alegria ter vocês na ${guardian.school_name}. ` +
        `Pelo link abaixo você completa a matrícula pelo celular, sem papel:\n${url}\n` +
        `Para entrar, confirme a data de nascimento da criança. O link é pessoal, não compartilhe.`
      : `Olá, ${firstName}! Aqui é da ${guardian.school_name}. ` +
        `Pelo link abaixo você confere e atualiza os dados de matrícula, sem precisar vir à escola nem preencher papel:\n${url}\n` +
        `Para entrar, confirme a data de nascimento do aluno. O link é pessoal, não compartilhe.`;

  return { url, expires_at: rows[0].expires_at, message, whatsapp_url: whatsAppLink(guardian.phone, message) };
}
