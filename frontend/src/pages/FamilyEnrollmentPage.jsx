import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { familyRequest } from '../auth/online-enrollment-api.js';

// A data de nascimento fica só nesta aba: fechou o navegador, confirma de novo.
const storeKey = token => `alfa.matricula.${token.slice(0, 10)}`;
const readBirth = token => { try { return sessionStorage.getItem(storeKey(token)) || ''; } catch { return ''; } };
const saveBirth = (token, value) => { try { if (value) sessionStorage.setItem(storeKey(token), value); else sessionStorage.removeItem(storeKey(token)); } catch { /* indisponível */ } };
const civil = d => d?.split('-').reverse().join('/') || '';
const RELATIONSHIPS = ['Mãe', 'Pai', 'Avó', 'Avô', 'Tia', 'Tio', 'Responsável legal'];
const blankGuardian = (name = '', phone = '') => ({ full_name: name, relationship: '', phone, email: '', cpf: '', is_legal: true, is_financial: false });
const blankAddress = { zip_code: '', street: '', number: '', complement: '', district: '', city: '', state: '' };

function initialForm(info) {
  const last = info.last_submission;
  if (last) return {
    child: { full_name: last.child.full_name, social_name: last.child.social_name ?? '', cpf: last.child.cpf ?? '', health_notes: last.child.health_notes ?? '' },
    guardians: last.guardians.map(g => ({ ...g, email: g.email ?? '', cpf: g.cpf ?? '' })),
    address: { ...blankAddress, ...Object.fromEntries(Object.entries(last.address || {}).map(([k, v]) => [k, v ?? ''])) } };
  return { child: { full_name: info.application.child_name, social_name: '', cpf: '', health_notes: '' },
    guardians: [{ ...blankGuardian(info.application.guardian_name, info.application.guardian_phone), is_financial: true }],
    address: { ...blankAddress } };
}

