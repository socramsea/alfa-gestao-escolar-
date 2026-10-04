import { z } from 'zod';

export const uuid = z.string().uuid('Identificador inválido');
export const idParams = z.object({ id: uuid });

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Data inválida');

export const phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ''))
  .refine((value) => value.length >= 10 && value.length <= 13, 'Telefone inválido');

export const cpf = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ''))
  .refine((value) => value.length === 11, 'CPF deve ter 11 dígitos');

export const address = z
  .object({
    street: z.string().trim().max(160).optional(),
    number: z.string().trim().max(20).optional(),
    complement: z.string().trim().max(80).optional(),
    district: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(2).optional(),
    zip_code: z.string().trim().max(9).optional(),
  })
  .strict();
