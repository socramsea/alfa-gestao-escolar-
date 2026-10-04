export const canAccessSecretaria = user => ['school_admin', 'platform_admin'].includes(user?.role);

export async function request(path, { token, ...options } = {}) {
  let response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error('Não foi possível conectar ao servidor. Tente novamente.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'Credenciais inválidas ou sessão expirada.' : 'Não foi possível autenticar. Tente novamente.');
    error.status = response.status;
    throw error;
  }
  if (!data?.user?.id || !data.user.school_id || !data.user.role) throw new Error('Resposta de autenticação inválida.');
  return data;
}