export default function FamilyEnrollmentPage() {
  const { token } = useParams();
  const [birth, setBirth] = useState(() => readBirth(token));
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(null);

  async function enter(e) {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      const data = await familyRequest('access', { token, birth_date: birth });
      saveBirth(token, birth); setInfo(data); setForm(initialForm(data)); setAccepted(false);
    } catch (err) { saveBirth(token, null); setError(err.message); }
    finally { setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const trimmed = v => typeof v === 'string' ? (v.trim() || null) : v;
    const data = { child: Object.fromEntries(Object.entries(form.child).map(([k, v]) => [k, trimmed(v)])),
      guardians: form.guardians.map(g => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, trimmed(v)]))),
      address: Object.fromEntries(Object.entries(form.address).map(([k, v]) => [k, trimmed(v)])), accept_terms: accepted };
    const body = { token, birth_date: birth, settings_id: info.settings.id, data };
    const signature = JSON.stringify(body);
    // Mesma chave enquanto os dados não mudarem: reenviar após falha de rede não duplica a ficha.
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    try {
      await familyRequest('submissions', body, { headers: { 'Idempotency-Key': attempt.current.key } });
      setInfo(i => ({ ...i, state: 'enviada' })); window.scrollTo({ top: 0 });
    } catch (err) { setError(err.message); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    finally { setBusy(false); }
  }

  const header = <nav className="site-nav" aria-label="Escola"><div className="site-container">
    <span className="site-logo"><span aria-hidden="true">{(info?.school_name || 'E').charAt(0)}</span>{info?.school_name || 'Matrícula online'}</span>
  </div></nav>;

  if (!info) return <main className="site">{header}<div className="site-container family-page">
    <form className="enroll-form" onSubmit={enter}>
      <h1>Matrícula online</h1>
      <p>Para sua segurança, confirme a <strong>data de nascimento da criança</strong>.</p>
      {error && <p className="site-error" role="alert">{error}</p>}
      <label>Data de nascimento da criança<input type="date" required value={birth} onChange={e => setBirth(e.target.value)} disabled={busy} /></label>
      <button className="site-button" disabled={busy || !birth}>{busy ? 'Confirmando…' : 'Entrar'}</button>
      <p className="site-muted">Este link é pessoal. Não compartilhe.</p>
    </form>
  </div></main>;

  const required = new Set(info.settings.required_fields);
  const editable = ['convidada', 'correcao'].includes(info.state);
  const child = (k, v) => setForm(f => ({ ...f, child: { ...f.child, [k]: v } }));
  const guardian = (i, k, v) => setForm(f => ({ ...f, guardians: f.guardians.map((g, j) =>
    j === i ? { ...g, [k]: v } : (k === 'is_financial' && v ? { ...g, is_financial: false } : g)) }));
  const address = (k, v) => setForm(f => ({ ...f, address: { ...f.address, [k]: v } }));

  return <main className="site">{header}<div className="site-container family-page">
    {!editable && <section className="enroll-form enroll-done" role="status">
      <div className="done-icon" aria-hidden="true">{info.state === 'recusada' ? '!' : '✓'}</div>
      {info.state === 'enviada' && <><h1>Recebemos a ficha!</h1><p>A secretaria vai conferir os dados de <strong>{form.child.full_name}</strong>. Você será avisado pelo WhatsApp. Pode voltar por este mesmo link para acompanhar.</p></>}
      {info.state === 'aprovada' && <><h1>Matrícula confirmada</h1><p>Bem-vindos à {info.school_name}! A secretaria entrará em contato com as próximas orientações.</p></>}
      {info.state === 'recusada' && <><h1>Matrícula não confirmada</h1><p>{info.review_note}</p><p>Fale com a escola pelo WhatsApp se tiver dúvidas.</p></>}
    </section>}

    {editable && <form className="enroll-form family-form" onSubmit={submit}>
      <h1>Ficha de matrícula</h1>
      <p className="site-muted">Confira e complete os dados. Leva cerca de 5 minutos. Nascimento: {civil(info.application.child_birth_date)}.</p>
      {info.state === 'correcao' && info.review_note && <p className="site-notice" role="status"><strong>A escola pediu:</strong> {info.review_note}</p>}
      {error && <p className="site-error" role="alert">{error}</p>}

      <fieldset disabled={busy} className="site-fields"><legend>Criança</legend>
        <label className="wide">Nome completo<input required maxLength={150} value={form.child.full_name} onChange={e => child('full_name', e.target.value)} /></label>
        <label>Nome social (opcional)<input maxLength={150} value={form.child.social_name} onChange={e => child('social_name', e.target.value)} /></label>
        <label>CPF da criança{required.has('child_cpf') ? '' : ' (opcional)'}<input inputMode="numeric" maxLength={14} required={required.has('child_cpf')} value={form.child.cpf} onChange={e => child('cpf', e.target.value)} /></label>
        <label className="wide">Saúde, alergias e medicamentos{required.has('child_health') ? ' (escreva "nenhum" se não houver)' : ' (opcional)'}
          <textarea rows={3} maxLength={2000} required={required.has('child_health')} value={form.child.health_notes} onChange={e => child('health_notes', e.target.value)} /></label>
      </fieldset>

      {form.guardians.map((g, i) => <fieldset key={i} disabled={busy} className="site-fields"><legend>{i === 0 ? 'Responsável' : 'Segundo responsável'}</legend>
        <label className="wide">Nome completo<input required maxLength={150} value={g.full_name} onChange={e => guardian(i, 'full_name', e.target.value)} /></label>
        <label>Parentesco<input required maxLength={80} list="relationships" value={g.relationship} onChange={e => guardian(i, 'relationship', e.target.value)} /></label>
        <label>WhatsApp com DDD<input required type="tel" maxLength={30} value={g.phone} onChange={e => guardian(i, 'phone', e.target.value)} /></label>
        <label>E-mail{required.has('guardian_email') && i === 0 ? '' : ' (opcional)'}<input type="email" maxLength={150} required={required.has('guardian_email') && i === 0} value={g.email} onChange={e => guardian(i, 'email', e.target.value)} /></label>
        <label>CPF{required.has('guardian_cpf') ? '' : ' (opcional)'}<input inputMode="numeric" maxLength={14} required={required.has('guardian_cpf')} value={g.cpf} onChange={e => guardian(i, 'cpf', e.target.value)} /></label>
        <label className="consent"><input type="checkbox" checked={g.is_legal} onChange={e => guardian(i, 'is_legal', e.target.checked)} /><span>É responsável legal pela criança</span></label>
        <label className="consent"><input type="radio" name="financial" checked={g.is_financial} onChange={() => guardian(i, 'is_financial', true)} /><span>Responsável financeiro</span></label>
        {i === 1 && !required.has('second_guardian') && <button type="button" className="site-button ghost small" onClick={() => setForm(f => ({ ...f, guardians: f.guardians.slice(0, 1).map(x => ({ ...x, is_financial: x.is_financial || g.is_financial })) }))}>Remover segundo responsável</button>}
      </fieldset>)}
      {form.guardians.length < 2 && <button type="button" className="site-button ghost" disabled={busy} onClick={() => setForm(f => ({ ...f, guardians: [...f.guardians, blankGuardian()] }))}>
        Adicionar segundo responsável{required.has('second_guardian') ? ' (obrigatório)' : ''}</button>}
      <datalist id="relationships">{RELATIONSHIPS.map(r => <option key={r} value={r} />)}</datalist>

      <fieldset disabled={busy} className="site-fields"><legend>Endereço{required.has('address') ? '' : ' (opcional)'}</legend>
        {[['zip_code','CEP',9,'numeric'],['street','Rua',160],['number','Número',20],['complement','Complemento (opcional)',80],['district','Bairro',80],['city','Cidade',80],['state','UF',2]].map(([k, label, max, mode]) =>
          <label key={k} className={k === 'street' ? 'wide' : undefined}>{label}<input maxLength={max} inputMode={mode}
            required={required.has('address') && k !== 'complement'} value={form.address[k]} onChange={e => address(k, e.target.value)} /></label>)}
      </fieldset>

      {info.settings.terms_text && <section className="terms-box" aria-label="Regulamento da escola"><h2>Regulamento da escola</h2><p>{info.settings.terms_text}</p></section>}
      <label className="consent"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} disabled={busy} />
        <span>Declaro que as informações são verdadeiras{info.settings.terms_text ? ' e aceito o regulamento da escola' : ''}.</span></label>
      <button className="site-button" disabled={busy || !accepted}>{busy ? 'Enviando…' : 'Enviar para a escola'}</button>
    </form>}
  </div></main>;
}
