import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { errorMessage, request } from '../api';
import { SCHOOL_TIME_ZONE, formatAddress, type Address } from '../labels';
import { GarmentIllustration, SchoolIllustration } from './Illustrations';
import './site.css';

export type SiteContent = {
  hero: { title: string; subtitle: string; image_id?: string | null };
  about: { title: string; text: string };
  highlights: { title: string; text: string }[];
  routine: { title: string; text: string }[];
  segments: { name: string; ages: string; shifts: string; description: string }[];
  uniform: {
    intro: string;
    where_to_buy: string;
    items: { name: string; description: string; price: string; required: boolean; image_id?: string | null }[];
  };
  faq: { question: string; answer: string }[];
  enrollment: { open: boolean; year?: number; intro: string };
  contact: { whatsapp: string; email: string; instagram: string };
};

type Unit = {
  id: string;
  name: string;
  address: Address;
  whatsapp: string | null;
  phone: string | null;
  opening_hours: string | null;
  accepting_enrollments: boolean;
};

type PublicSchool = {
  name: string;
  slug: string;
  content: SiteContent;
  units: Unit[];
  visit_slots: { id: string; unit_id: string; starts_at: string }[];
};

const BASE_URL = import.meta.env.VITE_API_URL ?? '';
export const assetUrl = (id: string) => `${BASE_URL}/api/public/assets/${id}`;

function digitsToWa(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length >= 12 ? digits : null;
}

