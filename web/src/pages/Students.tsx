import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { AccessLinkModal } from '../components/AccessLinkModal';
import { ErrorAlert, Loading, Modal, StatusBadge } from '../components/ui';
import { useLoad } from '../hooks';
import { RELATIONSHIP_LABELS, type Address, formatAddress, formatDate, formatDateTime, formatPhone } from '../labels';

type StudentRow = {
  id: string;
  full_name: string;
  birth_date: string;
  current_class_name: string | null;
  primary_guardian_id: string | null;
  primary_guardian_name: string | null;
  primary_guardian_phone: string | null;
};

type ClassOption = { id: string; name: string; year: number };

export function Students() {
  const { api, can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [linkFor, setLinkFor] = useState<{ id: string; full_name: string } | null>(null);

  const students = useLoad(
    () =>
      api<{ data: StudentRow[]; total: number; page_size: number }>(
        `/api/students?page=${page}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    [api, page, search],
  );

  const pages = students.data ? Math.max(1, Math.ceil(students.data.total / students.data.page_size)) : 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Alunos</h1>
          <p className="muted">{students.data ? `${students.data.total} alunos cadastrados` : ' '}</p>
        </div>
        {can('students:manage') && (
          <div className="actions">
            <Link className="btn" to="/app/importar">
              Importar lista
            </Link>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Cadastro rápido
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="field" style={{ maxWidth: 320 }}>
          <input
            placeholder="Buscar por nome…"
            aria-label="Buscar por nome"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <ErrorAlert message={students.error} />
        {students.loading && !students.data ? (
          <Loading />
        ) : students.data?.data.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Aluno</th>
                <th>Turma</th>
                <th>Responsável</th>
                <th>WhatsApp</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {students.data.data.map((student) => (
                <tr key={student.id} className="clickable" onClick={() => navigate(`/app/alunos/${student.id}`)}>
                  <td data-label="Aluno">
                    <strong>{student.full_name}</strong>
                    <div className="muted small">{formatDate(student.birth_date)}</div>
                  </td>
                  <td data-label="Turma">{student.current_class_name ?? '—'}</td>
                  <td data-label="Responsável">{student.primary_guardian_name ?? '—'}</td>
                  <td data-label="WhatsApp">{formatPhone(student.primary_guardian_phone)}</td>
                  <td data-label="">
                    {can('guardians:invite') && student.primary_guardian_id && (
                      <button
                        className="btn btn-small btn-whatsapp"
                        onClick={(event) => {
                          event.stopPropagation();
                          setLinkFor({ id: student.primary_guardian_id!, full_name: student.primary_guardian_name ?? '' });
                        }}
                      >
                        Enviar link
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhum aluno encontrado.</div>
        )}
        {pages > 1 && (
          <div className="actions" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            <button className="btn btn-small" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <span className="muted small" style={{ alignSelf: 'center' }}>
              Página {page} de {pages}
            </span>
            <button className="btn btn-small" disabled={page === pages} onClick={() => setPage(page + 1)}>
              Próxima
            </button>
          </div>
        )}
      </div>

      {creating && (
        <QuickRegisterModal
          onClose={() => setCreating(false)}
          onCreated={(student) => {
            setCreating(false);
            students.reload();
            if (student.guardians[0] && can('guardians:invite')) setLinkFor(student.guardians[0]);
          }}
        />
      )}
      {linkFor && <AccessLinkModal guardian={linkFor} onClose={() => setLinkFor(null)} />}
    </>
  );
}

type CreatedStudent = { id: string; guardians: { id: string; full_name: string }[] };

/** Cadastro mínimo: o restante dos dados o próprio responsável completa pelo link. */
function QuickRegisterModal({ onClose, onCreated }: { onClose: () => void; onCreated: (student: CreatedStudent) => void }) {
  const { api } = useAuth();
  const classes = useLoad(() => api<{ data: ClassOption[] }>('/api/classes').then((r) => r.data), [api]);
  const [form, setForm] = useState({
    full_name: '',
    birth_date: '',
    current_class_id: '',
    guardian_name: '',
    guardian_phone: '',
    relationship: 'mother',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [field]: event.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const student = await api<CreatedStudent>('/api/students', {
        method: 'POST',
        body: {
          full_name: form.full_name,
          birth_date: form.birth_date,
          current_class_id: form.current_class_id || null,
          guardians: [
            {
              full_name: form.guardian_name,
              phone: form.guardian_phone,
              relationship: form.relationship,
              is_financial_responsible: true,
              is_primary_contact: true,
            },
          ],
        },
      });
      onCreated(student);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Cadastro rápido" onClose={onClose}>
      <p className="muted small">
        Só o essencial. O responsável recebe um link e completa endereço, documentos e saúde pelo celular.
      </p>
      <form onSubmit={submit}>
        <ErrorAlert message={error} />
        <div className="field">
          <label htmlFor="name">Nome do aluno</label>
          <input id="name" required value={form.full_name} onChange={set('full_name')} />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="birth">Nascimento</label>
            <input id="birth" type="date" required value={form.birth_date} onChange={set('birth_date')} />
          </div>
          <div className="field">
            <label htmlFor="class">Turma</label>
            <select id="class" value={form.current_class_id} onChange={set('current_class_id')}>
              <option value="">Sem turma</option>
              {classes.data?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.year})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="guardian">Nome do responsável</label>
          <input id="guardian" required value={form.guardian_name} onChange={set('guardian_name')} />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="phone">WhatsApp</label>
            <input id="phone" type="tel" required placeholder="(11) 98888-7777" value={form.guardian_phone} onChange={set('guardian_phone')} />
          </div>
          <div className="field">
            <label htmlFor="relationship">Parentesco</label>
            <select id="relationship" value={form.relationship} onChange={set('relationship')}>
              {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar e gerar link'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}

type StudentDetail = {
  id: string;
  full_name: string;
  social_name: string | null;
  birth_date: string;
  cpf: string | null;
  address: Address;
  health_notes: string | null;
  current_class_name: string | null;
  guardians: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    relationship: string;
    is_primary_contact: boolean;
    is_financial_responsible: boolean;
  }[];
  enrollments: { id: string; year: number; status: string; class_name: string | null }[];
  renewals: { id: string; status: string; campaign_title: string; submitted_at: string | null }[];
};

export function StudentDetailPage() {
  const { id } = useParams();
  const { api, can } = useAuth();
  const student = useLoad(() => api<StudentDetail>(`/api/students/${id}`), [api, id]);
  const [linkFor, setLinkFor] = useState<{ id: string; full_name: string } | null>(null);

  if (student.loading && !student.data) return <Loading />;
  if (!student.data) return <ErrorAlert message={student.error} />;
  const data = student.data;

  return (
    <>
      <p className="small">
        <Link to="/app/alunos">← Alunos</Link>
      </p>
      <div className="page-header">
        <div>
          <h1>{data.full_name}</h1>
          <p className="muted">Turma atual: {data.current_class_name ?? '—'}</p>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <h2>Dados do aluno</h2>
          <dl className="dl">
            <dt>Nascimento</dt>
            <dd>{formatDate(data.birth_date)}</dd>
            <dt>Nome social</dt>
            <dd>{data.social_name ?? '—'}</dd>
            <dt>CPF</dt>
            <dd>{data.cpf ?? '—'}</dd>
            <dt>Endereço</dt>
            <dd>{formatAddress(data.address)}</dd>
            <dt>Saúde</dt>
            <dd>{data.health_notes ?? '—'}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Responsáveis</h2>
          {data.guardians.map((guardian) => (
            <div key={guardian.id} style={{ marginBottom: '1rem' }}>
              <strong>{guardian.full_name}</strong>{' '}
              <span className="muted small">
                {RELATIONSHIP_LABELS[guardian.relationship]}
                {guardian.is_primary_contact && ' · contato principal'}
                {guardian.is_financial_responsible && ' · financeiro'}
              </span>
              <div className="small">
                {formatPhone(guardian.phone)} {guardian.email && `· ${guardian.email}`}
              </div>
              {can('guardians:invite') && (
                <button className="btn btn-small btn-whatsapp" style={{ marginTop: '0.4rem' }} onClick={() => setLinkFor(guardian)}>
                  Enviar link de acesso
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="card">
          <h2>Matrículas</h2>
          {data.enrollments.length ? (
            data.enrollments.map((enrollment) => (
              <p key={enrollment.id}>
                <strong>{enrollment.year}</strong> · {enrollment.class_name ?? 'Turma a definir'}
              </p>
            ))
          ) : (
            <p className="muted">Nenhuma matrícula registrada pelo sistema ainda.</p>
          )}
        </div>
        <div className="card">
          <h2>Renovações</h2>
          {data.renewals.length ? (
            data.renewals.map((renewal) => (
              <p key={renewal.id}>
                <Link to={`/app/renovacao/${renewal.id}`}>{renewal.campaign_title}</Link> <StatusBadge status={renewal.status} />
                <br />
                <span className="muted small">Enviado em {formatDateTime(renewal.submitted_at)}</span>
              </p>
            ))
          ) : (
            <p className="muted">Nenhuma renovação.</p>
          )}
        </div>
      </div>
      {linkFor && <AccessLinkModal guardian={linkFor} onClose={() => setLinkFor(null)} />}
    </>
  );
}
