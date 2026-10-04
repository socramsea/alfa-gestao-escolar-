export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.type === 'entity.parse.failed' ? 400
    : err.type === 'entity.too.large' ? 413
    : [400, 401, 403, 404, 409, 429].includes(err.statusCode) ? err.statusCode : 500;
  const messages = { 400: 'Dados invalidos', 401: 'Identidade invalida ou acesso bloqueado',
    404: 'Registro nao encontrado', 409: 'Registro duplicado ou requisicao conflitante', 429: 'Muitas tentativas. Tente novamente mais tarde.',
    403: 'Permissao insuficiente', 413: 'Requisicao muito grande', 500: 'Erro interno do servidor' };
  if (status === 500) console.error('Falha interna na API');
  res.status(status).json({ error: messages[status] });
}
