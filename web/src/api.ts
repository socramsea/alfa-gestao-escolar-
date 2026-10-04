const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: { campo?: string; linha?: number; mensagem: string }[],
  ) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; token?: string | null };

export async function request<T>(path: string, { method = 'GET', body, token }: Options = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Erro inesperado', data.details);
  return data as T;
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const details = error.details?.map((detail) => detail.mensagem).join('; ');
    return details ? `${error.message}: ${details}` : error.message;
  }
  return 'Não foi possível conectar. Verifique sua internet e tente novamente.';
}
