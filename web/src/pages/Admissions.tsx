import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorAlert, Loading, Modal } from '../components/ui';
import { useLoad } from '../hooks';
import { formatDate, formatDateTime, formatPhone } from '../labels';

export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'Novo contato',
  contacted: 'Em conversa',
  visit_scheduled: 'Visita agendada',
  visited: 'Visitou',
  enrolling: 'Matrícula em andamento',
  enrolled: 'Matriculado',
  lost: 'Não seguiu',
};

const LEAD_BADGE: Record<string, string> = {
  new: 'badge-submitted',
  contacted: 'badge-pending',
  visit_scheduled: 'badge-changes_requested',
  visited: 'badge-changes_requested',
  enrolling: 'badge-submitted',
  enrolled: 'badge-approved',
  lost: 'badge-rejected',
};

const SOURCE_LABELS: Record<string, string> = {
  site: 'Site',
  whatsapp: 'WhatsApp',
  referral: 'Indicação',
  instagram: 'Instagram',
  walk_in: 'Na escola',
  other: 'Outro',
};

const INTEREST_LABELS: Record<string, string> = { visit: 'Quer visitar', enroll: 'Quer matricular', info: 'Informações' };

export function LeadBadge({ status }: { status: string }) {
  return <span className={`badge ${LEAD_BADGE[status]}`}>{LEAD_STATUS_LABELS[status]}</span>;
}

type LeadRow = {
  id: string;
  code: string;
  status: string;
  interest: string;
  source: string;
  guardian_name: string;
  guardian_phone: string;
  student_name: string;
  desired_grade: string | null;
  created_at: string;
  unit_name: string;
  next_visit_at: string | null;
};

const PIPELINE = ['new', 'contacted', 'visit_scheduled', 'visited', 'enrolling', 'enrolled', 'lost'];

