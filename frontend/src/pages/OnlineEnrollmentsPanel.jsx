import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

const TZ = 'America/Sao_Paulo';
const when = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ }) : '';
const cpfText = v => v ? v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : '—';
const civil = d => d?.slice(0, 10).split('-').reverse().join('/') || '';
export const STATES = { convidada: 'Aguardando a família', enviada: 'Para analisar', correcao: 'Correção pedida', aprovada: 'Matriculada', recusada: 'Não confirmada' };
const STATE_CLASS = { convidada: 'status pending', enviada: 'status pending', correcao: 'status pending', aprovada: 'status approved', recusada: 'status' };
const REQUIREMENTS = [['child_cpf','CPF da criança'],['child_health','Saúde e alergias da criança'],['guardian_cpf','CPF dos responsáveis'],
  ['guardian_email','E-mail do responsável'],['address','Endereço completo'],['second_guardian','Segundo responsável']];
const DECISION = { aprovada: 'Aprovada', correcao: 'Correção pedida', recusada: 'Não confirmada' };

function waLink(phone, text) {
  const digits = (phone || '').replace(/\D/g, '');
  const number = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits.length >= 12 ? digits : null;
  return number && `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
export function linkMessage(guardianName, childName, token) {
  const url = `${location.origin}/matricula/${token}`;
  return { url, text: `Olá, ${guardianName.split(' ')[0]}! Pelo link abaixo você completa a matrícula de ${childName} pelo celular, sem papel:\n${url}\nPara entrar, confirme a data de nascimento da criança. O link é pessoal e vale por 15 dias.` };
}

export function useOnlineSender() {
  const { online } = useAuth();
  const attempt = useRef(null);
  const [busy, setBusy] = useState(false);
  const send = useCallback(async (path, payload) => {
    const body = JSON.stringify(payload);
    if (!attempt.current || attempt.current.signature !== `${path}:${body}`) attempt.current = { signature: `${path}:${body}`, key: crypto.randomUUID() };
    setBusy(true);
    try { const result = await online(path, { method: 'POST', body, headers: { 'Idempotency-Key': attempt.current.key } }); attempt.current = null; return result; }
    finally { setBusy(false); }
  }, [online]);
  return [send, busy];
}

// Mensagem pronta para o WhatsApp com o link recém-gerado (o token só existe nesta resposta).
export function LinkNotice({ guardianName, guardianPhone, childName, token, onClose }) {
  const { url, text } = linkMessage(guardianName, childName, token);
  const wa = waLink(guardianPhone, text);
  const [copied, setCopied] = useState(false);
  return <div className="link-notice" role="status">
    <strong>Link da matrícula online gerado</strong>
    <p className="message-preview">{text}</p>
    <div className="structure-tabs">
      {wa && <a className="primary-link whatsapp-link" href={wa} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a>}
      <button type="button" className="secondary-button" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})}>{copied ? 'Mensagem copiada' : 'Copiar mensagem'}</button>
      <a className="secondary-button" href={url} target="_blank" rel="noreferrer">Abrir link</a>
      {onClose && <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>}
    </div>
    <p>Gerar outro link cancela este. Guarde a mensagem agora: o link não é mostrado de novo.</p>
  </div>;
}

export default function OnlineEnrollmentsPanel() {
  const { online } = useAuth();
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    online(`applications?page=${page}${state ? `&state=${state}` : ''}`, { signal: controller.signal })
      .then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [online, state, page, revision]);
  const refresh = () => setRevision(n => n + 1);
  return <>
    {error && <div className="error-message" role="alert">{error}</div>}
    <nav className="structure-tabs" aria-label="Situação das matrículas online">
      <button className={!state ? 'primary-button' : 'secondary-button'} onClick={() => { setState(''); setPage(1); }}>Todas</button>
      {Object.entries(STATES).map(([key, label]) => <button key={key} className={state === key ? 'primary-button' : 'secondary-button'} onClick={() => { setState(key); setPage(1); }}>{label}</button>)}
      <button className="secondary-button" onClick={() => setCreating(c => !c)}>{creating ? 'Fechar' : 'Nova ficha'}</button>
      <button className="secondary-button" onClick={() => setSettingsOpen(o => !o)}>{settingsOpen ? 'Fechar regras' : 'Regras da escola'}</button>
    </nav>
    {settingsOpen && <Settings />}
    {creating && <NewApplication onCreated={id => { setCreating(false); setSelected(id); refresh(); }} />}
    {selected && <ApplicationDetail id={selected} onChange={refresh} onClose={() => setSelected(null)} />}
    <section className="panel"><h2>Matrículas online</h2>
      {!data ? <p role="status">Carregando…</p> : !data.items.length ? <p>Nenhuma ficha nesta situação.</p> :
        <div className="table-wrapper"><table>
          <thead><tr><th>Criança</th><th>Responsável</th><th>Enviada em</th><th>Situação</th><th></th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.id}>
            <td>{item.child_name} · nasc. {civil(item.child_birth_date)}</td>
            <td>{item.guardian_name} · {item.guardian_phone}</td>
            <td>{item.submitted_at ? when(item.submitted_at) : '—'}</td>
            <td><span className={STATE_CLASS[item.state]}>{STATES[item.state]}</span></td>
            <td><button className="secondary-button" onClick={() => setSelected(item.id)} aria-label={`Abrir ficha de ${item.child_name}`}>Abrir</button></td>
          </tr>)}</tbody>
        </table></div>}
      <div className="structure-tabs"><button className="secondary-button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
        <span>Página {page}</span><button className="secondary-button" disabled={!data?.has_more} onClick={() => setPage(p => p + 1)}>Próxima</button></div>
    </section>
  </>;
}

function Settings() {
  const { online } = useAuth();
  const [send, busy] = useOnlineSender();
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { online('settings').then(d => setForm({ required_fields: d.item.required_fields, terms_text: d.item.terms_text ?? '' })).catch(e => setError(e.message)); }, [online]);
  if (!form) return <section className="panel">{error ? <div className="error-message" role="alert">{error}</div> : <p role="status">Carregando…</p>}</section>;
  const toggle = key => setForm(f => ({ ...f, required_fields: f.required_fields.includes(key) ? f.required_fields.filter(k => k !== key) : [...f.required_fields, key] }));
  async function save(e) {
    e.preventDefault(); setMessage(''); setError('');
    try { if (await send('settings', { required_fields: form.required_fields, terms_text: form.terms_text.trim() || null })) setMessage('Regras salvas. Valem para as próximas fichas enviadas.'); }
    catch (err) { setError(err.message); }
  }
  return <section className="panel"><h2>Regras da escola para a matrícula online</h2>
    <p>Nome e nascimento da criança, um responsável legal e financeiro, e a declaração de veracidade são sempre exigidos. Escolha o que mais a escola exige.</p>
    {message && <p className="success-message" role="status">{message}</p>}
    {error && <div className="error-message" role="alert">{error}</div>}
    <form className="structure-form" onSubmit={save}><fieldset disabled={busy}>
      {REQUIREMENTS.map(([key, label]) => <label key={key} className="check-label"><input type="checkbox" checked={form.required_fields.includes(key)} onChange={() => toggle(key)} /> {label}</label>)}
      <label className="wide">Regulamento (opcional, a família precisa aceitar)<textarea rows={6} maxLength={20000} value={form.terms_text} onChange={e => setForm(f => ({ ...f, terms_text: e.target.value }))} /></label>
      <button className="primary-button" disabled={busy}>Salvar regras</button>
    </fieldset></form>
  </section>;
}

function NewApplication({ onCreated }) {
  const [send, busy] = useOnlineSender();
  const [form, setForm] = useState({ child_name: '', child_birth_date: '', guardian_name: '', guardian_phone: '' });
  const [error, setError] = useState('');
  const field = e => { const { name, value } = e.target; setForm(f => ({ ...f, [name]: value })); };
  async function save(e) {
    e.preventDefault(); setError('');
    try { const result = await send('applications', Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]))); if (result) onCreated(result.item.id); }
    catch (err) { setError(err.message); }
  }
  return <section className="panel"><h2>Nova ficha de matrícula online</h2>
    <p>Para famílias que não passaram pela captação. Depois de criar, gere o link e envie pelo WhatsApp.</p>
    {error && <div className="error-message" role="alert">{error}</div>}
    <form className="structure-form" onSubmit={save}><fieldset disabled={busy}>
      <label>Nome da criança<input name="child_name" required maxLength={150} value={form.child_name} onChange={field} /></label>
      <label>Nascimento<input name="child_birth_date" type="date" required value={form.child_birth_date} onChange={field} /></label>
      <label>Responsável<input name="guardian_name" required maxLength={150} value={form.guardian_name} onChange={field} /></label>
      <label>WhatsApp com DDD<input name="guardian_phone" type="tel" required maxLength={30} value={form.guardian_phone} onChange={field} /></label>
      <button className="primary-button" disabled={busy}>Criar ficha</button>
    </fieldset></form>
  </section>;
}

function FichaView({ data }) {
  const a = data.address || {};
  const address = [a.street && `${a.street}${a.number ? `, ${a.number}` : ''}`, a.complement, a.district, a.city && `${a.city}${a.state ? `/${a.state}` : ''}`, a.zip_code].filter(Boolean).join(' · ');
  return <div className="ficha">
    <dl className="details-grid lead-data">
      <div><span>Criança</span><strong>{data.child.full_name}</strong></div>
      <div><span>Nome social</span><strong>{data.child.social_name || '—'}</strong></div>
      <div><span>CPF</span><strong>{cpfText(data.child.cpf)}</strong></div>
      <div><span>Saúde e alergias</span><strong>{data.child.health_notes || '—'}</strong></div>
      <div><span>Endereço</span><strong>{address || '—'}</strong></div>
    </dl>
    {data.guardians.map((g, i) => <dl key={i} className="details-grid lead-data">
      <div><span>{i === 0 ? 'Responsável' : 'Segundo responsável'}</span><strong>{g.full_name} ({g.relationship})</strong></div>
      <div><span>WhatsApp</span><strong>{g.phone}</strong></div>
      <div><span>E-mail</span><strong>{g.email || '—'}</strong></div>
      <div><span>CPF</span><strong>{cpfText(g.cpf)}</strong></div>
      <div><span>Papel</span><strong>{[g.is_legal && 'Responsável legal', g.is_financial && 'Responsável financeiro'].filter(Boolean).join(' · ') || '—'}</strong></div>
    </dl>)}
  </div>;
}

function ApplicationDetail({ id, onChange, onClose }) {
  const { online, structure } = useAuth();
  const [send, busy] = useOnlineSender();
  const [item, setItem] = useState(null);
  const [refs, setRefs] = useState({ groups: [], levels: [], years: [] });
  const [token, setToken] = useState(null);
  const [review, setReview] = useState({ class_group_id: '', level_id: '', note: '' });
  const [birth, setBirth] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function all(resource) { const items = []; let page = 1; for (;;) { const d = await structure(`${resource}?page=${page++}`, { signal: controller.signal }); items.push(...d.items); if (!d.has_more) return items; } }
    Promise.all([online(`applications/${id}`, { signal: controller.signal }), all('class-groups'), all('levels'), all('academic-years')])
      .then(([detail, groups, levels, years]) => { setItem(detail.item); setRefs({ groups, levels, years }); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [online, structure, id, revision]);
  async function act(path, payload, done) {
    setError(''); setMessage('');
    try { const result = await send(path, payload); if (result) { done(result); setRevision(n => n + 1); onChange(); } }
    catch (e) { setError(e.message); }
  }
  if (!item) return <section className="panel">{error ? <div className="error-message" role="alert">{error}</div> : <p role="status">Carregando ficha…</p>}</section>;
  const latest = item.submissions[0];
  const pending = item.state === 'enviada' && latest && !latest.decision;
  const group = refs.groups.find(g => g.id === review.class_group_id);
  const yearCode = g => refs.years.find(y => y.id === g.academic_year_id)?.code || '';
  const levels = refs.levels.filter(l => group?.level_ids.includes(l.id));
  const activeLink = item.links.find(l => !l.revoked && new Date(l.expires_at) > new Date());
  const open = !['aprovada','recusada'].includes(item.state);
  const corrected = item.birth_date_corrections?.[0];
  return <section className="panel lead-detail" aria-label={`Ficha de ${item.child_name}`}>
    <div className="panel-heading"><div><h2>{item.child_name}</h2>
      <p>Nascimento {civil(item.child_birth_date)}{corrected ? ` (corrigido em ${when(corrected.created_at)})` : ''} · {item.guardian_name} · {item.guardian_phone}</p></div>
      <span className={STATE_CLASS[item.state]}>{STATES[item.state]}</span></div>
    {message && <p className="success-message" role="status">{message}</p>}
    {error && <div className="error-message" role="alert">{error}</div>}
    {token && <LinkNotice guardianName={item.guardian_name} guardianPhone={item.guardian_phone} childName={item.child_name} token={token} onClose={() => setToken(null)} />}
    <div className="structure-tabs">
      {open && <button className="primary-button" disabled={busy} onClick={() => act('links', { application_id: item.id }, r => setToken(r.token))}>{activeLink ? 'Gerar novo link' : 'Gerar link para a família'}</button>}
      <button className="secondary-button" onClick={onClose}>Fechar</button>
    </div>
    <p>{activeLink ? `Link ativo até ${when(activeLink.expires_at)} · ${activeLink.accesses} acesso(s) da família.` : 'Nenhum link ativo.'}</p>
    {open && <details><summary>Corrigir data de nascimento</summary>
      <form className="structure-form" onSubmit={e => { e.preventDefault(); act('birth-date-corrections', { application_id: item.id, child_birth_date: birth },
        () => { setBirth(''); setMessage('Data de nascimento corrigida. A família entra pelo mesmo link com a nova data.'); }); }}><fieldset disabled={busy}>
        <label>Data correta<input type="date" required value={birth} onChange={e => setBirth(e.target.value)} /></label>
        <p className="wide">A família confirma esta data para abrir o link. Corrigir libera quem ficou bloqueado por causa da data errada.</p>
        <div className="structure-tabs wide"><button className="primary-button" disabled={busy || !birth || birth === item.child_birth_date}>Salvar data correta</button></div>
      </fieldset></form></details>}

    {latest ? <><h3>Ficha enviada em {when(latest.created_at)}</h3><FichaView data={latest.data} /></> : <p>A família ainda não enviou a ficha.</p>}

    {pending && <form className="structure-form" onSubmit={e => e.preventDefault()}><fieldset disabled={busy}>
      <h3 className="wide">Decisão</h3>
      <div><label htmlFor="review-group">Turma</label><select id="review-group" value={review.class_group_id} onChange={e => setReview(r => ({ ...r, class_group_id: e.target.value, level_id: '' }))}>
        <option value="">Selecione</option>{refs.groups.map(g => <option key={g.id} value={g.id}>{g.code} · {yearCode(g)}</option>)}</select></div>
      <div><label htmlFor="review-level">Série ou grupo</label><select id="review-level" value={review.level_id} onChange={e => setReview(r => ({ ...r, level_id: e.target.value }))}>
        <option value="">Selecione</option>{levels.map(l => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></div>
      <label className="wide">Mensagem para a família (obrigatória para correção ou recusa)<input maxLength={1000} value={review.note} onChange={e => setReview(r => ({ ...r, note: e.target.value }))} /></label>
      <div className="structure-tabs wide">
        <button type="button" className="primary-button" disabled={busy || !review.class_group_id || !review.level_id}
          onClick={() => act('reviews', { submission_id: latest.id, decision: 'aprovada', class_group_id: review.class_group_id, level_id: review.level_id, note: review.note.trim() || null }, () => setMessage('Matrícula aprovada: aluno, responsáveis e matrícula criados.'))}>Aprovar e matricular</button>
        <button type="button" className="secondary-button" disabled={busy || !review.note.trim()}
          onClick={() => act('reviews', { submission_id: latest.id, decision: 'correcao', note: review.note.trim() }, () => setMessage('Correção pedida. A família vê a mensagem pelo mesmo link.'))}>Pedir correção</button>
        <button type="button" className="secondary-button" disabled={busy || !review.note.trim()}
          onClick={() => act('reviews', { submission_id: latest.id, decision: 'recusada', note: review.note.trim() }, () => setMessage('Matrícula não confirmada.'))}>Não confirmar</button>
      </div>
      <p className="wide">Ao aprovar, o sistema cria o aluno, os responsáveis, os vínculos e a matrícula na turma escolhida.</p>
    </fieldset></form>}

    {item.submissions.length > 0 && <><h3>Histórico</h3><ul className="history">{item.submissions.map(s => <li key={s.id}>
      <strong>{when(s.created_at)}</strong> · ficha enviada{s.decision ? ` · ${DECISION[s.decision]} em ${when(s.reviewed_at)}${s.note ? `: “${s.note}”` : ''}` : ' · aguardando análise'}
    </li>)}</ul></>}
  </section>;
}
