const staffMessages = { 400: 'Confira os campos: nascimento, telefone e, para aprovar, turma e série/grupo precisam ser válidos. Correção e recusa exigem motivo.',
  401: 'Sessão expirada. Entre novamente.', 403: 'Seu perfil não pode realizar esta operação.',
  404: 'Ficha, interessado, turma ou série/grupo não está disponível na sua escola.',
  409: 'Não foi possível concluir: a ficha já foi analisada ou encerrada, o interessado já tem matrícula online, ou o reenvio conflita com a solicitação anterior.' };

export async function onlineEnrollmentRequest(token, path, options = {}) {
  let response;
  try {
    response = await fetch(`/api/online-enrollments/${path}`, { ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
      signal: options.signal || AbortSignal.timeout(20000) });
  } catch { throw new Error('Não foi possível conectar. Tente novamente; o reenvio não duplica o registro.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(staffMessages[response.status] || 'Não foi possível concluir a operação. Tente novamente.');
    error.status = response.status; throw error;
  }
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida do servidor.');
  return data;
}

// Área da família: sem credencial; o link e a data de nascimento vão no corpo, nunca na URL da API.
export async function familyRequest(path, body, options = {}) {
  let response;
  try {
    response = await fetch(`/api/family/enrollments/${path}`, { method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...options.headers }, signal: options.signal || AbortSignal.timeout(20000) });
  } catch { throw new Error('Sem conexão no momento. Tente de novo: o reenvio não duplica sua ficha.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const reasons = { settings_changed: 'A escola atualizou o formulário. Recarregue a página para ver os campos novos.',
      closed: 'Esta ficha já foi enviada e está com a escola.', conflict: 'Este envio já foi registrado com outros dados. Recarregue a página.' };
    const messages = { 400: 'Confira os campos destacados: CPF válido, responsável financeiro e os itens que a escola exige.',
      401: 'Não conseguimos confirmar. Verifique a data de nascimento ou peça um novo link à escola.',
      409: reasons[data?.reason] || 'Não foi possível enviar agora.',
      429: 'O link foi bloqueado após várias tentativas. Peça um novo link à escola pelo WhatsApp.' };
    const error = new Error(messages[response.status] || 'Não foi possível concluir agora. Tente novamente.');
    error.status = response.status; error.reason = data?.reason; throw error;
  }
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida do servidor.');
  return data;
}
