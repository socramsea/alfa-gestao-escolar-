// A API de notas devolve mensagens em português; quando há, elas aparecem como estão.
export async function assessmentsRequest(token, path, options = {}) {
  let response;
  try {
    response = await fetch(`/api/assessments${path}`, { ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
      signal: options.signal || AbortSignal.timeout(15000) });
  } catch { throw new Error('Não foi possível conectar. Tente novamente; o reenvio não grava a nota duas vezes.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const messages = { 400: 'Confira os dados informados.', 401: 'Sessão expirada. Entre novamente.',
      403: 'Seu perfil não pode lançar notas.', 404: 'Turma, avaliação ou tipo não está disponível na sua escola.',
      409: 'Outra pessoa alterou estes dados. Recarregue a turma e tente de novo.' };
    const server = typeof data?.error === 'string' && data.error.trim() && response.status !== 401 ? data.error : null;
    const error = new Error(server || messages[response.status] || 'Não foi possível concluir a operação. Tente novamente.');
    error.status = response.status; error.body = data; throw error;
  }
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida do servidor.');
  return data;
}

// Nota digitada com vírgula ou ponto, de 0 a 10, com até duas casas: devolve o número ou null se inválida.
export function parseScore(text) {
  const value = String(text ?? '').trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) return null;
  const score = Number(value);
  return score >= 0 && score <= 10 ? score : null;
}

// Monta o lote a enviar: notas novas e notas alteradas (correções, com o motivo). Campos vazios ficam de fora.
export function buildScores(students, assessmentId, typed, reason) {
  const scores = [], errors = [];
  for (const s of students) {
    const text = typed[s.student_id];
    if (text === undefined || String(text).trim() === '') continue;
    const score = parseScore(text);
    const current = s.scores.find(x => x.assessment_id === assessmentId);
    if (score === null) { errors.push(`${s.student_name}: a nota deve ser um número de 0 a 10, com até duas casas decimais.`); continue; }
    if (!current) scores.push({ student_id: s.student_id, score });
    else if (current.score !== score) scores.push({ student_id: s.student_id, score, corrects_id: current.student_assessment_id, reason: reason.trim() });
  }
  if (scores.some(s => s.corrects_id) && !reason.trim()) errors.push('Informe o motivo da correção das notas alteradas.');
  return { scores, errors };
}

export const civilDate = date => date?.split('-').reverse().join('/') || '';
// Notas com ao menos uma casa (8,0); pesos sem casas obrigatórias (2).
export const decimal = (value, min = 1) => value === null || value === undefined ? '—'
  : value.toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: 2 });
