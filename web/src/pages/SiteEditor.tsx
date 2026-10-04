import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorAlert, Loading } from '../components/ui';
import { formatDateTime } from '../labels';
import { assetUrl, type SiteContent } from '../site/SchoolSite';

const EMPTY: SiteContent = {
  hero: { title: '', subtitle: '', image_id: null },
  about: { title: 'Sobre a escola', text: '' },
  highlights: [],
  routine: [],
  segments: [],
  uniform: { intro: '', where_to_buy: '', items: [] },
  faq: [],
  enrollment: { open: true, intro: '' },
  contact: { whatsapp: '', email: '', instagram: '' },
};

type SiteResponse = { slug: string; published: boolean; content: SiteContent | null; updated_at: string | null };

type Field<T> = { key: keyof T & string; label: string; multiline?: boolean };

/** Editor genérico para listas de itens (destaques, rotina, perguntas…). */
function ListEditor<T extends Record<string, unknown>>({
  items,
  fields,
  blank,
  addLabel,
  onChange,
  extra,
}: {
  items: T[];
  fields: Field<T>[];
  blank: T;
  addLabel: string;
  onChange: (items: T[]) => void;
  extra?: (item: T, update: (patch: Partial<T>) => void) => ReactNode;
}) {
  const update = (index: number, patch: Partial<T>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const move = (index: number, delta: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      {items.map((item, index) => (
        <div key={index} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.85rem' }}>
          <div className="form-row">
            {fields.map((field) => (
              <div className="field" key={field.key} style={field.multiline ? { gridColumn: '1 / -1' } : undefined}>
                <label htmlFor={`${addLabel}-${index}-${field.key}`}>{field.label}</label>
                {field.multiline ? (
                  <textarea
                    id={`${addLabel}-${index}-${field.key}`}
                    value={String(item[field.key] ?? '')}
                    onChange={(event) => update(index, { [field.key]: event.target.value } as Partial<T>)}
                  />
                ) : (
                  <input
                    id={`${addLabel}-${index}-${field.key}`}
                    value={String(item[field.key] ?? '')}
                    onChange={(event) => update(index, { [field.key]: event.target.value } as Partial<T>)}
                  />
                )}
              </div>
            ))}
          </div>
          {extra?.(item, (patch) => update(index, patch))}
          <div className="actions">
            <button type="button" className="btn btn-small" disabled={index === 0} onClick={() => move(index, -1)}>
              Subir
            </button>
            <button type="button" className="btn btn-small" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
              Descer
            </button>
            <button type="button" className="btn btn-small btn-danger" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              Remover
            </button>
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-small" onClick={() => onChange([...items, { ...blank }])}>
          + {addLabel}
        </button>
      </div>
    </div>
  );
}

function ImagePicker({ value, onChange }: { value: string | null | undefined; onChange: (id: string | null) => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setError('Use foto JPG, PNG ou WebP.');
    if (file.size > 2 * 1024 * 1024) return setError('A foto deve ter até 2 MB.');
    setBusy(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/site/assets`, {
        method: 'POST',
        headers: { 'Content-Type': file.type, Authorization: `Bearer ${token}` },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onChange(data.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Foto</span>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {value && <img src={assetUrl(value)} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />}
        <label className="btn btn-small">
          {busy ? 'Enviando…' : value ? 'Trocar foto' : 'Enviar foto'}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
        </label>
        {value && (
          <button type="button" className="btn btn-small" onClick={() => onChange(null)}>
            Remover foto
          </button>
        )}
      </div>
      {error && <span className="hint" style={{ color: 'var(--danger)' }}>{error}</span>}
      <span className="hint">Fotos aparecem só depois de publicar o site. Sem foto, o site mostra uma ilustração.</span>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {hint && <p className="muted small">{hint}</p>}
      {children}
    </div>
  );
}

export function SiteEditor() {
  const { api } = useAuth();
  const [site, setSite] = useState<SiteResponse | null>(null);
  const [content, setContent] = useState<SiteContent>(EMPTY);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SiteResponse>('/api/site')
      .then((data) => {
        setSite(data);
        setPublished(data.published);
        setContent({ ...EMPTY, ...(data.content ?? {}) });
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, [api]);

  if (!site) return error ? <ErrorAlert message={error} /> : <Loading />;

  const patch = <K extends keyof SiteContent>(key: K, value: Partial<SiteContent[K]>) =>
    setContent({ ...content, [key]: { ...(content[key] as object), ...value } });

  const save = async (publish = published) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await api('/api/site', { method: 'PUT', body: { published: publish, content } });
      setPublished(publish);
      setSaved(publish ? 'Site salvo e publicado.' : 'Rascunho salvo. O site não está visível ao público.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const url = `${location.origin}/escola/${site.slug}`;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Site da escola</h1>
          <p className="muted">
            {published ? 'Publicado' : 'Não publicado'} · {url}
            {site.updated_at && ` · atualizado em ${formatDateTime(site.updated_at)}`}
          </p>
        </div>
        <div className="actions">
          <a className="btn" href={url} target="_blank" rel="noreferrer">
            Ver site
          </a>
          <button className="btn" disabled={busy} onClick={() => save(false)}>
            {published ? 'Despublicar' : 'Salvar rascunho'}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>
            Salvar e publicar
          </button>
        </div>
      </div>
      <ErrorAlert message={error} />
      {saved && <div className="alert alert-success">{saved}</div>}

      <Section title="Abertura" hint="A primeira coisa que a família vê.">
        <div className="field">
          <label htmlFor="hero-title">Título</label>
          <input id="hero-title" value={content.hero.title} onChange={(event) => patch('hero', { title: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="hero-subtitle">Subtítulo</label>
          <textarea id="hero-subtitle" value={content.hero.subtitle} onChange={(event) => patch('hero', { subtitle: event.target.value })} />
        </div>
        <ImagePicker value={content.hero.image_id} onChange={(id) => patch('hero', { image_id: id })} />
      </Section>

      <Section title="Sobre a escola">
        <div className="field">
          <label htmlFor="about-title">Título</label>
          <input id="about-title" value={content.about.title} onChange={(event) => patch('about', { title: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="about-text">Texto</label>
          <textarea id="about-text" rows={6} value={content.about.text} onChange={(event) => patch('about', { text: event.target.value })} />
        </div>
        <div className="section-title">Diferenciais</div>
        <ListEditor
          items={content.highlights}
          fields={[{ key: 'title', label: 'Título' }, { key: 'text', label: 'Texto', multiline: true }]}
          blank={{ title: '', text: '' }}
          addLabel="Diferencial"
          onChange={(highlights) => setContent({ ...content, highlights })}
        />
      </Section>

      <Section title="Turmas oferecidas" hint="Também aparecem como opções no formulário de pré-matrícula.">
        <ListEditor
          items={content.segments}
          fields={[
            { key: 'name', label: 'Turma' },
            { key: 'ages', label: 'Idade' },
            { key: 'shifts', label: 'Turnos' },
            { key: 'description', label: 'Descrição', multiline: true },
          ]}
          blank={{ name: '', ages: '', shifts: '', description: '' }}
          addLabel="Turma"
          onChange={(segments) => setContent({ ...content, segments })}
        />
      </Section>

      <Section title="Como funciona (rotina)">
        <ListEditor
          items={content.routine}
          fields={[{ key: 'title', label: 'Horário e atividade' }, { key: 'text', label: 'Descrição', multiline: true }]}
          blank={{ title: '', text: '' }}
          addLabel="Momento da rotina"
          onChange={(routine) => setContent({ ...content, routine })}
        />
      </Section>

      <Section title="Uniforme" hint="Envie fotos reais das peças: é uma das dúvidas mais comuns das famílias.">
        <div className="field">
          <label htmlFor="uniform-intro">Introdução</label>
          <textarea id="uniform-intro" value={content.uniform.intro} onChange={(event) => patch('uniform', { intro: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="uniform-buy">Onde comprar</label>
          <input id="uniform-buy" value={content.uniform.where_to_buy} onChange={(event) => patch('uniform', { where_to_buy: event.target.value })} />
        </div>
        <ListEditor
          items={content.uniform.items}
          fields={[
            { key: 'name', label: 'Peça' },
            { key: 'price', label: 'Preço' },
            { key: 'description', label: 'Descrição', multiline: true },
          ]}
          blank={{ name: '', description: '', price: '', required: true, image_id: null }}
          addLabel="Peça"
          onChange={(items) => patch('uniform', { items })}
          extra={(item, update) => (
            <>
              <label className="checkbox" style={{ marginBottom: '0.75rem' }}>
                <input type="checkbox" checked={item.required} onChange={(event) => update({ required: event.target.checked })} />
                Obrigatório
              </label>
              <ImagePicker value={item.image_id} onChange={(id) => update({ image_id: id })} />
            </>
          )}
        />
      </Section>

      <Section title="Perguntas frequentes">
        <ListEditor
          items={content.faq}
          fields={[{ key: 'question', label: 'Pergunta' }, { key: 'answer', label: 'Resposta', multiline: true }]}
          blank={{ question: '', answer: '' }}
          addLabel="Pergunta"
          onChange={(faq) => setContent({ ...content, faq })}
        />
      </Section>

      <Section title="Matrículas e contato">
        <label className="checkbox" style={{ marginBottom: '0.9rem' }}>
          <input type="checkbox" checked={content.enrollment.open} onChange={(event) => patch('enrollment', { open: event.target.checked })} />
          Mostrar o formulário de pré-matrícula no site
        </label>
        <div className="form-row">
          <div className="field">
            <label htmlFor="enroll-year">Ano letivo</label>
            <input
              id="enroll-year"
              type="number"
              value={content.enrollment.year ?? ''}
              onChange={(event) => patch('enrollment', { year: event.target.value ? Number(event.target.value) : undefined })}
            />
          </div>
          <div className="field">
            <label htmlFor="contact-wa">WhatsApp da escola</label>
            <input id="contact-wa" value={content.contact.whatsapp} onChange={(event) => patch('contact', { whatsapp: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="contact-email">E-mail</label>
            <input id="contact-email" value={content.contact.email} onChange={(event) => patch('contact', { email: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="contact-ig">Instagram</label>
            <input id="contact-ig" value={content.contact.instagram} onChange={(event) => patch('contact', { instagram: event.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="enroll-intro">Chamada da pré-matrícula</label>
          <textarea id="enroll-intro" value={content.enrollment.intro} onChange={(event) => patch('enrollment', { intro: event.target.value })} />
        </div>
      </Section>
    </>
  );
}
