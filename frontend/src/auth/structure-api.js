export async function structureRequest(token, path, options = {}) {
  let response;
  try {
    response = await fetch(`/api/structure/${path}`, { ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
      signal: options.signal || AbortSignal.timeout(15000) });
  } catch { throw new Error('Não foi possível conectar. Tente novamente; o reenvio não duplica o cadastro.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const messages = { 400: 'Confira os campos. Códigos aceitam letras, números, hífen e sublinhado.',
      401: 'Sessão expirada. Entre novamente.', 403: 'Seu perfil não pode realizar esta operação.',
      404: 'Uma referência não está disponível para sua escola.', 409: 'Já existe um cadastro com esse código, ou o reenvio conflita com a solicitação anterior.' };
    const error = new Error(messages[response.status] || 'Não foi possível concluir a operação. Tente novamente.');
    error.status = response.status; throw error;
  }
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida do servidor.');
  return data;
}
