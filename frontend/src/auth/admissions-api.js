const staffMessages = { 400: 'Confira os campos: datas, horários, telefone e textos precisam ser válidos.',
  401: 'Sessão expirada. Entre novamente.', 403: 'Seu perfil não pode realizar esta operação.',
  404: 'Registro, horário ou foto não está disponível na sua escola.',
  409: 'Não foi possível concluir: o código já está em uso, o horário já existe ou está lotado, o atendimento está encerrado, ou o reenvio conflita com a solicitação anterior.',
  413: 'A foto deve ter até 2 MB.' };

export async function admissionsRequest(token, path, options = {}) {
  let response;
  try {
    response = await fetch(`/api/admissions/${path}`, { ...options,
      headers: { ...(options.body instanceof Blob ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${token}`, ...options.headers },
      signal: options.signal || AbortSignal.timeout(20000) });
  } catch { throw new Error('Não foi possível conectar. Tente novamente; o reenvio não duplica o cadastro.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(staffMessages[response.status] || 'Não foi possível concluir a operação. Tente novamente.');
    error.status = response.status; throw error;
  }
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida do servidor.');
  return data;
}

// Site público: sem credencial; a escola vem somente do código na URL.
export async function publicSiteRequest(slug, path = '', options = {}) {
  let response;
  try {
    response = await fetch(`/api/public/sites/${encodeURIComponent(slug)}${path}`, { ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: options.signal || AbortSignal.timeout(20000) });
  } catch { throw new Error('Sem conexão no momento. Tente de novo: o reenvio não duplica sua pré-matrícula.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const messages = { 400: 'Confira os campos destacados: nome, WhatsApp com DDD e a autorização de contato.',
      404: 'Esta página não está disponível.',
      409: data?.reason === 'slot_unavailable' ? 'Este horário acabou de ser preenchido. Escolha outro horário.'
        : 'Este envio já foi registrado com outros dados. Recarregue a página e envie de novo.',
      429: 'Muitos envios a partir desta conexão. Tente mais tarde ou fale com a escola pelo WhatsApp.' };
    const error = new Error(messages[response.status] || 'Não foi possível enviar agora. Tente novamente.');
    error.status = response.status; throw error;
  }
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida do servidor.');
  return data;
}