export function SchoolSite() {
  const { slug = '' } = useParams();
  const [school, setSchool] = useState<PublicSchool | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<PublicSchool>(`/api/public/schools/${slug}`)
      .then((data) => {
        setSchool(data);
        document.title = data.name;
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, [slug]);

  if (error) {
    return (
      <div className="site">
        <div className="site-container site-section">
          <h1>Página não encontrada</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (!school) return <div className="site" aria-busy="true" />;

  const { content } = school;
  const contactWa = digitsToWa(content.contact.whatsapp) ?? digitsToWa(school.units.find((u) => u.accepting_enrollments)?.whatsapp);

  return (
    <div className="site">
      <nav className="site-nav" aria-label="Navegação do site">
        <div className="site-container">
          <a className="site-logo" href="#inicio">
            <span>{school.name.charAt(0)}</span>
            {school.name.replace(/\s*\(.*\)$/, '')}
          </a>
          <div className="site-links">
            <a href="#sobre">A escola</a>
            <a href="#rotina">Rotina</a>
            <a href="#uniforme">Uniforme</a>
            <a href="#unidades">Unidades</a>
            <a href="#duvidas">Dúvidas</a>
          </div>
          {content.enrollment.open && (
            <a className="site-btn" href="#matricula">
              Pré-matrícula
            </a>
          )}
        </div>
      </nav>

      <header className="site-container site-hero" id="inicio">
        <div>
          {content.enrollment.open && content.enrollment.year && (
            <span className="site-pill">Matrículas abertas {content.enrollment.year}</span>
          )}
          <h1>{content.hero.title}</h1>
          <p>{content.hero.subtitle}</p>
          <div className="site-hero-actions">
            {content.enrollment.open && (
              <a className="site-btn" href="#matricula">
                Agendar visita
              </a>
            )}
            <a className="site-btn ghost" href="#sobre">
              Conhecer a escola
            </a>
          </div>
        </div>
        <div className="site-hero-art">
          {content.hero.image_id ? <img src={assetUrl(content.hero.image_id)} alt="" /> : <SchoolIllustration />}
        </div>
      </header>

      <section className="site-section tint" id="sobre">
        <div className="site-container">
          <p className="site-eyebrow">A escola</p>
          <h2>{content.about.title}</h2>
          <p className="site-lead">{content.about.text}</p>
          {content.highlights.length > 0 && (
            <div className="site-grid">
              {content.highlights.map((item) => (
                <div className="site-card" key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {content.segments.length > 0 && (
        <section className="site-section">
          <div className="site-container">
            <p className="site-eyebrow">Turmas</p>
            <h2>Para cada idade, uma proposta</h2>
            <div className="site-grid">
              {content.segments.map((segment) => (
                <div className="site-card" key={segment.name}>
                  <div className="meta">{segment.ages}</div>
                  <h3>{segment.name}</h3>
                  <p>{segment.description}</p>
                  {segment.shifts && <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>{segment.shifts}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {content.routine.length > 0 && (
        <section className="site-section tint" id="rotina">
          <div className="site-container">
            <p className="site-eyebrow">Como funciona</p>
            <h2>Um dia na escola</h2>
            <ol className="site-routine">
              {content.routine.map((item) => (
                <li key={item.title}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {content.uniform.items.length > 0 && (
        <section className="site-section" id="uniforme">
          <div className="site-container">
            <p className="site-eyebrow">Uniforme</p>
            <h2>O que a criança precisa usar</h2>
            {content.uniform.intro && <p className="site-lead">{content.uniform.intro}</p>}
            <div className="site-grid">
              {content.uniform.items.map((item) => (
                <div className="site-card uniform-card" key={item.name}>
                  <div className="uniform-photo">
                    {item.image_id ? <img src={assetUrl(item.image_id)} alt={item.name} loading="lazy" /> : <GarmentIllustration name={item.name} />}
                  </div>
                  <span className={`uniform-tag ${item.required ? '' : 'optional'}`}>{item.required ? 'Obrigatório' : 'Opcional'}</span>
                  <h3>{item.name}</h3>
                  {item.description && <p>{item.description}</p>}
                  {item.price && <div className="price">{item.price}</div>}
                </div>
              ))}
            </div>
            {content.uniform.where_to_buy && (
              <p className="site-lead" style={{ marginTop: '1.5rem', marginBottom: 0 }}>
                <strong>Onde comprar:</strong> {content.uniform.where_to_buy}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="site-section tint" id="unidades">
        <div className="site-container">
          <p className="site-eyebrow">Unidades</p>
          <h2>Onde estamos</h2>
          <div className="site-grid">
            {school.units.map((unit) => (
              <div className="site-card unit-card" key={unit.id}>
                {unit.accepting_enrollments && <span className="tag">Matrículas abertas</span>}
                <h3>{unit.name}</h3>
                <p>{formatAddress(unit.address)}</p>
                {unit.opening_hours && <p style={{ marginTop: '0.4rem' }}>{unit.opening_hours}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {content.enrollment.open && (
        <section className="site-section" id="matricula">
          <div className="site-container enroll">
            <div>
              <p className="site-eyebrow">Pré-matrícula</p>
              <h2>Comece agora, pelo celular</h2>
              {content.enrollment.intro && <p className="site-lead">{content.enrollment.intro}</p>}
              <ol className="enroll-steps">
                <li>
                  <b>1</b>
                  <div>
                    <strong>Preencha a pré-matrícula</strong>
                    <br />
                    <span>Leva 2 minutos. Se quiser, já escolha o horário da visita.</span>
                  </div>
                </li>
                <li>
                  <b>2</b>
                  <div>
                    <strong>Conheça a escola</strong>
                    <br />
                    <span>Visite as salas, o pátio e converse com a coordenação.</span>
                  </div>
                </li>
                <li>
                  <b>3</b>
                  <div>
                    <strong>Finalize pelo WhatsApp</strong>
                    <br />
                    <span>Enviamos um link para você completar a matrícula pelo celular, sem papel.</span>
                  </div>
                </li>
              </ol>
            </div>
            <EnrollForm school={school} />
          </div>
        </section>
      )}

      {content.faq.length > 0 && (
        <section className="site-section tint" id="duvidas">
          <div className="site-container">
            <p className="site-eyebrow">Dúvidas</p>
            <h2>Perguntas frequentes</h2>
            <div className="site-faq">
              {content.faq.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer className="site-footer">
        <div className="site-container">
          <span>{school.name}</span>
          {contactWa && (
            <a
              className="site-btn wa site-wa-inline"
              href={`https://wa.me/${contactWa}?text=${encodeURIComponent(`Olá! Vi o site da ${school.name} e gostaria de mais informações.`)}`}
              target="_blank"
              rel="noreferrer"
            >
              Falar no WhatsApp
            </a>
          )}
          <span>
            {[content.contact.whatsapp && `WhatsApp ${content.contact.whatsapp}`, content.contact.email, content.contact.instagram]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      </footer>

      {contactWa && (
        <a
          className="site-btn wa site-wa-float"
          href={`https://wa.me/${contactWa}?text=${encodeURIComponent(`Olá! Vi o site da ${school.name} e gostaria de mais informações.`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Falar no WhatsApp
        </a>
      )}
    </div>
  );
}

const INTERESTS = [
  { value: 'visit', title: 'Agendar visita', hint: 'Conhecer a escola' },
  { value: 'enroll', title: 'Quero matricular', hint: 'Já decidi' },
  { value: 'info', title: 'Só informações', hint: 'Tirar dúvidas' },
] as const;

type Result = { code: string; visit_starts_at: string | null; whatsapp_url: string | null };

function EnrollForm({ school }: { school: PublicSchool }) {
  const openUnits = school.units.filter((unit) => unit.accepting_enrollments);
  const [unitId, setUnitId] = useState(openUnits[0]?.id ?? '');
  const [interest, setInterest] = useState<(typeof INTERESTS)[number]['value']>('visit');
  const [slotId, setSlotId] = useState<string | null>(null);
  const [form, setForm] = useState({
    student_name: '',
    student_birth_date: '',
    desired_grade: '',
    guardian_name: '',
    guardian_phone: '',
    guardian_email: '',
    how_heard: '',
    message: '',
    website: '',
  });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const slotsByDay = useMemo(() => {
    const groups = new Map<string, { id: string; time: string }[]>();
    for (const slot of school.visit_slots.filter((item) => item.unit_id === unitId)) {
      const date = new Date(slot.starts_at);
      const day = date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: SCHOOL_TIME_ZONE });
      const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: SCHOOL_TIME_ZONE });
      const label = day.charAt(0).toUpperCase() + day.slice(1);
      groups.set(label, [...(groups.get(label) ?? []), { id: slot.id, time }]);
    }
    return [...groups.entries()];
  }, [school.visit_slots, unitId]);

  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [field]: event.target.value });

  if (!openUnits.length) {
    return (
      <div className="enroll-form">
        <h3>Matrículas encerradas no momento</h3>
        <p>Fale com a escola pelo WhatsApp para entrar na lista de espera.</p>
      </div>
    );
  }

  if (result) {
    const visit = result.visit_starts_at ? new Date(result.visit_starts_at) : null;
    return (
      <div className="enroll-form enroll-done" aria-live="polite">
        <div className="check-icon" aria-hidden="true">
          ✓
        </div>
        <h3>Recebemos sua pré-matrícula!</h3>
        <div className="protocol">{result.code}</div>
        <p style={{ margin: 0 }}>Guarde este protocolo. A escola vai falar com você pelo WhatsApp.</p>
        {visit && (
          <p style={{ margin: 0 }}>
            <strong>Visita agendada:</strong>{' '}
            {visit.toLocaleString('pt-BR', {
              weekday: 'long',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: SCHOOL_TIME_ZONE,
            })}
          </p>
        )}
        {result.whatsapp_url && (
          <a className="site-btn wa" href={result.whatsapp_url} target="_blank" rel="noreferrer">
            Avisar a escola no WhatsApp
          </a>
        )}
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await request<Result>(`/api/public/schools/${school.slug}/leads`, {
        method: 'POST',
        body: {
          unit_id: unitId,
          interest,
          slot_id: interest === 'visit' && slotId ? slotId : undefined,
          student_name: form.student_name,
          student_birth_date: form.student_birth_date || undefined,
          desired_grade: form.desired_grade || undefined,
          desired_year: school.content.enrollment.year,
          guardian_name: form.guardian_name,
          guardian_phone: form.guardian_phone,
          guardian_email: form.guardian_email || undefined,
          how_heard: form.how_heard || undefined,
          message: form.message || undefined,
          website: form.website,
          consent,
        },
      });
      setResult(response);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="enroll-form" onSubmit={submit}>
      <h3>Pré-matrícula {school.content.enrollment.year ?? ''}</h3>
      {error && (
        <div className="s-error" role="alert">
          {error}
        </div>
      )}

      {openUnits.length > 1 && (
        <div className="s-field">
          <label htmlFor="pm-unit">Unidade</label>
          <select id="pm-unit" value={unitId} onChange={(event) => { setUnitId(event.target.value); setSlotId(null); }}>
            {openUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="s-field">
        <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>O que você deseja?</span>
        <div className="choice-group">
          {INTERESTS.map((option) => (
            <button
              type="button"
              key={option.value}
              className="choice"
              aria-pressed={interest === option.value}
              onClick={() => setInterest(option.value)}
            >
              <strong>{option.title}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="s-row">
        <div className="s-field">
          <label htmlFor="pm-student">Nome da criança</label>
          <input id="pm-student" required value={form.student_name} onChange={set('student_name')} autoComplete="off" />
        </div>
        <div className="s-field">
          <label htmlFor="pm-birth">Data de nascimento</label>
          <input id="pm-birth" type="date" value={form.student_birth_date} onChange={set('student_birth_date')} />
        </div>
      </div>

      {school.content.segments.length > 0 && (
        <div className="s-field">
          <label htmlFor="pm-grade">Turma de interesse</label>
          <select id="pm-grade" value={form.desired_grade} onChange={set('desired_grade')}>
            <option value="">Não sei ainda</option>
            {school.content.segments.map((segment) => (
              <option key={segment.name} value={segment.name}>
                {segment.name} {segment.ages && `(${segment.ages})`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="s-row">
        <div className="s-field">
          <label htmlFor="pm-guardian">Seu nome</label>
          <input id="pm-guardian" required value={form.guardian_name} onChange={set('guardian_name')} autoComplete="name" />
        </div>
        <div className="s-field">
          <label htmlFor="pm-phone">WhatsApp</label>
          <input
            id="pm-phone"
            type="tel"
            required
            placeholder="(11) 98888-7777"
            value={form.guardian_phone}
            onChange={set('guardian_phone')}
            autoComplete="tel"
          />
        </div>
      </div>
      <div className="s-field">
        <label htmlFor="pm-email">E-mail (opcional)</label>
        <input id="pm-email" type="email" value={form.guardian_email} onChange={set('guardian_email')} autoComplete="email" />
      </div>

      {interest === 'visit' && (
        <div className="s-field">
          <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>Escolha o horário da visita</span>
          {slotsByDay.length ? (
            <div className="slot-days">
              {slotsByDay.map(([day, slots]) => (
                <div className="slot-day" key={day}>
                  <strong>{day}</strong>
                  <div className="slot-times">
                    {slots.map((slot) => (
                      <button type="button" key={slot.id} className="choice" aria-pressed={slotId === slot.id} onClick={() => setSlotId(slot.id)}>
                        {slot.time}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <small>Sem horários livres agora. Envie mesmo assim que a escola combina com você pelo WhatsApp.</small>
          )}
        </div>
      )}

      <div className="s-field">
        <label htmlFor="pm-heard">Como conheceu a escola? (opcional)</label>
        <input id="pm-heard" value={form.how_heard} onChange={set('how_heard')} />
      </div>
      <div className="s-field">
        <label htmlFor="pm-message">Quer contar algo? (opcional)</label>
        <textarea id="pm-message" rows={3} value={form.message} onChange={set('message')} />
      </div>

      <div className="s-hidden" aria-hidden="true">
        <label htmlFor="pm-website">Não preencha</label>
        <input id="pm-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
      </div>

      <label className="s-check">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>Autorizo a escola a usar estes dados para falar comigo sobre a matrícula, conforme a LGPD.</span>
      </label>

      <button className="site-btn" disabled={busy || !consent}>
        {busy ? 'Enviando…' : interest === 'visit' && slotId ? 'Enviar e agendar visita' : 'Enviar pré-matrícula'}
      </button>
    </form>
  );
}
