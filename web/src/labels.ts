export const ROLE_LABELS: Record<string, string> = {
  school_admin: 'Administração',
  director: 'Direção',
  secretary: 'Secretaria',
  finance: 'Financeiro',
  coordinator: 'Coordenação',
  teacher: 'Professor(a)',
};

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguardando responsável',
  submitted: 'Para analisar',
  changes_requested: 'Correção solicitada',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

export const RELATIONSHIP_LABELS: Record<string, string> = {
  mother: 'Mãe',
  father: 'Pai',
  grandparent: 'Avó/Avô',
  uncle_aunt: 'Tia/Tio',
  sibling: 'Irmã/Irmão',
  legal_guardian: 'Responsável legal',
  other: 'Outro',
};

export const FIELD_LABELS: Record<string, string> = {
  full_name: 'Nome completo',
  social_name: 'Nome social',
  cpf: 'CPF',
  address: 'Endereço',
  health_notes: 'Saúde e alergias',
  phone: 'Telefone',
  email: 'E-mail',
};

export const SHIFT_LABELS: Record<string, string> = {
  morning: 'Manhã',
  afternoon: 'Tarde',
  evening: 'Noite',
  full_time: 'Integral',
};

export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatPhone(value: string | null | undefined) {
  if (!value) return '—';
  const match = value.match(/^(\d{2})(\d{4,5})(\d{4})$/);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : value;
}

export type Address = {
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  zip_code?: string;
};

export function formatAddress(address: Address | null | undefined) {
  if (!address || !Object.values(address).some(Boolean)) return '—';
  const line = [address.street, address.number].filter(Boolean).join(', ');
  return [line, address.complement, address.district, address.city && `${address.city}${address.state ? `/${address.state}` : ''}`, address.zip_code]
    .filter(Boolean)
    .join(' · ');
}

export function formatValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'address') return formatAddress(value as Address);
  if (field === 'phone') return formatPhone(String(value));
  return String(value);
}