export function Admissions() {
  const { api, can } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const leads = useLoad(
    () =>
      api<{ data: LeadRow[]; counts: Record<string, number> }>(
        `/api/admission-leads?${new URLSearchParams({ ...(status && { status }), ...(search && { search }) })}`,
      ),
    [api, status, search],
  );
  const counts = leads.data?.counts ?? {};
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Captação</h1>
          <p className="muted">Famílias interessadas, do primeiro contato à matrícula.</p>
        </div>
        {can('admissions:manage') && (
          <div className="actions">
            <Link className="btn" to="/app/visitas">
              Agenda de visitas
            </Link>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Registrar contato
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={!status} className={`tab ${!status ? 'active' : ''}`} onClick={() => setStatus('')}>
            Todos<span className="count">{total}</span>
          </button>
          {PIPELINE.map((item) => (
            <button key={item} role="tab" aria-selected={status === item} className={`tab ${status === item ? 'active' : ''}`} onClick={() => setStatus(item)}>
              {LEAD_STATUS_LABELS[item]}
              <span className="count">{counts[item] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="field" style={{ maxWidth: 320 }}>
          <input placeholder="Buscar por nome ou protocolo…" aria-label="Buscar" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <ErrorAlert message={leads.error} />
        {leads.loading && !leads.data ? (
          <Loading />
        ) : leads.data?.data.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Criança</th>
                <th>Responsável</th>
                <th>Interesse</th>
                <th>Próxima visita</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {leads.data.data.map((lead) => (
                <tr key={lead.id} className="clickable" onClick={() => navigate(`/app/captacao/${lead.id}`)}>
                  <td data-label="Criança">
                    <strong>{lead.student_name}</strong>
                    <div className="muted small">
                      {lead.desired_grade ?? 'Turma a definir'} · {lead.unit_name}
                    </div>
                  </td>
                  <td data-label="Responsável">
                    {lead.guardian_name}
                    <div className="muted small">{formatPhone(lead.guardian_phone)}</div>
                  </td>
                  <td data-label="Interesse">
                    {INTEREST_LABELS[lead.interest]}
                    <div className="muted small">
                      {SOURCE_LABELS[lead.source]} · {formatDate(lead.created_at)}
                    </div>
                  </td>
                  <td data-label="Próxima visita">{lead.next_visit_at ? formatDateTime(lead.next_visit_at) : '—'}</td>
                  <td data-label="Situação">
                    <LeadBadge status={lead.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhuma família nesta etapa.</div>
        )}
      </div>

      {creating && (
        <NewLeadModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/app/captacao/${id}`);
          }}
        />
      )}
    </>
  );
}

type Unit = { id: string; name: string; accepting_enrollments: boolean };

function NewLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { api } = useAuth();
  const units = useLoad(() => api<{ data: Unit[] }>('/api/units').then((r) => r.data), [api]);
  const [form, setForm] = useState({
    unit_id: '',
    source: 'whatsapp',
    student_name: '',
    student_birth_date: '',
    desired_grade: '',
    guardian_name: '',
    guardian_phone: '',
    message: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value });
  const unitId = form.unit_id || units.data?.find((unit) => unit.accepting_enrollments)?.id || units.data?.[0]?.id || '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const created = await api<{ id: string }>('/api/admission-leads', {
        method: 'POST',
        body: {
          ...form,
          unit_id: unitId,
          student_birth_date: form.student_birth_date || undefined,
          desired_grade: form.desired_grade || undefined,
          message: form.message || undefined,
        },
      });
      onCreated(created.id);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Modal title="Registrar contato" onClose={onClose}>
      <p className="muted small">Para famílias que chegaram pelo WhatsApp, por indicação ou na portaria.</p>
      <form onSubmit={submit}>
        <ErrorAlert message={error} />
        <div className="form-row">
          <div className="field">
            <label htmlFor="l-unit">Unidade</label>
            <select id="l-unit" value={unitId} onChange={set('unit_id')}>
              {units.data?.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="l-source">Origem</label>
            <select id="l-source" value={form.source} onChange={set('source')}>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="l-student">Criança</label>
            <input id="l-student" required value={form.student_name} onChange={set('student_name')} />
          </div>
          <div className="field">
            <label htmlFor="l-birth">Nascimento</label>
            <input id="l-birth" type="date" value={form.student_birth_date} onChange={set('student_birth_date')} />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="l-guardian">Responsável</label>
            <input id="l-guardian" required value={form.guardian_name} onChange={set('guardian_name')} />
          </div>
          <div className="field">
            <label htmlFor="l-phone">WhatsApp</label>
            <input id="l-phone" type="tel" required value={form.guardian_phone} onChange={set('guardian_phone')} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="l-grade">Turma de interesse</label>
          <input id="l-grade" value={form.desired_grade} onChange={set('desired_grade')} />
        </div>
        <div className="field">
          <label htmlFor="l-message">Observações</label>
          <textarea id="l-message" value={form.message} onChange={set('message')} />
        </div>
        <div className="actions">
          <button className="btn btn-primary">Registrar</button>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Detalhe do atendimento ------------------------------------------------------

type LeadDetailData = LeadRow & {
  guardian_email: string | null;
  student_birth_date: string | null;
  desired_year: number | null;
  how_heard: string | null;
  message: string | null;
  lost_reason: string | null;
  unit_id: string;
  student_id: string | null;
  whatsapp_url: string | null;
  events: { type: string; from_status: string | null; to_status: string | null; notes: string | null; actor_type: string; actor_name: string | null; created_at: string }[];
  visits: { id: string; status: string; starts_at: string }[];
  enrollment_request: { id: string; status: string; campaign_title: string } | null;
};

const EVENT_LABELS: Record<string, string> = {
  created: 'Contato recebido',
  note: 'Anotação',
  visit_scheduled: 'Visita agendada',
  visit_attended: 'Compareceu à visita',
  visit_no_show: 'Não compareceu à visita',
  visit_cancelled: 'Visita cancelada',
};

const VISIT_LABELS: Record<string, string> = { scheduled: 'Agendada', attended: 'Compareceu', no_show: 'Não veio', cancelled: 'Cancelada' };

export function LeadDetail() {
  const { id } = useParams();
  const { api, can } = useAuth();
  const lead = useLoad(() => api<LeadDetailData>(`/api/admission-leads/${id}`), [api, id]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'visit' | 'convert' | 'lost' | null>(null);
  const [link, setLink] = useState<{ message: string; whatsapp_url: string | null } | null>(null);

  if (lead.loading && !lead.data) return <Loading />;
  if (!lead.data) return <ErrorAlert message={lead.error} />;
  const data = lead.data;
  const manage = can('admissions:manage');
  const open = !['enrolled', 'lost'].includes(data.status);
  const scheduled = data.visits.find((visit) => visit.status === 'scheduled');

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await lead.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const eventText = (event: LeadDetailData['events'][number]) => {
    if (event.type === 'status_changed') return LEAD_STATUS_LABELS[event.to_status ?? ''] ?? event.to_status;
    return EVENT_LABELS[event.type] ?? event.type;
  };

  return (
    <>
      <p className="small">
        <Link to="/app/captacao">← Captação</Link>
      </p>
      <div className="page-header">
        <div>
          <h1>{data.student_name}</h1>
          <p className="muted">
            Protocolo {data.code} · {data.unit_name} · {SOURCE_LABELS[data.source]}
          </p>
        </div>
        <LeadBadge status={data.status} />
      </div>
      <ErrorAlert message={error} />

      {data.enrollment_request && (
        <div className="alert alert-info">
          Matrícula online: {data.enrollment_request.campaign_title} ·{' '}
          <Link to={`/app/renovacao/${data.enrollment_request.id}`}>acompanhar a solicitação</Link>
        </div>
      )}

      <div className="grid grid-2">
        <div>
          <div className="card">
            <h2>Família</h2>
            <dl className="dl">
              <dt>Responsável</dt>
              <dd>{data.guardian_name}</dd>
              <dt>WhatsApp</dt>
              <dd>{formatPhone(data.guardian_phone)}</dd>
              <dt>E-mail</dt>
              <dd>{data.guardian_email ?? '—'}</dd>
              <dt>Nascimento</dt>
              <dd>{formatDate(data.student_birth_date)}</dd>
              <dt>Turma de interesse</dt>
              <dd>
                {data.desired_grade ?? '—'} {data.desired_year ? `(${data.desired_year})` : ''}
              </dd>
              <dt>Interesse</dt>
              <dd>{INTEREST_LABELS[data.interest]}</dd>
              <dt>Como conheceu</dt>
              <dd>{data.how_heard ?? '—'}</dd>
            </dl>
            {data.message && (
              <div className="alert alert-info" style={{ marginTop: '1rem', marginBottom: 0 }}>
                <strong>Mensagem:</strong> {data.message}
              </div>
            )}
            {data.lost_reason && data.status === 'lost' && (
              <div className="alert alert-warning" style={{ marginTop: '1rem', marginBottom: 0 }}>
                <strong>Motivo:</strong> {data.lost_reason}
              </div>
            )}
            {data.whatsapp_url && (
              <a className="btn btn-whatsapp" style={{ marginTop: '1rem' }} href={data.whatsapp_url} target="_blank" rel="noreferrer">
                Conversar no WhatsApp
              </a>
            )}
          </div>

          {manage && open && (
            <div className="card">
              <h2>Próximo passo</h2>
              <div className="actions">
                {data.status === 'new' && (
                  <button className="btn" onClick={() => run(() => api(`/api/admission-leads/${data.id}/status`, { method: 'POST', body: { status: 'contacted' } }))}>
                    Marcar como em conversa
                  </button>
                )}
                {data.status !== 'enrolling' && (
                  <button className="btn" onClick={() => setModal('visit')}>
                    {scheduled ? 'Remarcar visita' : 'Agendar visita'}
                  </button>
                )}
                {!data.student_id && (
                  <button className="btn btn-primary" onClick={() => setModal('convert')}>
                    Iniciar matrícula online
                  </button>
                )}
                <button className="btn btn-danger" onClick={() => setModal('lost')}>
                  Não seguiu
                </button>
              </div>
            </div>
          )}

          {data.visits.length > 0 && (
            <div className="card">
              <h2>Visitas</h2>
              {data.visits.map((visit) => (
                <div key={visit.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                  <span>
                    <strong>{formatDateTime(visit.starts_at)}</strong> · {VISIT_LABELS[visit.status]}
                  </span>
                  {manage && visit.status === 'scheduled' && (
                    <span className="actions">
                      <button className="btn btn-small btn-success" onClick={() => run(() => api(`/api/admission-leads/${data.id}/visits/${visit.id}`, { method: 'PATCH', body: { status: 'attended' } }))}>
                        Compareceu
                      </button>
                      <button className="btn btn-small" onClick={() => run(() => api(`/api/admission-leads/${data.id}/visits/${visit.id}`, { method: 'PATCH', body: { status: 'no_show' } }))}>
                        Não veio
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Histórico</h2>
          <ol className="timeline">
            {data.events.map((event, index) => (
              <li key={index}>
                <strong>{eventText(event)}</strong>
                <div className="muted small">
                  {formatDateTime(event.created_at)} ·{' '}
                  {event.actor_type === 'public' ? 'pelo site' : event.actor_type === 'system' ? 'sistema' : event.actor_name}
                </div>
                {event.notes && event.type !== 'visit_scheduled' && <div className="small">“{event.notes}”</div>}
                {event.type === 'visit_scheduled' && event.notes && <div className="small">{formatDateTime(event.notes)}</div>}
              </li>
            ))}
          </ol>
          {manage && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!note.trim()) return;
                run(() => api(`/api/admission-leads/${data.id}/notes`, { method: 'POST', body: { notes: note } })).then(() => setNote(''));
              }}
            >
              <div className="field">
                <label htmlFor="note">Anotação</label>
                <textarea id="note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: ligou pedindo valores do integral" />
              </div>
              <button className="btn btn-small">Salvar anotação</button>
            </form>
          )}
        </div>
      </div>

      {modal === 'visit' && (
        <VisitModal
          leadId={data.id}
          unitId={data.unit_id}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            lead.reload();
          }}
        />
      )}
      {modal === 'lost' && (
        <LostModal
          onClose={() => setModal(null)}
          onConfirm={(reason) =>
            run(() => api(`/api/admission-leads/${data.id}/status`, { method: 'POST', body: { status: 'lost', notes: reason } })).then(() => setModal(null))
          }
        />
      )}
      {modal === 'convert' && (
        <ConvertModal
          lead={data}
          onClose={() => setModal(null)}
          onDone={(result) => {
            setModal(null);
            setLink(result);
            lead.reload();
          }}
        />
      )}
      {link && (
        <Modal title="Matrícula online iniciada" onClose={() => setLink(null)}>
          <p className="muted small">Envie o link para a família completar a matrícula pelo celular.</p>
          <div className="message-preview">{link.message}</div>
          <div className="actions">
            {link.whatsapp_url && (
              <a className="btn btn-whatsapp" href={link.whatsapp_url} target="_blank" rel="noreferrer">
                Abrir no WhatsApp
              </a>
            )}
            <button className="btn" onClick={() => setLink(null)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

type Slot = { id: string; starts_at: string; capacity: number; visits: unknown[] };

function VisitModal({ leadId, unitId, onClose, onDone }: { leadId: string; unitId: string; onClose: () => void; onDone: () => void }) {
  const { api } = useAuth();
  const slots = useLoad(() => api<{ data: Slot[] }>(`/api/visit-slots?unit_id=${unitId}`).then((r) => r.data), [api, unitId]);
  const [error, setError] = useState<string | null>(null);
  const free = slots.data?.filter((slot) => slot.visits.length < slot.capacity && new Date(slot.starts_at) > new Date()) ?? [];

  const book = async (slotId: string) => {
    try {
      await api(`/api/admission-leads/${leadId}/visits`, { method: 'POST', body: { slot_id: slotId } });
      onDone();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Modal title="Agendar visita" onClose={onClose}>
      <ErrorAlert message={error ?? slots.error} />
      {slots.loading ? (
        <Loading />
      ) : free.length ? (
        <div className="actions">
          {free.slice(0, 30).map((slot) => (
            <button key={slot.id} className="btn btn-small" onClick={() => book(slot.id)}>
              {formatDateTime(slot.starts_at)} · {slot.capacity - slot.visits.length} vaga(s)
            </button>
          ))}
        </div>
      ) : (
        <p>
          Nenhum horário livre. <Link to="/app/visitas">Abrir horários na agenda</Link>.
        </p>
      )}
    </Modal>
  );
}

function LostModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const options = ['Escolheu outra escola', 'Valor da mensalidade', 'Distância', 'Sem vaga na turma', 'Não respondeu mais'];
  return (
    <Modal title="Encerrar atendimento" onClose={onClose}>
      <p className="muted small">O motivo ajuda a escola a entender onde está perdendo matrículas.</p>
      <div className="actions" style={{ marginBottom: '1rem' }}>
        {options.map((option) => (
          <button key={option} type="button" className={`tab ${reason === option ? 'active' : ''}`} onClick={() => setReason(option)}>
            {option}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="reason">Motivo</label>
        <input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className="actions">
        <button className="btn btn-danger" disabled={!reason.trim()} onClick={() => onConfirm(reason)}>
          Encerrar
        </button>
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}

type Campaign = { id: string; title: string; kind: string; status: string; school_year_id: string; unit_id: string | null };
type ClassOption = { id: string; name: string; unit_id: string | null };

function ConvertModal({
  lead,
  onClose,
  onDone,
}: {
  lead: LeadDetailData;
  onClose: () => void;
  onDone: (link: { message: string; whatsapp_url: string | null }) => void;
}) {
  const { api } = useAuth();
  const campaigns = useLoad(
    () =>
      api<{ data: Campaign[] }>('/api/renewal-campaigns?kind=admission').then((r) =>
        r.data.filter((campaign) => campaign.status === 'open' && (!campaign.unit_id || campaign.unit_id === lead.unit_id)),
      ),
    [api, lead.unit_id],
  );
  const [campaignId, setCampaignId] = useState('');
  const selected = campaigns.data?.find((campaign) => campaign.id === (campaignId || campaigns.data?.[0]?.id));
  const classes = useLoad(
    () =>
      selected
        ? api<{ data: ClassOption[] }>(`/api/classes?school_year_id=${selected.school_year_id}&unit_id=${lead.unit_id}`).then((r) => r.data)
        : Promise.resolve([]),
    [api, selected?.id],
  );
  const [classId, setClassId] = useState('');
  const [birth, setBirth] = useState(lead.student_birth_date ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!selected) return;
    try {
      const result = await api<{ link: { message: string; whatsapp_url: string | null } }>(`/api/admission-leads/${lead.id}/convert`, {
        method: 'POST',
        body: { campaign_id: selected.id, target_class_id: classId || null, student_birth_date: birth || undefined },
      });
      onDone(result.link);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Modal title="Iniciar matrícula online" onClose={onClose}>
      <p className="muted small">
        Cria o cadastro da criança e da família e gera o link para completarem a matrícula pelo celular. A vaga só é confirmada
        quando a Secretaria aprovar.
      </p>
      <ErrorAlert message={error ?? campaigns.error} />
      {campaigns.data && !campaigns.data.length ? (
        <div className="alert alert-warning">
          Não há período de matrícula de novos alunos aberto para esta unidade. <Link to="/app/renovacao">Criar em Matrículas</Link>.
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="c-campaign">Período de matrícula</label>
            <select id="c-campaign" value={selected?.id ?? ''} onChange={(event) => setCampaignId(event.target.value)}>
              {campaigns.data?.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.title}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="c-class">Turma</label>
              <select id="c-class" value={classId} onChange={(event) => setClassId(event.target.value)}>
                <option value="">Definir depois</option>
                {classes.data?.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-birth">Nascimento da criança</label>
              <input id="c-birth" type="date" required value={birth} onChange={(event) => setBirth(event.target.value)} />
              <span className="hint">A família usa esta data para entrar no link.</span>
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary" disabled={!selected || !birth} onClick={submit}>
              Criar e gerar link
            </button>
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
