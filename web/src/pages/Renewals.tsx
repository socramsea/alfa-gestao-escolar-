import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorAlert, Loading, Modal, StatusBadge } from '../components/ui';
import { useLoad } from '../hooks';
import { STATUS_LABELS, formatDate, formatDateTime, formatPhone } from '../labels';

type Campaign = {
  id: string;
  title: string;
  kind: 'renewal' | 'admission';
  unit_name: string | null;
  status: 'draft' | 'open' | 'closed';
  starts_on: string;
  ends_on: string;
  year: number;
  total: number;
  pending: number;
  submitted: number;
  changes_requested: number;
  approved: number;
  rejected: number;
};

type RenewalRow = {
  id: string;
  status: string;
  student_name: string;
  current_class_name: string | null;
  target_class_name: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  submitted_at: string | null;
  reminder_whatsapp_url: string | null;
};

const TABS = ['submitted', 'pending', 'changes_requested', 'approved', 'rejected'] as const;

export function Renewals() {
  const { api, can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'submitted';
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const campaigns = useLoad(() => api<{ data: Campaign[] }>('/api/renewal-campaigns').then((r) => r.data), [api]);
  const campaignId = params.get('campanha') ?? campaigns.data?.find((c) => c.status === 'open')?.id ?? campaigns.data?.[0]?.id;
  const campaign = campaigns.data?.find((c) => c.id === campaignId);

  const requests = useLoad(
    () =>
      campaignId
        ? api<{ data: RenewalRow[] }>(
            `/api/renewal-requests?campaign_id=${campaignId}&status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
          ).then((r) => r.data)
        : Promise.resolve([]),
    [api, campaignId, status, search],
  );

  const changeCampaign = async (action: 'open' | 'close' | 'sync') => {
    if (!campaign) return;
    if (action === 'close' && !confirm('Encerrar o período? Os responsáveis não poderão mais enviar dados.')) return;
    setActionError(null);
    try {
      await api(`/api/renewal-campaigns/${campaign.id}/${action}`, { method: 'POST' });
      await Promise.all([campaigns.reload(), requests.reload()]);
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  };

  const setTab = (tab: string) => {
    const next = new URLSearchParams(params);
    next.set('status', tab);
    setParams(next, { replace: true });
  };

  if (campaigns.loading && !campaigns.data) return <Loading />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{campaign?.kind === 'admission' ? 'Matrícula de novos alunos' : 'Renovação de matrícula'}</h1>
          {campaign && (
            <p className="muted">
              {campaign.title} · {campaign.unit_name ?? 'Todas as unidades'} · {formatDate(campaign.starts_on)} a{' '}
              {formatDate(campaign.ends_on)} ·{' '}
              {campaign.status === 'open' ? 'Aberta' : campaign.status === 'draft' ? 'Rascunho' : 'Encerrada'}
            </p>
          )}
        </div>
        {can('renewals:manage') && (
          <div className="actions">
            {campaigns.data && campaigns.data.length > 1 && (
              <select
                value={campaignId}
                onChange={(event) => setParams({ campanha: event.target.value, status }, { replace: true })}
                aria-label="Campanha"
                style={{ width: 'auto' }}
              >
                {campaigns.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.kind === 'admission' ? 'Novos · ' : 'Renovação · '}
                    {item.title}
                  </option>
                ))}
              </select>
            )}
            {campaign?.status === 'draft' && (
              <button className="btn btn-primary" onClick={() => changeCampaign('open')}>
                Abrir para os responsáveis
              </button>
            )}
            {campaign?.status === 'open' && (
              <>
                {campaign.kind === 'renewal' && <button className="btn" onClick={() => changeCampaign('sync')} title="Inclui alunos cadastrados depois da abertura">
                  Incluir novos alunos
                </button>}
                <button className="btn btn-danger" onClick={() => changeCampaign('close')}>
                  Encerrar
                </button>
              </>
            )}
            <button className="btn" onClick={() => setCreating(true)}>
              Novo período
            </button>
          </div>
        )}
      </div>

      <ErrorAlert message={campaigns.error ?? actionError} />

      {!campaign && (
        <div className="card empty">
          <p>Nenhum período de matrícula ou renovação criado.</p>
          {can('renewals:manage') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Criar período
            </button>
          )}
        </div>
      )}

      {campaign && (
        <div className="card">
          <div className="tabs" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={status === tab}
                className={`tab ${status === tab ? 'active' : ''}`}
                onClick={() => setTab(tab)}
              >
                {STATUS_LABELS[tab]}
                <span className="count">{campaign[tab]}</span>
              </button>
            ))}
          </div>

          <div className="field" style={{ maxWidth: 320 }}>
            <input placeholder="Buscar aluno…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Buscar aluno" />
          </div>

          <ErrorAlert message={requests.error} />
          {requests.loading && !requests.data ? (
            <Loading />
          ) : requests.data?.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Turma atual</th>
                  <th>Responsável</th>
                  <th>{status === 'pending' ? 'Contato' : 'Enviado em'}</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {requests.data.map((row) => (
                  <tr key={row.id} className="clickable" onClick={() => navigate(`/app/renovacao/${row.id}`)}>
                    <td data-label="Aluno">
                      <strong>{row.student_name}</strong>
                    </td>
                    <td data-label="Turma atual">{row.current_class_name ?? '—'}</td>
                    <td data-label="Responsável">{row.guardian_name ?? '—'}</td>
                    <td data-label={status === 'pending' ? 'Contato' : 'Enviado em'}>
                      {row.reminder_whatsapp_url ? (
                        <a
                          className="btn btn-whatsapp btn-small"
                          href={row.reminder_whatsapp_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          title={formatPhone(row.guardian_phone)}
                        >
                          Lembrar no WhatsApp
                        </a>
                      ) : (
                        formatDateTime(row.submitted_at)
                      )}
                    </td>
                    <td data-label="Situação">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Nenhum aluno nesta situação.</div>
          )}
        </div>
      )}

      {creating && (
        <NewCampaignModal
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await campaigns.reload();
            setParams({ campanha: id, status: 'pending' }, { replace: true });
          }}
        />
      )}
    </>
  );
}

function NewCampaignModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { api } = useAuth();
  const years = useLoad(() => api<{ data: { id: string; year: number }[] }>('/api/school-years').then((r) => r.data), [api]);
  const units = useLoad(() => api<{ data: { id: string; name: string }[] }>('/api/units').then((r) => r.data), [api]);
  const [form, setForm] = useState({ kind: 'renewal', unit_id: '', school_year_id: '', title: '', starts_on: '', ends_on: '' });
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const yearId = form.school_year_id || years.data?.[0]?.id;
      const year = years.data?.find((item) => item.id === yearId)?.year;
      const created = await api<{ id: string }>('/api/renewal-campaigns', {
        method: 'POST',
        body: {
          ...form,
          unit_id: form.unit_id || null,
          school_year_id: yearId,
          title: form.title || `${form.kind === 'admission' ? 'Matrícula' : 'Renovação de Matrícula'} ${year}`,
        },
      });
      onCreated(created.id);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Modal title="Novo período" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorAlert message={error ?? years.error} />
        <div className="form-row">
          <div className="field">
            <label htmlFor="kind">Tipo</label>
            <select id="kind" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              <option value="renewal">Renovação (alunos atuais)</option>
              <option value="admission">Matrícula de novos alunos</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="unit">Unidade</label>
            <select id="unit" value={form.unit_id} onChange={(event) => setForm({ ...form, unit_id: event.target.value })}>
              <option value="">Todas as unidades</option>
              {units.data?.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="year">Ano letivo de destino</label>
          <select id="year" value={form.school_year_id} onChange={(event) => setForm({ ...form, school_year_id: event.target.value })}>
            {years.data?.map((year) => (
              <option key={year.id} value={year.id}>
                {year.year}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="title">Título</label>
          <input id="title" placeholder="Renovação de Matrícula" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="starts">Início</label>
            <input id="starts" type="date" required value={form.starts_on} onChange={(event) => setForm({ ...form, starts_on: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ends">Fim</label>
            <input id="ends" type="date" required value={form.ends_on} onChange={(event) => setForm({ ...form, ends_on: event.target.value })} />
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-primary">Criar</button>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
