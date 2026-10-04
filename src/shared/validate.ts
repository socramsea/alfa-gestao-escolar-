import type { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw badRequest(
      'Dados inválidos',
      result.error.issues.map((issue) => ({ campo: issue.path.join('.'), mensagem: issue.message })),
    );
  }

  return result.data;
}
