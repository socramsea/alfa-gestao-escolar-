import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, errorMessage, request } from '../api';
import { ErrorAlert, Loading, StatusBadge } from '../components/ui';
import type { Address } from '../labels';

type PortalMe = {
  guardian: { id: string; name: string };
  school: { name: string };
  students: {
    id: string;
    full_name: string;
    current_class_name: string | null;
    renewals: { id: string; status: string; status_label: string; campaign_title: string; ends_on: string; review_notes: string | null }[];
  }[];
};

type RenewalDetail = {
  id: string;
  status: string;
  campaign_title: string;
  review_notes: string | null;
  can_submit: boolean;
  proposed_data: FormData | null;
  student: { full_name: string; social_name: string | null; cpf: string | null; address: Address; health_notes: string | null; current_class_name: string | null };
  guardian: { full_name: string; phone: string | null; email: string | null; cpf: string | null; address: Address };
};

type FormData = {
  student: { full_name: string; social_name?: string | null; cpf?: string | null; address?: Address; health_notes?: string | null };
  guardian: { full_name: string; phone: string; email?: string | null; cpf?: string | null; address?: Address };
};

// A sessão do portal fica só nesta aba: fechou o navegador, precisa confirmar de novo.
const sessionKey = (linkToken: string) => `alfa.portal.${linkToken.slice(0, 12)}`;
function readSession(linkToken: string) {
  try {
    return window.sessionStorage.getItem(sessionKey(linkToken));
  } catch {
    return null;
  }
}
function writeSession(linkToken: string, value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(sessionKey(linkToken), value);
    else window.sessionStorage.removeItem(sessionKey(linkToken));
  } catch {
    /* ignora */
  }
}

