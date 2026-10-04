export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, message, details);
export const unauthorized = (message = 'Token ausente ou inválido') => new AppError(401, message);
export const forbidden = (message = 'Permissão insuficiente') => new AppError(403, message);
export const notFound = (message = 'Registro não encontrado') => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);
