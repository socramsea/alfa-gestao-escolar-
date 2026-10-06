// Renovação de matrícula (entrega 10, ADR-009). Esqueleto: as tabelas existem e as rotas respondem 501.
export const reenrollmentTables = ['reenrollment_campaigns','reenrollments','reenrollment_links','reenrollment_link_revocations',
  'reenrollment_access_attempts','reenrollment_document_requests','reenrollment_submissions','reenrollment_reviews',
  'reenrollment_events'];
export const UNDER_CONSTRUCTION = 'Renovação de matrícula em construção (entrega 10).';
export const notYet = (_req, res) => res.status(501).json({ error: UNDER_CONSTRUCTION });