export function Portal() {
  const { token: linkToken = '' } = useParams();
  const [session, setSession] = useState(() => readSession(linkToken));
  const [me, setMe] = useState<PortalMe | null>(null);
  const [openRenewal, setOpenRenewal] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = useCallback(
    async <T,>(path: string, options: { method?: string; body?: unknown } = {}) => {
      try {
        return await request<T>(path, { ...options, token: session });
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          writeSession(linkToken, null);
          setSession(null);
        }
        throw reason;
      }
    },
    [session, linkToken],
  );

  const loadMe = useCallback(() => {
    api<PortalMe>('/api/portal/me')
      .then(setMe)
      .catch((reason) => setError(errorMessage(reason)));
  }, [api]);

  useEffect(() => {
    if (session) loadMe();
  }, [session, loadMe]);

  if (!session) {
    return (
      <Verify
        linkToken={linkToken}
        onVerified={(token) => {
          writeSession(linkToken, token);
          setSession(token);
        }}
      />
    );
  }

  return (
    <div className="portal">
      <header className="portal-header">
        <span className="brand-mark">A</span>
        <div>
          <strong>{me?.school.name ?? 'Portal do responsável'}</strong>
          <span className="muted small">Portal do responsável</span>
        </div>
      </header>
      <ErrorAlert message={error} />
      {!me ? (
        <Loading />
      ) : sent ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="success-icon" aria-hidden>
            ✓
          </div>
          <h1>Recebemos!</h1>
          <p>
            Os dados de <strong>{sent}</strong> foram enviados para a secretaria. Você não precisa ir à escola nem entregar
            papel.
          </p>
          <p className="muted small">Pode acompanhar a situação por este mesmo link sempre que quiser.</p>
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              setSent(null);
              loadMe();
            }}
          >
            Voltar
          </button>
        </div>
      ) : openRenewal ? (
        <RenewalForm
          id={openRenewal}
          api={api}
          onBack={() => setOpenRenewal(null)}
          onSent={(studentName) => {
            setOpenRenewal(null);
            setSent(studentName);
          }}
        />
      ) : (
        <>
          <h1>Olá, {me.guardian.name.split(' ')[0]}!</h1>
          <p className="muted">Confira abaixo a situação de cada aluno.</p>
          {me.students.map((student) => {
            const renewal = student.renewals[0];
            const actionable = renewal && ['pending', 'changes_requested'].includes(renewal.status);
            return (
              <div className="card" key={student.id}>
                <div className="student-card">
                  <div>
                    <strong>{student.full_name}</strong>
                    <div className="muted small">{student.current_class_name ?? ''}</div>
                  </div>
                  {renewal && <StatusBadge status={renewal.status} label={renewal.status_label} />}
                </div>
                {renewal ? (
                  <>
                    {renewal.status === 'changes_requested' && renewal.review_notes && (
                      <div className="alert alert-warning" style={{ marginTop: '0.75rem' }}>
                        <strong>A escola pediu:</strong> {renewal.review_notes}
                      </div>
                    )}
                    {renewal.status === 'rejected' && renewal.review_notes && (
                      <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>
                        {renewal.review_notes}
                      </div>
                    )}
                    {renewal.status === 'approved' && (
                      <p className="small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                        Renovação confirmada pela escola.
                      </p>
                    )}
                    {renewal.status !== 'approved' && renewal.status !== 'rejected' && (
                      <button
                        className={`btn btn-block ${actionable ? 'btn-primary' : ''}`}
                        style={{ marginTop: '0.75rem' }}
                        onClick={() => setOpenRenewal(renewal.id)}
                      >
                        {actionable ? 'Conferir e confirmar dados' : 'Ver ou corrigir o que enviei'}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="muted small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                    Nenhuma pendência no momento.
                  </p>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function Verify({ linkToken, onVerified }: { linkToken: string; onVerified: (token: string) => void }) {
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await request<{ token: string }>('/api/portal/session', {
        method: 'POST',
        body: { token: linkToken, student_birth_date: birthDate },
      });
      onVerified(response.token);
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 401
          ? 'Não conseguimos confirmar. Verifique a data ou peça um novo link para a escola.'
          : errorMessage(reason),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>Portal do responsável</span>
        </div>
        <p>Para sua segurança, confirme a <strong>data de nascimento do aluno</strong>.</p>
        <ErrorAlert message={error} />
        <div className="field">
          <label htmlFor="birth">Data de nascimento do aluno</label>
          <input id="birth" type="date" required value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy || !birthDate}>
          {busy ? 'Confirmando…' : 'Entrar'}
        </button>
        <p className="muted small" style={{ marginTop: '1rem', marginBottom: 0 }}>
          Este link é pessoal. Não compartilhe.
        </p>
      </form>
    </div>
  );
}

const EMPTY_ADDRESS: Address = { street: '', number: '', complement: '', district: '', city: '', state: '', zip_code: '' };

function clean<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, inner]) => inner !== '' && inner !== undefined)) as T;
}

function RenewalForm({
  id,
  api,
  onBack,
  onSent,
}: {
  id: string;
  api: <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;
  onBack: () => void;
  onSent: (studentName: string) => void;
}) {
  const [detail, setDetail] = useState<RenewalDetail | null>(null);
  const [student, setStudent] = useState({ full_name: '', social_name: '', cpf: '', health_notes: '' });
  const [guardian, setGuardian] = useState({ full_name: '', phone: '', email: '', cpf: '' });
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [notes, setNotes] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<RenewalDetail>(`/api/portal/renewals/${id}`)
      .then((data) => {
        setDetail(data);
        // Se já enviou antes, parte do que enviou; senão, do cadastro da escola.
        const source = data.proposed_data;
        const s = source?.student ?? data.student;
        const g = source?.guardian ?? data.guardian;
        setStudent({ full_name: s.full_name, social_name: s.social_name ?? '', cpf: s.cpf ?? '', health_notes: s.health_notes ?? '' });
        setGuardian({ full_name: g.full_name, phone: g.phone ?? '', email: g.email ?? '', cpf: g.cpf ?? '' });
        setAddress({ ...EMPTY_ADDRESS, ...(s.address ?? {}), ...(Object.keys(s.address ?? {}).length ? {} : g.address ?? {}) });
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, [api, id]);

  if (!detail) return error ? <ErrorAlert message={error} /> : <Loading />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const cleanAddress = clean(address);
    try {
      await api(`/api/portal/renewals/${id}/submit`, {
        method: 'POST',
        body: {
          data: {
            student: { ...clean(student), address: cleanAddress },
            guardian: { ...clean(guardian), address: cleanAddress },
          },
          notes: notes || undefined,
          accept_terms: accepted,
        },
      });
      onSent(student.full_name);
    } catch (reason) {
      setError(errorMessage(reason));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  const setAddr = (field: keyof Address) => (event: { target: { value: string } }) =>
    setAddress({ ...address, [field]: event.target.value });

  return (
    <form onSubmit={submit}>
      <button type="button" className="btn btn-small" onClick={onBack} style={{ marginBottom: '1rem' }}>
        ← Voltar
      </button>
      <h1>{detail.campaign_title}</h1>
      <p className="muted">Confira os dados e corrija o que estiver diferente. Leva cerca de 3 minutos.</p>
      {detail.review_notes && detail.status === 'changes_requested' && (
        <div className="alert alert-warning">
          <strong>A escola pediu:</strong> {detail.review_notes}
        </div>
      )}
      <ErrorAlert message={error} />
      {!detail.can_submit && <div className="alert alert-info">O prazo de renovação está encerrado. Fale com a escola.</div>}

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Aluno
        </div>
        <div className="field">
          <label htmlFor="s-name">Nome completo</label>
          <input id="s-name" required value={student.full_name} onChange={(e) => setStudent({ ...student, full_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-social">Nome social (opcional)</label>
          <input id="s-social" value={student.social_name} onChange={(e) => setStudent({ ...student, social_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-cpf">CPF do aluno (opcional)</label>
          <input id="s-cpf" inputMode="numeric" value={student.cpf} onChange={(e) => setStudent({ ...student, cpf: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-health">Saúde, alergias e medicamentos</label>
          <span className="hint">Informação importante para a segurança do aluno na escola.</span>
          <textarea id="s-health" value={student.health_notes} onChange={(e) => setStudent({ ...student, health_notes: e.target.value })} />
        </div>

        <div className="section-title">Endereço</div>
        <div className="field">
          <label htmlFor="a-zip">CEP</label>
          <input id="a-zip" inputMode="numeric" maxLength={9} value={address.zip_code} onChange={setAddr('zip_code')} />
        </div>
        <div className="field">
          <label htmlFor="a-street">Rua</label>
          <input id="a-street" value={address.street} onChange={setAddr('street')} />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="a-number">Número</label>
            <input id="a-number" value={address.number} onChange={setAddr('number')} />
          </div>
          <div className="field">
            <label htmlFor="a-complement">Complemento</label>
            <input id="a-complement" value={address.complement} onChange={setAddr('complement')} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="a-district">Bairro</label>
          <input id="a-district" value={address.district} onChange={setAddr('district')} />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="a-city">Cidade</label>
            <input id="a-city" value={address.city} onChange={setAddr('city')} />
          </div>
          <div className="field">
            <label htmlFor="a-state">UF</label>
            <input id="a-state" maxLength={2} value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value.toUpperCase() })} />
          </div>
        </div>

        <div className="section-title">Seus dados</div>
        <div className="field">
          <label htmlFor="g-name">Seu nome completo</label>
          <input id="g-name" required value={guardian.full_name} onChange={(e) => setGuardian({ ...guardian, full_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="g-phone">WhatsApp</label>
          <input id="g-phone" type="tel" required value={guardian.phone} onChange={(e) => setGuardian({ ...guardian, phone: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="g-email">E-mail (opcional)</label>
          <input id="g-email" type="email" value={guardian.email} onChange={(e) => setGuardian({ ...guardian, email: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="g-cpf">Seu CPF</label>
          <input id="g-cpf" inputMode="numeric" value={guardian.cpf} onChange={(e) => setGuardian({ ...guardian, cpf: e.target.value })} />
        </div>

        <div className="section-title">Algo mais?</div>
        <div className="field">
          <label htmlFor="notes">Observações para a secretaria (opcional)</label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <label className="checkbox" style={{ marginBottom: '1rem' }}>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>Declaro que as informações são verdadeiras e desejo renovar a matrícula.</span>
        </label>

        <button className="btn btn-primary btn-block" disabled={!accepted || busy || !detail.can_submit}>
          {busy ? 'Enviando…' : 'Enviar para a escola'}
        </button>
      </div>
    </form>
  );
}
