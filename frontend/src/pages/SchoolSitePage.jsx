import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicSiteRequest } from '../auth/admissions-api.js';

// Horários sempre no fuso da escola, independentemente do aparelho de quem acessa.
const TZ = 'America/Sao_Paulo';
const dayLabel = iso => {
  const text = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: TZ });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const timeLabel = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const whatsappNumber = value => {
  const digits = (value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length >= 12 && digits.length <= 13 ? digits : null;
};
const imageUrl = (slug, id) => `/api/public/sites/${encodeURIComponent(slug)}/images/${id}`;

function SchoolArt() {
  return <svg className="site-art" viewBox="0 0 400 300" role="img" aria-label="Ilustração da escola">
    <rect className="art-ground" x="0" y="232" width="400" height="68" />
    <rect className="art-wall" x="70" y="112" width="260" height="128" rx="6" />
    <polygon className="art-roof" points="60,117 200,47 340,117" />
    <circle className="art-sun" cx="200" cy="93" r="15" />
    <rect className="art-door" x="176" y="172" width="48" height="68" rx="4" />
    <rect className="art-window" x="96" y="142" width="48" height="38" rx="4" />
    <rect className="art-window" x="256" y="142" width="48" height="38" rx="4" />
    <circle className="art-tree" cx="38" cy="206" r="26" /><circle className="art-tree" cx="362" cy="200" r="30" />
    <circle className="art-sun" cx="334" cy="40" r="17" />
  </svg>;
}

function GarmentArt({ name }) {
  const n = name.toLowerCase();
  const shape = /t[êe]nis|sapato/.test(n) ? 'M14 76 L20 50 L46 52 L58 66 L98 72 Q108 74 108 86 L108 96 L14 96 Z'
    : /cal[çc]a/.test(n) ? 'M34 14 H86 L92 108 H66 L60 48 L54 108 H28 Z'
    : /bermuda|short|saia/.test(n) ? 'M30 26 H90 L98 86 H68 L60 52 L52 86 H22 Z'
    : /jaqueta|moletom|casaco|blusa/.test(n) ? 'M42 14 L60 22 L78 14 L106 34 L96 54 L88 48 L88 106 H32 V48 L24 54 L14 34 Z'
    : 'M42 18 L60 26 L78 18 L104 34 L94 52 L84 46 L84 102 H36 V46 L26 52 L16 34 Z';
  return <svg className="garment-art" viewBox="0 0 120 120" role="img" aria-label={name}><path d={shape} /></svg>;
}

const interests = [['visita','Agendar visita','Conhecer a escola'],['matricula','Quero matricular','Já decidi'],['informacoes','Só informações','Tirar dúvidas']];
const blank = () => ({ child_name:'', child_birth_date:'', desired_level:'', guardian_name:'', guardian_phone:'',
  guardian_email:'', how_heard:'', message:'', website:'' });

function LeadForm({ site }) {
  const { slug, content } = site;
  const [interest, setInterest] = useState('visita');
  const [slot, setSlot] = useState('');
  const [form, setForm] = useState(blank);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const attempt = useRef(null);
  const days = useMemo(() => {
    const groups = new Map();
    for (const s of site.visit_slots) groups.set(dayLabel(s.starts_at), [...(groups.get(dayLabel(s.starts_at)) || []), s]);
    return [...groups.entries()];
  }, [site.visit_slots]);
  const field = e => { const { name, value } = e.target; setForm(f => ({ ...f, [name]: value })); };

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const payload = { interest, slot_id: interest === 'visita' && slot ? slot : null, consent,
      ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, k === 'website' ? v : v.trim() || null])) };
    const body = JSON.stringify(payload);
    // Mesma chave enquanto os dados não mudarem: reenviar após falha de rede não duplica.
    if (!attempt.current || attempt.current.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    try {
      setDone(await publicSiteRequest(slug, '/leads', { method: 'POST', body, headers: { 'Idempotency-Key': attempt.current.key } }));
    } catch (err) { setError(err.message); if (err.status === 409) setSlot(''); }
    finally { setBusy(false); }
  }

  const wa = whatsappNumber(content.contact.whatsapp);
  if (done) {
    const visit = done.visit_starts_at;
    return <div className="enroll-form enroll-done" role="status">
      <div className="done-icon" aria-hidden="true">✓</div>
      <h3>Recebemos sua pré-matrícula!</h3>
      <p className="protocol">{done.protocol}</p>
      <p>Guarde este protocolo. A escola vai falar com você pelo WhatsApp.</p>
      {visit && <p><strong>Visita agendada:</strong> {dayLabel(visit)}, às {timeLabel(visit)}</p>}
      {wa && <a className="site-button whatsapp" target="_blank" rel="noreferrer"
        href={`https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Fiz a pré-matrícula pelo site (protocolo ${done.protocol}).`)}`}>Avisar a escola no WhatsApp</a>}
    </div>;
  }
  return <form className="enroll-form" onSubmit={submit} noValidate={false}>
    <h3>Pré-matrícula{content.enrollment.year ? ` ${content.enrollment.year}` : ''}</h3>
    {error && <p className="site-error" role="alert">{error}</p>}
    <fieldset disabled={busy}>
      <legend>O que você deseja?</legend>
      <div className="choice-group">{interests.map(([value, title, hint]) =>
        <button type="button" key={value} className="choice" aria-pressed={interest === value} onClick={() => setInterest(value)}>
          <strong>{title}</strong><small>{hint}</small></button>)}</div>
    </fieldset>
    <fieldset disabled={busy} className="site-fields">
      <label>Nome da criança<input name="child_name" required maxLength={150} value={form.child_name} onChange={field} /></label>
      <label>Data de nascimento (opcional)<input name="child_birth_date" type="date" value={form.child_birth_date} onChange={field} /></label>
      {content.levels.length > 0 && <div className="field-group"><label htmlFor="pm-level">Turma de interesse</label>
        <select id="pm-level" name="desired_level" value={form.desired_level} onChange={field}>
          <option value="">Não sei ainda</option>
          {content.levels.map(l => <option key={l.name} value={l.name}>{l.name}{l.ages ? ` (${l.ages})` : ''}</option>)}
        </select></div>}
      <label>Seu nome<input name="guardian_name" required maxLength={150} autoComplete="name" value={form.guardian_name} onChange={field} /></label>
      <label>WhatsApp com DDD<input name="guardian_phone" required type="tel" maxLength={30} autoComplete="tel"
        placeholder="(11) 98888-7777" value={form.guardian_phone} onChange={field} /></label>
      <label>E-mail (opcional)<input name="guardian_email" type="email" maxLength={150} autoComplete="email" value={form.guardian_email} onChange={field} /></label>
    </fieldset>
    {interest === 'visita' && <fieldset disabled={busy}>
      <legend>Escolha o horário da visita</legend>
      {days.length ? <div className="slot-days">{days.map(([day, slots]) => <div className="slot-day" key={day}>
        <strong>{day}</strong>
        <div className="slot-times">{slots.map(s => <button type="button" key={s.id} className="choice" aria-pressed={slot === s.id}
          onClick={() => setSlot(s.id)}>{timeLabel(s.starts_at)}</button>)}</div>
      </div>)}</div> : <p className="site-muted">Sem horários livres agora. Envie mesmo assim: a escola combina o horário pelo WhatsApp.</p>}
    </fieldset>}
    <fieldset disabled={busy} className="site-fields">
      <label>Como conheceu a escola? (opcional)<input name="how_heard" maxLength={120} value={form.how_heard} onChange={field} /></label>
      <label className="wide">Quer contar algo? (opcional)<textarea name="message" maxLength={1000} rows={3} value={form.message} onChange={field} /></label>
      <label className="trap" aria-hidden="true">Não preencha<input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={field} /></label>
    </fieldset>
    <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} />
      <span>Autorizo a escola a usar estes dados para falar comigo sobre a matrícula, conforme a LGPD.</span></label>
    <button className="site-button" disabled={busy || !consent}>{busy ? 'Enviando…' : interest === 'visita' && slot ? 'Enviar e agendar visita' : 'Enviar pré-matrícula'}</button>
  </form>;
}

export default function SchoolSitePage() {
  const { slug } = useParams();
  const [site, setSite] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    publicSiteRequest(slug, '', { signal: controller.signal })
      .then(data => { setSite(data); document.title = data.school_name; })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [slug]);

  if (error) return <main className="site"><div className="site-container site-section"><h1>Página indisponível</h1><p>{error}</p></div></main>;
  if (!site) return <main className="site" aria-busy="true"><p className="site-container site-section" role="status">Carregando…</p></main>;
  const { content } = site;
  const wa = whatsappNumber(content.contact.whatsapp);
  const waLink = wa && `https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Vi o site da ${site.school_name} e gostaria de mais informações.`)}`;
  return <main className="site">
    <nav className="site-nav" aria-label="Navegação do site"><div className="site-container">
      <a className="site-logo" href="#inicio"><span aria-hidden="true">{site.school_name.charAt(0)}</span>{site.school_name}</a>
      <div className="site-links"><a href="#sobre">A escola</a><a href="#rotina">Rotina</a><a href="#uniforme">Uniforme</a><a href="#duvidas">Dúvidas</a></div>
      {content.enrollment.open && <a className="site-button small" href="#matricula">Pré-matrícula</a>}
    </div></nav>

    <header className="site-container site-hero" id="inicio">
      <div>
        {content.enrollment.open && content.enrollment.year && <span className="site-pill">Matrículas abertas {content.enrollment.year}</span>}
        <h1>{content.hero.title}</h1>
        {content.hero.subtitle && <p>{content.hero.subtitle}</p>}
        <div className="site-actions">
          {content.enrollment.open && <a className="site-button" href="#matricula">Agendar visita</a>}
          <a className="site-button ghost" href="#sobre">Conhecer a escola</a>
        </div>
      </div>
      <div className="site-hero-art">{content.hero.image_id ? <img src={imageUrl(slug, content.hero.image_id)} alt="" /> : <SchoolArt />}</div>
    </header>

    <section className="site-section tint" id="sobre"><div className="site-container">
      <p className="site-eyebrow">A escola</p><h2>{content.about.title}</h2>
      {content.about.text && <p className="site-lead">{content.about.text}</p>}
      {content.highlights.length > 0 && <div className="site-grid">{content.highlights.map(h =>
        <article className="site-card" key={h.title}><h3>{h.title}</h3>{h.text && <p>{h.text}</p>}</article>)}</div>}
    </div></section>

    {content.levels.length > 0 && <section className="site-section"><div className="site-container">
      <p className="site-eyebrow">Turmas</p><h2>Para cada idade, uma proposta</h2>
      <div className="site-grid">{content.levels.map(l => <article className="site-card" key={l.name}>
        {l.ages && <p className="site-meta">{l.ages}</p>}<h3>{l.name}</h3>{l.description && <p>{l.description}</p>}
        {l.shifts && <p className="site-muted">{l.shifts}</p>}</article>)}</div>
    </div></section>}

    {content.routine.length > 0 && <section className="site-section tint" id="rotina"><div className="site-container">
      <p className="site-eyebrow">Como funciona</p><h2>Um dia na escola</h2>
      <ol className="site-routine">{content.routine.map(r => <li key={r.title}><strong>{r.title}</strong>{r.text && <p>{r.text}</p>}</li>)}</ol>
    </div></section>}

    {content.uniform.items.length > 0 && <section className="site-section" id="uniforme"><div className="site-container">
      <p className="site-eyebrow">Uniforme</p><h2>O que a criança precisa usar</h2>
      {content.uniform.intro && <p className="site-lead">{content.uniform.intro}</p>}
      <div className="site-grid">{content.uniform.items.map(item => <article className="site-card uniform-card" key={item.name}>
        <div className="uniform-photo">{item.image_id ? <img src={imageUrl(slug, item.image_id)} alt={item.name} loading="lazy" /> : <GarmentArt name={item.name} />}</div>
        <span className={item.required ? 'uniform-tag' : 'uniform-tag optional'}>{item.required ? 'Obrigatório' : 'Opcional'}</span>
        <h3>{item.name}</h3>{item.description && <p>{item.description}</p>}{item.price && <p className="price">{item.price}</p>}
      </article>)}</div>
      {content.uniform.where_to_buy && <p className="site-lead"><strong>Onde comprar:</strong> {content.uniform.where_to_buy}</p>}
    </div></section>}

    {(content.location.address || content.location.opening_hours) && <section className="site-section tint"><div className="site-container">
      <p className="site-eyebrow">Onde estamos</p><h2>Venha nos visitar</h2>
      {content.location.address && <p className="site-lead">{content.location.address}</p>}
      {content.location.opening_hours && <p className="site-muted">{content.location.opening_hours}</p>}
    </div></section>}

    {content.enrollment.open && <section className="site-section" id="matricula"><div className="site-container enroll">
      <div>
        <p className="site-eyebrow">Pré-matrícula</p><h2>Comece agora, pelo celular</h2>
        {content.enrollment.intro && <p className="site-lead">{content.enrollment.intro}</p>}
        <ol className="enroll-steps">
          <li><b>1</b><span><strong>Preencha a pré-matrícula.</strong> Leva 2 minutos e você já pode escolher o horário da visita.</span></li>
          <li><b>2</b><span><strong>Conheça a escola.</strong> Visite as salas, o pátio e converse com a coordenação.</span></li>
          <li><b>3</b><span><strong>Combine a matrícula.</strong> A escola fala com você pelo WhatsApp, sem fila e sem papel.</span></li>
        </ol>
      </div>
      <LeadForm site={site} />
    </div></section>}

    {content.faq.length > 0 && <section className="site-section tint" id="duvidas"><div className="site-container">
      <p className="site-eyebrow">Dúvidas</p><h2>Perguntas frequentes</h2>
      <div className="site-faq">{content.faq.map(f => <details key={f.question}><summary>{f.question}</summary><p>{f.answer}</p></details>)}</div>
    </div></section>}

    <footer className="site-footer"><div className="site-container">
      <span>{site.school_name}</span>
      <span>{[content.contact.whatsapp && `WhatsApp ${content.contact.whatsapp}`, content.contact.email, content.contact.instagram].filter(Boolean).join(' · ')}</span>
      {waLink && <a className="site-button whatsapp" href={waLink} target="_blank" rel="noreferrer">Falar no WhatsApp</a>}
    </div></footer>
  </main>;
}
