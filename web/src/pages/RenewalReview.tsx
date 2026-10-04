import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorAlert, Loading, StatusBadge } from '../components/ui';
import { useLoad } from '../hooks';
import {
  FIELD_LABELS,
  RELATIONSHIP_LABELS,
  STATUS_LABELS,
  type Address,
  formatAddress,
  formatDate,
  formatDateTime,
  formatPhone,
  formatValue,
} from '../labels';

type Detail = {
  id: string;
  status: string;
  campaign_title: string;
  school_year_id: string;
  target_class_id: string | null;
  guardian_notes: string | null;
  review_notes: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  terms_accepted_at: string | null;
  student: {
    id: string;
    full_name: string;
    birth_date: string;
    cpf: string | null;
    address: Address;
    health_notes: string | null;
    current_class_name: string | null;
  };
  guardians: { id: string; full_name: string; phone: string | null; email: string | null; relationship: string }[];
  changes: { section: 'student' | 'guardian'; field: string; before: unknown; after: unknown }[];
  events: { from_status: string | null; to_status: string; actor_type: string; actor_name: string | null; notes: string | null; created_at: string }[];
};

type ClassOption = { id: string; name: string; grade: string };

export function RenewalReview() {
  const { id } = useParams();
  const { api, can } = useAuth();
  const detail = useLoad(() => api<Detail>(`/api/renewal-requests/${id}`), [api, id]);
  const classes = useLoad(
    () =>
      detail.data
        ? api<{ data: ClassOption[] }>(`/api/classes?school_year_id=${detail.data.school_year_id}`).then((r) => r.data)
        : Promise.resolve([]),
    [api, detail.data?.school_year_id],
  );
  const [targetClass, setTargetClass] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (detail.loading && !detail.data) return <Loading />;
  if (!detail.data) return <ErrorAlert message={detail.error} />;

  const data = detail.data;
  const selectedClass = targetClass ?? data.target_class_id ?? '';
  const canReview = can('renewals:review') && data.status === 'submitted';

  const decide = async (action: 'approve' | 'request-changes' | 'reject') => {
    if (action !== 'approve' && notes.trim().length < 3) {
      setError('Escreva o motivo para o responsável.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/renewal-requests/${data.id}/${action}`, {
        method: 'POST',
        body: action === 'approve' ? { target_class_id: selectedClass || null, notes: notes || undefined } : { notes },
      });
      setNotes('');
      await detail.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="small">
        <Link to="/app/renovacao">← Renovação</Link>
      </p>
      <div className="page-header">
        <div>
          <h1>{data.student.full_name}</h1>
          <p className="muted">
            {data.campaign_title} · Turma atual: {data.student.current_class_name ?? '—'}
          </p>
        </div>
        <StatusBadge status={data.status} />
      </div>

      <ErrorAlert message={error ?? detail.error} />
      {data.status === 'pending' && (
        <div className="alert alert-info">O responsável ainda não respondeu. Envie um lembrete pela lista de renovação.</div>
      )}

      <div className="grid grid-2">
        <div>
          {data.status === 'submitted' && (
            <div className="card">
              <h2>O que o responsável alterou</h2>
              {data.changes.length ? (
                <table className="table diff-table">
                  <thead>
                    <tr>
                      <th>Campo</th>
                      <th>Antes</th>
                      <th>Agora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.changes.map((change) => (
                      <tr key={`${change.section}.${change.field}`}>
                        <td data-label="Campo">
                          {FIELD_LABELS[change.field] ?? change.field}
                          <div className="muted small">{change.section === 'student' ? 'Aluno' : 'Responsável'}</div>
                        </td>
                        <td data-label="Antes" className="before">
                          {formatValue(change.field, change.before)}
                        </td>
                        <td data-label="Agora" className="after">
                          {formatValue(change.field, change.after)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">Nenhuma alteração: o responsável confirmou os dados como estavam.</p>
              )}
              {data.guardian_notes && (
                <div className="alert alert-info" style={{ marginTop: '1rem', marginBottom: 0 }}>
                  <strong>Observação do responsável:</strong> {data.guardian_notes}
                </div>
              )}
              <p className="muted small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                Enviado em {formatDateTime(data.submitted_at)}. Declaração de veracidade aceita em{' '}
                {formatDateTime(data.terms_accepted_at)}.
              </p>
            </div>
          )}

          {canReview && (
            <div className="card">
              <h2>Decisão</h2>
              <div className="field">
                <label htmlFor="target">Turma no novo ano</label>
                <select id="target" value={selectedClass} onChange={(event) => setTargetClass(event.target.value)}>
                  <option value="">Definir depois</option>
                  {classes.data?.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="notes">Mensagem ao responsável</label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Obrigatória para pedir correção ou rejeitar"
                />
              </div>
              <div className="actions">
                <button className="btn btn-success" disabled={busy} onClick={() => decide('approve')}>
                  Aprovar e matricular
                </button>
                <button className="btn" disabled={busy} onClick={() => decide('request-changes')}>
                  Pedir correção
                </button>
                <button className="btn btn-danger" disabled={busy} onClick={() => decide('reject')}>
                  Rejeitar
                </button>
              </div>
              <p className="muted small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                Ao aprovar, os dados confirmados são gravados no cadastro e a matrícula do novo ano é criada.
              </p>
            </div>
          )}

          {data.review_notes && data.status !== 'submitted' && (
            <div className="card">
              <h2>Decisão da escola</h2>
              <p>{data.review_notes}</p>
              <p className="muted small">
                {data.reviewed_by_name} · {formatDateTime(data.reviewed_at)}
              </p>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h2>Cadastro atual</h2>
            <dl className="dl">
              <dt>Nascimento</dt>
              <dd>{formatDate(data.student.birth_date)}</dd>
              <dt>CPF</dt>
              <dd>{data.student.cpf ?? '—'}</dd>
              <dt>Endereço</dt>
              <dd>{formatAddress(data.student.address)}</dd>
              <dt>Saúde</dt>
              <dd>{data.student.health_notes ?? '—'}</dd>
            </dl>
            <div className="section-title">Responsáveis</div>
            {data.guardians.map((guardian) => (
              <p key={guardian.id}>
                <strong>{guardian.full_name}</strong> ({RELATIONSHIP_LABELS[guardian.relationship] ?? guardian.relationship})
                <br />
                <span className="muted small">
                  {formatPhone(guardian.phone)} {guardian.email ? `· ${guardian.email}` : ''}
                </span>
              </p>
            ))}
            <Link to={`/app/alunos/${data.student.id}`} className="small">
              Ver ficha completa
            </Link>
          </div>

          <div className="card">
            <h2>Histórico</h2>
            <ol className="timeline">
              {data.events.map((event, index) => (
                <li key={index}>
                  <strong>{STATUS_LABELS[event.to_status]}</strong>
                  <div className="muted small">
                    {formatDateTime(event.created_at)} ·{' '}
                    {event.actor_type === 'system' ? 'Sistema' : event.actor_name}
                    {event.actor_type === 'guardian' && ' (responsável)'}
                  </div>
                  {event.notes && <div className="small">“{event.notes}”</div>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}
