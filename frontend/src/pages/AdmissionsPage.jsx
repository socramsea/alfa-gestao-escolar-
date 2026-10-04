import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import OnlineEnrollmentsPanel, { LinkNotice } from './OnlineEnrollmentsPanel.jsx';

const TZ = 'America/Sao_Paulo';
const civil = date => date?.slice(0, 10).split('-').reverse().join('/') || '';
const when = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ }) : '';
const dayOf = iso => {
  const text = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: TZ });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const timeOf = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const STATUS = { novo: 'Novo contato', em_contato: 'Em contato', visita_agendada: 'Visita agendada', visitou: 'Visitou',
  matriculado: 'Matriculado', desistiu: 'Desistiu' };
const STATUS_CLASS = { novo: 'status pending', em_contato: 'status pending', visita_agendada: 'status pending',
  visitou: 'status pending', matriculado: 'status approved', desistiu: 'status' };
const SOURCES = [['whatsapp','WhatsApp'],['indicacao','Indicação'],['instagram','Instagram'],['presencial','Na escola'],['outro','Outro']];
const SOURCE_LABEL = Object.fromEntries([['site','Site'], ...SOURCES]);
const INTEREST = { visita: 'Quer visitar', matricula: 'Quer matricular', informacoes: 'Informações' };
const OUTCOME = { compareceu: 'Compareceu', nao_compareceu: 'Não compareceu', cancelada: 'Cancelada' };
const tabs = [['leads','Interessados'],['slots','Visitas'],['online','Matrícula online'],['site','Site da escola']];

