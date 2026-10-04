import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorAlert, Loading } from '../components/ui';
import { useLoad } from '../hooks';
import { type Address, formatAddress, formatPhone } from '../labels';

type Unit = {
  id: string;
  name: string;
  slug: string;
  address: Address;
  whatsapp: string | null;
  opening_hours: string | null;
  accepting_enrollments: boolean;
  active: boolean;
  active_students: number;
};

export function Units() {
  const { api, can } = useAuth();
  const units = useLoad(() => api<{ data: Unit[] }>('/api/units').then((r) => r.data), [api]);
  const [error, setError] = useState<string | null>(null);
  const manage = can('units:manage');

  const toggle = async (unit: Unit) => {
    setError(null);
    try {
      await api(`/api/units/${unit.id}`, { method: 'PATCH', body: { accepting_enrollments: !unit.accepting_enrollments } });
      units.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  if (units.loading && !units.data) return <Loading />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Unidades</h1>
          <p className="muted">Todas as unidades usam o mesmo sistema: o que funciona em uma vale para as outras.</p>
        </div>
      </div>
      <ErrorAlert message={error ?? units.error} />
      <div className="grid grid-2">
        {units.data?.map((unit) => (
          <div className="card" key={unit.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h2>{unit.name}</h2>
              <span className={`badge ${unit.accepting_enrollments ? 'badge-approved' : 'badge-pending'}`}>
                {unit.accepting_enrollments ? 'Recebendo matrículas' : 'Matrículas fechadas'}
              </span>
            </div>
            <dl className="dl">
              <dt>Endereço</dt>
              <dd>{formatAddress(unit.address)}</dd>
              <dt>WhatsApp</dt>
              <dd>{formatPhone(unit.whatsapp)}</dd>
              <dt>Horário</dt>
              <dd>{unit.opening_hours ?? '—'}</dd>
              <dt>Alunos ativos</dt>
              <dd>{unit.active_students}</dd>
            </dl>
            {manage && (
              <button className="btn btn-small" style={{ marginTop: '0.75rem' }} onClick={() => toggle(unit)}>
                {unit.accepting_enrollments ? 'Fechar matrículas no site' : 'Abrir matrículas no site'}
              </button>
            )}
          </div>
        ))}
      </div>
      {manage && <NewUnit onCreated={units.reload} />}
    </>
  );
}

function NewUnit({ onCreated }: { onCreated: () => void }) {
  const { api } = useAuth();
  const [form, setForm] = useState({ name: '', slug: '', whatsapp: '', street: '', number: '', district: '', city: '', state: '', opening_hours: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const { street, number, district, city, state, ...rest } = form;
    const address = Object.fromEntries(Object.entries({ street, number, district, city, state }).filter(([, value]) => value));
    try {
      await api('/api/units', {
        method: 'POST',
        body: { ...rest, whatsapp: rest.whatsapp || null, opening_hours: rest.opening_hours || null, address },
      });
      setForm({ name: '', slug: '', whatsapp: '', street: '', number: '', district: '', city: '', state: '', opening_hours: '' });
      onCreated();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <form className="card" style={{ marginTop: '1rem' }} onSubmit={submit}>
      <h2>Nova unidade</h2>
      <ErrorAlert message={error} />
      <div className="form-row">
        <div className="field">
          <label htmlFor="u-name">Nome</label>
          <input id="u-name" required value={form.name} onChange={set('name')} placeholder="Unidade Jardim" />
        </div>
        <div className="field">
          <label htmlFor="u-slug">Identificador</label>
          <input id="u-slug" required value={form.slug} onChange={set('slug')} placeholder="jardim" />
        </div>
        <div className="field">
          <label htmlFor="u-wa">WhatsApp</label>
          <input id="u-wa" value={form.whatsapp} onChange={set('whatsapp')} />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="u-street">Rua</label>
          <input id="u-street" value={form.street} onChange={set('street')} />
        </div>
        <div className="field">
          <label htmlFor="u-number">Número</label>
          <input id="u-number" value={form.number} onChange={set('number')} />
        </div>
        <div className="field">
          <label htmlFor="u-district">Bairro</label>
          <input id="u-district" value={form.district} onChange={set('district')} />
        </div>
        <div className="field">
          <label htmlFor="u-city">Cidade</label>
          <input id="u-city" value={form.city} onChange={set('city')} />
        </div>
        <div className="field">
          <label htmlFor="u-state">UF</label>
          <input id="u-state" maxLength={2} value={form.state} onChange={set('state')} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="u-hours">Horário de atendimento</label>
        <input id="u-hours" value={form.opening_hours} onChange={set('opening_hours')} placeholder="Segunda a sexta, 7h às 18h" />
      </div>
      <button className="btn btn-primary">Criar unidade</button>
    </form>
  );
}