function waLink(phone, text) {
  const digits = (phone || '').replace(/\D/g, '');
  const number = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits.length >= 12 ? digits : null;
  return number && `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

// Envio com chave de idempotência estável enquanto o conteúdo não muda.
function useSender(admissions) {
  const attempt = useRef(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const send = useCallback(async (path, payload, extra = {}) => {
    if (saving.current) return null;
    saving.current = true; setBusy(true);
    const body = payload instanceof Blob ? payload : JSON.stringify(payload);
    const signature = payload instanceof Blob ? `${path}:${payload.name}:${payload.size}:${payload.lastModified}` : `${path}:${body}`;
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await admissions(path, { method: 'POST', body, headers: { 'Idempotency-Key': attempt.current.key, ...extra } });
      attempt.current = null;
      return result;
    } finally { saving.current = false; setBusy(false); }
  }, [admissions]);
  return [send, busy];
}

export default function AdmissionsPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('leads');
  return <main className="dashboard-page">
    <header className="topbar"><div><strong>Alfa Gestão Escolar</strong><span>{user.name}</span></div>
      <button className="secondary-button" onClick={logout}>Sair</button></header>
    <div className="page-content">
      <nav className="structure-tabs" aria-label="Áreas da secretaria"><Link to="/secretaria">Estrutura escolar</Link><Link to="/secretaria/pessoas">Alunos e responsáveis</Link><Link to="/secretaria/matriculas">Matrículas</Link><Link to="/secretaria/profissionais">Profissionais</Link><Link to="/secretaria/captacao" aria-current="page">Captação</Link></nav>
      <h1>Captação</h1>
      <p>Famílias interessadas, visitas e o site da escola. A pré-matrícula feita no site chega aqui. Use dados fictícios neste piloto.</p>
      <nav className="structure-tabs" aria-label="Áreas da captação">{tabs.map(([key, label]) =>
        <button key={key} className={tab === key ? 'primary-button' : 'secondary-button'} aria-current={tab === key ? 'page' : undefined}
          onClick={() => setTab(key)}>{label}</button>)}</nav>
      {tab === 'leads' ? <Leads /> : tab === 'slots' ? <Slots /> : tab === 'online' ? <OnlineEnrollmentsPanel /> : <SiteEditor />}
    </div>
  </main>;
}

// Interessados ---------------------------------------------------------------

function Leads() {
  const { admissions } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    admissions(`leads?page=${page}${status ? `&status=${status}` : ''}`, { signal: controller.signal })
      .then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [admissions, status, page, revision]);
  const refresh = () => setRevision(n => n + 1);
  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;

  return <>
    {error && <div className="error-message" role="alert">{error}</div>}
    <nav className="structure-tabs" aria-label="Situação dos interessados">
      <button className={!status ? 'primary-button' : 'secondary-button'} onClick={() => { setStatus(''); setPage(1); }}>Todos ({total})</button>
      {Object.entries(STATUS).map(([key, label]) => <button key={key} className={status === key ? 'primary-button' : 'secondary-button'}
        onClick={() => { setStatus(key); setPage(1); }}>{label} ({data?.counts[key] ?? 0})</button>)}
      <button className="secondary-button" onClick={() => setCreating(c => !c)}>{creating ? 'Fechar cadastro' : 'Registrar contato'}</button>
    </nav>
    {creating && <ManualLead onCreated={id => { setCreating(false); setSelected(id); refresh(); }} />}
    {selected && <LeadDetail id={selected} onChange={refresh} onClose={() => setSelected(null)} />}
    <section className="panel"><h2>Interessados</h2>
      {!data ? <p role="status">Carregando…</p> : !data.items.length ? <p>Nenhum interessado nesta situação.</p> :
        <div className="table-wrapper"><table>
          <thead><tr><th>Protocolo</th><th>Criança</th><th>Responsável</th><th>Interesse</th><th>Próxima visita</th><th>Situação</th><th></th></tr></thead>
          <tbody>{data.items.map(l => <tr key={l.id}>
            <td>{l.protocol}</td>
            <td>{l.child_name}{l.desired_level ? ` · ${l.desired_level}` : ''}</td>
            <td>{l.guardian_name} · {l.guardian_phone}</td>
            <td>{INTEREST[l.interest]} · {SOURCE_LABEL[l.source]} · {civil(l.created_at)}</td>
            <td>{l.next_visit_at ? when(l.next_visit_at) : '—'}</td>
            <td><span className={STATUS_CLASS[l.status]}>{STATUS[l.status]}</span></td>
            <td><button className="secondary-button" onClick={() => setSelected(l.id)} aria-label={`Abrir ${l.protocol}`}>Abrir</button></td>
          </tr>)}</tbody>
        </table></div>}
      <div className="structure-tabs"><button className="secondary-button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
        <span>Página {page}</span><button className="secondary-button" disabled={!data?.has_more} onClick={() => setPage(p => p + 1)}>Próxima</button></div>
    </section>
  </>;
}

const manualBlank = () => ({ source: 'whatsapp', interest: 'visita', child_name: '', child_birth_date: '', desired_level: '',
  guardian_name: '', guardian_phone: '', guardian_email: '', message: '' });

function ManualLead({ onCreated }) {
  const { admissions } = useAuth();
  const [send, busy] = useSender(admissions);
  const [form, setForm] = useState(manualBlank);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const field = e => { const { name, value } = e.target; setForm(f => ({ ...f, [name]: value })); };
  async function save(e) {
    e.preventDefault(); setError('');
    const payload = { ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null])), consent };
    try { const result = await send('leads', payload); if (result) onCreated(result.item.id); }
    catch (err) { setError(err.message); }
  }
  return <section className="panel"><h2>Registrar contato</h2>
    <p>Para famílias que chegaram pelo WhatsApp, por indicação ou na portaria.</p>
    {error && <div className="error-message" role="alert">{error}</div>}
    <form className="structure-form" onSubmit={save}><fieldset disabled={busy}>
      <div><label htmlFor="lead-source">Origem</label><select id="lead-source" name="source" value={form.source} onChange={field}>{SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div><label htmlFor="lead-interest">Interesse</label><select id="lead-interest" name="interest" value={form.interest} onChange={field}>{Object.entries(INTEREST).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <label>Nome da criança<input name="child_name" required maxLength={150} value={form.child_name} onChange={field} /></label>
      <label>Nascimento (opcional)<input name="child_birth_date" type="date" value={form.child_birth_date} onChange={field} /></label>
      <label>Turma de interesse (opcional)<input name="desired_level" maxLength={80} value={form.desired_level} onChange={field} /></label>
      <label>Responsável<input name="guardian_name" required maxLength={150} value={form.guardian_name} onChange={field} /></label>
      <label>WhatsApp com DDD<input name="guardian_phone" required type="tel" maxLength={30} value={form.guardian_phone} onChange={field} /></label>
      <label>E-mail (opcional)<input name="guardian_email" type="email" maxLength={150} value={form.guardian_email} onChange={field} /></label>
      <label>Observação (opcional)<input name="message" maxLength={1000} value={form.message} onChange={field} /></label>
      <label className="check-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> A família autorizou o contato da escola</label>
      <button className="primary-button" disabled={busy || !consent}>{busy ? 'Salvando…' : 'Registrar contato'}</button>
    </fieldset></form>
  </section>;
}

function StartOnline({ lead, onDone }) {
  const { online } = useAuth();
  const [birth, setBirth] = useState(lead.child_birth_date || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState(null);
  const keys = useRef({});
  async function start(e) {
    e.preventDefault(); setBusy(true); setError('');
    const post = (path, body) => { const sig = `${path}:${JSON.stringify(body)}`; keys.current[sig] ??= crypto.randomUUID();
      return online(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': keys.current[sig] } }); };
    try {
      const app = await post('applications', { lead_id: lead.id, ...(lead.child_birth_date ? {} : { child_birth_date: birth }) });
      const link = await post('links', { application_id: app.item.id });
      setToken(link.token); onDone();
    } catch (err) { setError(err.status === 409 ? 'Este interessado já tem matrícula online. Gere o link na aba Matrícula online.' : err.message); }
    finally { setBusy(false); }
  }
  if (token) return <LinkNotice guardianName={lead.guardian_name} guardianPhone={lead.guardian_phone} childName={lead.child_name} token={token} />;
  return <form className="structure-form" onSubmit={start}><fieldset disabled={busy}>
    {error && <div className="error-message wide" role="alert">{error}</div>}
    {!lead.child_birth_date && <label>Nascimento da criança (a família usa para entrar)<input type="date" required value={birth} onChange={e => setBirth(e.target.value)} /></label>}
    <button className="primary-button" disabled={busy || !birth}>Iniciar matrícula online</button>
  </fieldset></form>;
}

function LeadDetail({ id, onChange, onClose }) {
  const { admissions } = useAuth();
  const [send, busy] = useSender(admissions);
  const [lead, setLead] = useState(null);
  const [slots, setSlots] = useState([]);
  const [note, setNote] = useState('');
  const [slot, setSlot] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([admissions(`leads/${id}`, { signal: controller.signal }), admissions('visit-slots', { signal: controller.signal })])
      .then(([detail, agenda]) => { setLead(detail.item); setSlots(agenda.items); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [admissions, id, revision]);
  async function act(path, payload, message) {
    setError(''); setSuccess('');
    try { if (await send(path, payload)) { setSuccess(message); setNote(''); setSlot(''); setRevision(n => n + 1); onChange(); } }
    catch (e) { setError(e.message); }
  }
  if (!lead) return <section className="panel">{error ? <div className="error-message" role="alert">{error}</div> : <p role="status">Carregando atendimento…</p>}</section>;
  const open = !['matriculado','desistiu'].includes(lead.status);
  const free = slots.filter(s => !s.closed && s.bookings.length < s.capacity && new Date(s.starts_at) > new Date());
  const contact = waLink(lead.guardian_phone, `Olá, ${lead.guardian_name.split(' ')[0]}! Aqui é da escola. Recebemos seu interesse na matrícula de ${lead.child_name} (protocolo ${lead.protocol}) e queremos ajudar.`);
  return <section className="panel lead-detail" aria-label={`Atendimento ${lead.protocol}`}>
    <div className="panel-heading"><div><h2>{lead.child_name} · {lead.protocol}</h2>
      <p>{SOURCE_LABEL[lead.source]} · {INTEREST[lead.interest]} · recebido em {when(lead.created_at)}</p></div>
      <span className={STATUS_CLASS[lead.status]}>{STATUS[lead.status]}</span></div>
    {success && <p className="success-message" role="status">{success}</p>}
    {error && <div className="error-message" role="alert">{error}</div>}
    <dl className="details-grid lead-data">
      <div><span>Responsável</span><strong>{lead.guardian_name}</strong></div>
      <div><span>WhatsApp</span><strong>{lead.guardian_phone}</strong></div>
      <div><span>E-mail</span><strong>{lead.guardian_email || '—'}</strong></div>
      <div><span>Nascimento</span><strong>{civil(lead.child_birth_date) || '—'}</strong></div>
      <div><span>Turma de interesse</span><strong>{lead.desired_level || '—'}</strong></div>
      <div><span>Como conheceu</span><strong>{lead.how_heard || '—'}</strong></div>
    </dl>
    {lead.message && <p className="lead-message"><strong>Mensagem:</strong> {lead.message}</p>}
    <div className="structure-tabs">
      {contact && <a className="primary-link whatsapp-link" href={contact} target="_blank" rel="noreferrer">Conversar no WhatsApp</a>}
      {open && <>
        {lead.status === 'novo' && <button className="secondary-button" disabled={busy} onClick={() => act('lead-updates', { lead_id: lead.id, status: 'em_contato' }, 'Marcado como em contato.')}>Marcar em contato</button>}
        <button className="secondary-button" disabled={busy} onClick={() => act('lead-updates', { lead_id: lead.id, status: 'matriculado', note: note.trim() || null }, 'Marcado como matriculado.')}>Matriculado</button>
        <button className="secondary-button" disabled={busy || !note.trim()} title="Escreva o motivo na anotação" onClick={() => act('lead-updates', { lead_id: lead.id, status: 'desistiu', note: note.trim() }, 'Atendimento encerrado com o motivo informado.')}>Desistiu (informe o motivo)</button>
      </>}
      <button className="secondary-button" onClick={onClose}>Fechar</button>
    </div>
    <form className="structure-form" onSubmit={e => { e.preventDefault(); if (note.trim()) act('lead-updates', { lead_id: lead.id, note: note.trim() }, 'Anotação registrada.'); }}>
      <fieldset disabled={busy}>
        <label>Anotação<input maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Ex.: pediu valores do integral" /></label>
        <button className="primary-button" disabled={busy || !note.trim()}>Salvar anotação</button>
      </fieldset>
    </form>
    {open && <StartOnline lead={lead} onDone={onChange} />}
    {open && <form className="structure-form" onSubmit={e => { e.preventDefault(); act('visit-bookings', { lead_id: lead.id, slot_id: slot }, lead.active_booking_id ? 'Visita remarcada.' : 'Visita agendada.'); }}>
      <fieldset disabled={busy}>
        <div><label htmlFor="lead-slot">{lead.active_booking_id ? 'Remarcar visita' : 'Agendar visita'}</label><select id="lead-slot" required value={slot} onChange={e => setSlot(e.target.value)}>
          <option value="">{free.length ? 'Selecione o horário' : 'Nenhum horário livre: abra horários na aba Visitas'}</option>
          {free.map(s => <option key={s.id} value={s.id}>{dayOf(s.starts_at)}, {timeOf(s.starts_at)} · {s.capacity - s.bookings.length} vaga(s)</option>)}
        </select></div>
        <button className="primary-button" disabled={busy || !slot}>{lead.active_booking_id ? 'Remarcar' : 'Agendar'}</button>
      </fieldset>
    </form>}
    <h3>Visitas</h3>
    {!lead.bookings.length ? <p>Nenhuma visita agendada.</p> : <ul className="history">{lead.bookings.map(b => <li key={b.id}>
      <strong>{when(b.starts_at)}</strong> · {b.outcome ? OUTCOME[b.outcome] : 'Agendada'}
      {!b.outcome && <span className="inline-actions">
        <button className="secondary-button" disabled={busy} onClick={() => act('visit-outcomes', { booking_id: b.id, outcome: 'compareceu' }, 'Comparecimento registrado.')}>Compareceu</button>
        <button className="secondary-button" disabled={busy} onClick={() => act('visit-outcomes', { booking_id: b.id, outcome: 'nao_compareceu' }, 'Falta registrada.')}>Não compareceu</button>
        <button className="secondary-button" disabled={busy} onClick={() => act('visit-outcomes', { booking_id: b.id, outcome: 'cancelada' }, 'Visita cancelada.')}>Cancelar</button>
      </span>}
    </li>)}</ul>}
    <h3>Histórico</h3>
    <ul className="history">
      <li><strong>{when(lead.created_at)}</strong> · Contato recebido {lead.source === 'site' ? 'pelo site' : `(${SOURCE_LABEL[lead.source]})`}</li>
      {lead.updates.map(u => <li key={u.id}><strong>{when(u.created_at)}</strong> · {u.status ? STATUS[u.status] : 'Anotação'}
        {u.note ? `: “${u.note}”` : ''}{u.author_name ? ` · ${u.author_name}` : ''}</li>)}
    </ul>
  </section>;
}

// Visitas --------------------------------------------------------------------

const WEEKDAYS = [[1,'Seg'],[2,'Ter'],[3,'Qua'],[4,'Qui'],[5,'Sex'],[6,'Sáb']];
const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Slots() {
  const { admissions } = useAuth();
  const [send, busy] = useSender(admissions);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [revision, setRevision] = useState(0);
  const [weekdays, setWeekdays] = useState([1,2,3,4,5]);
  const [times, setTimes] = useState('09:00, 14:30');
  const [weeks, setWeeks] = useState(3);
  const [capacity, setCapacity] = useState(3);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    admissions('visit-slots', { signal: controller.signal }).then(d => setItems(d.items))
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [admissions, revision]);
  const days = useMemo(() => {
    const groups = new Map();
    for (const s of items || []) groups.set(dayOf(s.starts_at), [...(groups.get(dayOf(s.starts_at)) || []), s]);
    return [...groups.entries()];
  }, [items]);

  async function create(e) {
    e.preventDefault(); setError(''); setSuccess('');
    const list = times.split(/[,\s]+/).filter(Boolean);
    if (!list.length || list.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) { setError('Informe horários no formato HH:MM, separados por vírgula.'); return; }
    const dates = Array.from({ length: weeks * 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i + 1); return d; })
      .filter(d => weekdays.includes(d.getDay())).map(localIso);
    setCreating(true);
    let created = 0, existing = 0;
    try {
      // Cada horário é um pedido próprio com chave de idempotência: repetir não duplica.
      for (const date of dates) for (const time of list) {
        try {
          await admissions('visit-slots', { method: 'POST', body: JSON.stringify({ date, time, capacity: Number(capacity) }),
            headers: { 'Idempotency-Key': crypto.randomUUID() } });
          created++;
        } catch (err) { if (err.status === 409) existing++; else throw err; }
      }
      setSuccess(`${created} horário(s) aberto(s)${existing ? `; ${existing} já existia(m)` : ''}.`);
    } catch (err) { setError(`${err.message} ${created} horário(s) foram abertos antes da falha.`); }
    finally { setCreating(false); setRevision(n => n + 1); }
  }
  async function close(slot) {
    setError(''); setSuccess('');
    try { if (await send('visit-slot-closures', { slot_id: slot.id })) { setSuccess('Horário fechado.'); setRevision(n => n + 1); } }
    catch (err) { setError(err.status === 409 ? 'Este horário tem visita agendada: remarque ou cancele antes de fechar.' : err.message); }
  }

  return <>
    {success && <p className="success-message" role="status">{success}</p>}
    {error && <div className="error-message" role="alert">{error}</div>}
    <section className="panel"><h2>Abrir horários de visita</h2>
      <p>Os horários livres aparecem no site para as famílias escolherem. Horários no fuso de Brasília.</p>
      <form className="structure-form" onSubmit={create}><fieldset disabled={creating || busy}>
        <div><span className="field-label">Dias da semana</span><div className="structure-tabs compact">{WEEKDAYS.map(([v, l]) =>
          <button type="button" key={v} className={weekdays.includes(v) ? 'primary-button' : 'secondary-button'} aria-pressed={weekdays.includes(v)}
            onClick={() => setWeekdays(w => w.includes(v) ? w.filter(x => x !== v) : [...w, v])}>{l}</button>)}</div></div>
        <label>Horários<input value={times} onChange={e => setTimes(e.target.value)} /></label>
        <label>Próximas semanas<input type="number" min={1} max={8} value={weeks} onChange={e => setWeeks(Number(e.target.value))} /></label>
        <label>Famílias por horário<input type="number" min={1} max={20} value={capacity} onChange={e => setCapacity(e.target.value)} /></label>
        <button className="primary-button" disabled={creating || !weekdays.length}>{creating ? 'Abrindo…' : 'Abrir horários'}</button>
      </fieldset></form>
    </section>
    <section className="panel"><h2>Agenda</h2>
      {!items ? <p role="status">Carregando…</p> : !days.length ? <p>Nenhum horário aberto.</p> : days.map(([day, slots]) =>
        <div key={day} className="agenda-day"><h3>{day}</h3>
          <ul className="history">{slots.map(s => <li key={s.id}>
            <strong>{timeOf(s.starts_at)}</strong> · {s.closed ? 'Fechado' : `${s.bookings.filter(b => !b.outcome).length}/${s.capacity} famílias`}
            {!s.closed && !s.bookings.some(b => !b.outcome) && <span className="inline-actions"><button className="secondary-button" disabled={busy} onClick={() => close(s)}>Fechar horário</button></span>}
            {s.bookings.length > 0 && <ul>{s.bookings.map(b => <li key={b.booking_id}>{b.child_name} · {b.guardian_name} · {b.guardian_phone} · {b.protocol}{b.outcome ? ` · ${OUTCOME[b.outcome]}` : ''}</li>)}</ul>}
          </li>)}</ul>
        </div>)}
    </section>
  </>;
}

// Site da escola -------------------------------------------------------------

const EMPTY = { hero: { title: '', subtitle: '', image_id: null }, about: { title: 'Sobre a escola', text: '' },
  highlights: [], routine: [], levels: [], uniform: { intro: '', where_to_buy: '', items: [] }, faq: [],
  location: { address: '', opening_hours: '' }, contact: { whatsapp: '', email: '', instagram: '' },
  enrollment: { open: true, year: null, intro: '' } };
const withDefaults = c => ({ ...EMPTY, ...c, hero: { ...EMPTY.hero, ...c?.hero }, about: { ...EMPTY.about, ...c?.about },
  uniform: { ...EMPTY.uniform, ...c?.uniform }, location: { ...EMPTY.location, ...c?.location },
  contact: { ...EMPTY.contact, ...c?.contact }, enrollment: { ...EMPTY.enrollment, ...c?.enrollment } });
// Strings vazias viram null; linhas de lista sem título são descartadas antes de salvar.
const tidy = c => JSON.parse(JSON.stringify({ ...c,
  highlights: c.highlights.filter(i => i.title.trim()), routine: c.routine.filter(i => i.title.trim()),
  levels: c.levels.filter(i => i.name.trim()), faq: c.faq.filter(i => i.question.trim() && i.answer.trim()),
  uniform: { ...c.uniform, items: c.uniform.items.filter(i => i.name.trim()) } }, (_k, v) => typeof v === 'string' ? (v.trim() || null) : v));

function ListEditor({ label, items, fields, blank, onChange, extra }) {
  const update = (i, patch) => onChange(items.map((it, j) => j === i ? { ...it, ...patch } : it));
  return <div className="list-editor">
    {items.map((item, i) => <fieldset key={i} className="list-item"><legend>{label} {i + 1}</legend>
      {fields.map(([key, title, long]) => <label key={key}>{title}{long
        ? <textarea rows={3} value={item[key] ?? ''} onChange={e => update(i, { [key]: e.target.value })} />
        : <input value={item[key] ?? ''} onChange={e => update(i, { [key]: e.target.value })} />}</label>)}
      {extra?.(item, patch => update(i, patch))}
      <button type="button" className="secondary-button" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remover</button>
    </fieldset>)}
    <button type="button" className="secondary-button" onClick={() => onChange([...items, blank()])}>Adicionar {label.toLowerCase()}</button>
  </div>;
}

function ImageField({ value, onChange }) {
  const { admissions, admissionsImage } = useAuth();
  const [send, busy] = useSender(admissions);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let url = '', live = true;
    if (value) admissionsImage(value).then(u => { url = u; if (live) setPreview(u); else URL.revokeObjectURL(u); }).catch(() => setPreview(''));
    else setPreview('');
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [value, admissionsImage]);
  async function upload(file) {
    setError('');
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { setError('Use foto JPG, PNG ou WebP.'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('A foto deve ter até 2 MB.'); return; }
    try { const result = await send('site/images', file, { 'Content-Type': file.type }); if (result) onChange(result.item.id); }
    catch (err) { setError(err.message); }
  }
  return <div className="image-field">
    {preview && <img src={preview} alt="Prévia da foto" />}
    <label className="secondary-button">{busy ? 'Enviando…' : value ? 'Trocar foto' : 'Enviar foto'}
      <input type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" onChange={e => e.target.files[0] && upload(e.target.files[0])} /></label>
    {value && <button type="button" className="secondary-button" onClick={() => onChange(null)}>Remover foto</button>}
    {error && <span role="alert" className="field-error">{error}</span>}
  </div>;
}

function SiteEditor() {
  const { admissions } = useAuth();
  const [send, busy] = useSender(admissions);
  const [state, setState] = useState(null);
  const [content, setContent] = useState(EMPTY);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    admissions('site', { signal: controller.signal }).then(data => { setState(data); setContent(withDefaults(data.current?.content)); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [admissions, revision]);
  const set = (key, patch) => setContent(c => ({ ...c, [key]: { ...c[key], ...patch } }));
  async function defineAddress(e) {
    e.preventDefault(); setError(''); setSuccess('');
    try { if (await send('site/address', { slug: slug.trim().toLowerCase() })) { setSuccess('Endereço definido.'); setRevision(n => n + 1); } }
    catch (err) { setError(err.status === 409 ? 'Este endereço já está em uso. Escolha outro.' : err.message); }
  }
  async function save(published) {
    setError(''); setSuccess('');
    try {
      if (await send('site/versions', { published, content: tidy(content) })) {
        setSuccess(published ? 'Site salvo e publicado.' : 'Rascunho salvo. O site não está visível ao público.'); setRevision(n => n + 1);
      }
    } catch (err) { setError(err.message); }
  }
  if (!state) return error ? <div className="error-message" role="alert">{error}</div> : <p role="status">Carregando…</p>;
  if (!state.address) return <section className="panel"><h2>Endereço do site</h2>
    <p>Escolha uma vez o endereço público da escola. Ele não poderá ser alterado depois.</p>
    {error && <div className="error-message" role="alert">{error}</div>}
    <form className="structure-form" onSubmit={defineAddress}><fieldset disabled={busy}>
      <label>Endereço (letras minúsculas, números e hífens)<input required minLength={3} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*"
        value={slug} onChange={e => setSlug(e.target.value)} placeholder="alfa-reis" /></label>
      <p>O site ficará em <strong>{location.origin}/escola/{slug || 'endereco'}</strong></p>
      <button className="primary-button" disabled={busy}>Definir endereço</button>
    </fieldset></form>
  </section>;

  const url = `${location.origin}/escola/${state.address.slug}`;
  const published = state.current?.published;
  return <>
    <section className="panel"><div className="panel-heading"><div><h2>Site da escola</h2>
      <p>{published ? 'Publicado' : 'Não publicado'} · <a href={url} target="_blank" rel="noreferrer">{url}</a>{state.current ? ` · última versão em ${when(state.current.created_at)}` : ''}</p></div></div>
      {success && <p className="success-message" role="status">{success}</p>}
      {error && <div className="error-message" role="alert">{error}</div>}
      <div className="structure-tabs"><button className="secondary-button" disabled={busy} onClick={() => save(false)}>{published ? 'Salvar e despublicar' : 'Salvar rascunho'}</button>
        <button className="primary-button" disabled={busy || !content.hero.title.trim()} onClick={() => save(true)}>Salvar e publicar</button></div>
      <p>Cada salvamento cria uma versão nova; as anteriores ficam guardadas.</p>
    </section>
    <form className="structure-form site-editor" onSubmit={e => e.preventDefault()}>
      <section className="panel"><h2>Abertura</h2><fieldset disabled={busy}>
        <label>Título<input required maxLength={120} value={content.hero.title} onChange={e => set('hero', { title: e.target.value })} /></label>
        <label className="wide">Subtítulo<textarea rows={2} maxLength={400} value={content.hero.subtitle ?? ''} onChange={e => set('hero', { subtitle: e.target.value })} /></label>
        <ImageField value={content.hero.image_id} onChange={id => set('hero', { image_id: id })} />
      </fieldset></section>
      <section className="panel"><h2>Sobre a escola</h2><fieldset disabled={busy}>
        <label>Título<input maxLength={120} value={content.about.title} onChange={e => set('about', { title: e.target.value })} /></label>
        <label className="wide">Texto<textarea rows={5} maxLength={3000} value={content.about.text ?? ''} onChange={e => set('about', { text: e.target.value })} /></label>
        <ListEditor label="Diferencial" items={content.highlights} fields={[['title','Título'],['text','Texto',true]]}
          blank={() => ({ title: '', text: '' })} onChange={highlights => setContent(c => ({ ...c, highlights }))} />
      </fieldset></section>
      <section className="panel"><h2>Turmas oferecidas</h2><p>Também aparecem como opção no formulário de pré-matrícula.</p><fieldset disabled={busy}>
        <ListEditor label="Turma" items={content.levels} fields={[['name','Nome'],['ages','Idade'],['shifts','Turnos'],['description','Descrição',true]]}
          blank={() => ({ name: '', ages: '', shifts: '', description: '' })} onChange={levels => setContent(c => ({ ...c, levels }))} />
      </fieldset></section>
      <section className="panel"><h2>Como funciona (rotina)</h2><fieldset disabled={busy}>
        <ListEditor label="Momento" items={content.routine} fields={[['title','Horário e atividade'],['text','Descrição',true]]}
          blank={() => ({ title: '', text: '' })} onChange={routine => setContent(c => ({ ...c, routine }))} />
      </fieldset></section>
      <section className="panel"><h2>Uniforme</h2><p>Envie fotos reais das peças: é uma das dúvidas mais comuns das famílias.</p><fieldset disabled={busy}>
        <label className="wide">Introdução<textarea rows={2} maxLength={1000} value={content.uniform.intro ?? ''} onChange={e => set('uniform', { intro: e.target.value })} /></label>
        <label className="wide">Onde comprar<input maxLength={400} value={content.uniform.where_to_buy ?? ''} onChange={e => set('uniform', { where_to_buy: e.target.value })} /></label>
        <ListEditor label="Peça" items={content.uniform.items} fields={[['name','Peça'],['price','Preço'],['description','Descrição',true]]}
          blank={() => ({ name: '', price: '', description: '', required: true, image_id: null })}
          onChange={items => set('uniform', { items })}
          extra={(item, update) => <>
            <label className="check-label"><input type="checkbox" checked={item.required} onChange={e => update({ required: e.target.checked })} /> Obrigatório</label>
            <ImageField value={item.image_id} onChange={id => update({ image_id: id })} />
          </>} />
      </fieldset></section>
      <section className="panel"><h2>Perguntas frequentes</h2><fieldset disabled={busy}>
        <ListEditor label="Pergunta" items={content.faq} fields={[['question','Pergunta'],['answer','Resposta',true]]}
          blank={() => ({ question: '', answer: '' })} onChange={faq => setContent(c => ({ ...c, faq }))} />
      </fieldset></section>
      <section className="panel"><h2>Localização, contato e matrículas</h2><fieldset disabled={busy}>
        <label className="wide">Endereço da unidade<input maxLength={300} value={content.location.address ?? ''} onChange={e => set('location', { address: e.target.value })} /></label>
        <label>Horário de atendimento<input maxLength={160} value={content.location.opening_hours ?? ''} onChange={e => set('location', { opening_hours: e.target.value })} /></label>
        <label>WhatsApp da escola<input type="tel" maxLength={30} value={content.contact.whatsapp ?? ''} onChange={e => set('contact', { whatsapp: e.target.value })} /></label>
        <label>E-mail<input type="email" maxLength={150} value={content.contact.email ?? ''} onChange={e => set('contact', { email: e.target.value })} /></label>
        <label>Instagram<input maxLength={60} value={content.contact.instagram ?? ''} onChange={e => set('contact', { instagram: e.target.value })} /></label>
        <label className="check-label"><input type="checkbox" checked={content.enrollment.open} onChange={e => set('enrollment', { open: e.target.checked })} /> Mostrar a pré-matrícula no site</label>
        <label>Ano letivo das matrículas<input type="number" min={2000} max={2100} value={content.enrollment.year ?? ''} onChange={e => set('enrollment', { year: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="wide">Chamada da pré-matrícula<textarea rows={2} maxLength={600} value={content.enrollment.intro ?? ''} onChange={e => set('enrollment', { intro: e.target.value })} /></label>
      </fieldset></section>
    </form>
  </>;
}
