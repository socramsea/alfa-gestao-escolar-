import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { FIELDS, MAX_ROWS, TEMPLATE_CSV, buildRows, guessMapping, parseDelimited } from '../people/spreadsheet.js';

const STATUS = { novo: ['Novo', 'status approved'], existente: ['Já cadastrado', 'status'], erro: ['Erro', 'status pending'], pronto: ['Sem erro', 'status'] };
const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;

// Importação de planilha: a escola arrasta a lista que já tem, confere a prévia linha a linha e importa.
export default function ImportPanel({ onImported }) {
  const { people, structure } = useAuth();
  const [table, setTable] = useState(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState({});
  const [years, setYears] = useState([]);
  const [yearId, setYearId] = useState('');
  const [legal, setLegal] = useState(true);
  const [pasted, setPasted] = useState('');
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const items = []; let page = 1;
      for (;;) { const d = await structure(`academic-years?page=${page++}`, { signal: controller.signal }); items.push(...d.items); if (!d.has_more) break; }
      setYears(items);
    })().catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [structure]);

  function load(rows, name) {
    setPreview(null); setDone(null); setError('');
    if (!rows.length || rows.length < 2) { setTable(null); setError('A planilha precisa de uma linha de títulos e pelo menos um aluno.'); return; }
    if (rows.length - 1 > MAX_ROWS) { setTable(null); setError(`A planilha tem ${rows.length - 1} linhas. Importe no máximo ${MAX_ROWS} de cada vez.`); return; }
    setTable(rows); setFileName(name); setMapping(guessMapping(rows[0]));
  }
  async function readFile(file) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import('read-excel-file/browser');
        load(await readSheet(file), file.name);
      } else if (/\.(csv|txt)$/i.test(file.name)) load(parseDelimited(await file.text()), file.name);
      else setError('Use uma planilha .xlsx ou .csv. Arquivos .xls antigos: abra no Excel e salve como .xlsx.');
    } catch { setError('Não foi possível ler a planilha. Confira se o arquivo abre no Excel e tente de novo.'); }
    finally { setBusy(false); }
  }
  function drop(e) { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files?.[0]); }

  const headers = table?.[0] ?? [];
  const usesClass = mapping.class_code !== undefined && mapping.class_code !== '';
  const missing = FIELDS.filter(f => f.required && (mapping[f.key] === undefined || mapping[f.key] === ''));
  const payload = rows => ({ academic_year_id: usesClass ? yearId || null : null, guardians_are_legal: legal, rows });
  const ready = table && !missing.length && (!usesClass || yearId);

  async function check() {
    setBusy(true); setError(''); setPreview(null); setDone(null);
    try {
      const rows = buildRows(table, mapping);
      if (!rows.length) { setError('Nenhuma linha com dados nas colunas escolhidas.'); return; }
      const result = await people('imports/preview', { method: 'POST', body: JSON.stringify(payload(rows)) });
      setPreview({ ...result, sent: rows });
    } catch (e) { setError(e.status === 404 ? 'O período letivo escolhido não está disponível para a sua escola.' : e.message); }
    finally { setBusy(false); }
  }
  async function confirm() {
    const ok = new Set(preview.rows.filter(r => r.status !== 'erro').map(r => r.line));
    const body = JSON.stringify(payload(preview.sent.filter(r => ok.has(r.line))));
    if (!attempt.current || attempt.current.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const result = await people('imports', { method: 'POST', body, headers: { 'Idempotency-Key': attempt.current.key } });
      attempt.current = null; setDone(result.summary); setPreview(null); setTable(null); setPasted('');
      onImported?.();
    } catch (e) {
      setError(e.body?.error || e.message);
      if (e.body?.rows) setPreview(p => ({ ...p, rows: e.body.rows, can_import: false }));
    } finally { setBusy(false); }
  }

  const names = new Map((preview?.sent ?? []).map(r => [r.line, r.student_name]));
  const errors = preview?.rows.filter(r => r.status === 'erro').length ?? 0;
  const valid = (preview?.rows.length ?? 0) - errors;
  const s = preview?.summary;

  return <>
    <section className="panel" aria-labelledby="import-title">
      <h2 id="import-title">Importar planilha de alunos e responsáveis</h2>
      <p>Envie a lista que a escola já tem. O sistema cria os alunos, os responsáveis e os vínculos e, se a planilha disser a turma, já faz a matrícula. Nada é gravado antes de você conferir a prévia. Use dados fictícios neste piloto.</p>
      <div className={`drop-zone${dragging ? ' dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)} onDrop={drop}>
        <p><strong>Arraste a planilha para cá</strong> ou</p>
        <label className="secondary-button" htmlFor="import-file">Escolher arquivo</label>
        <input id="import-file" className="visually-hidden" type="file" accept=".xlsx,.csv,.txt" disabled={busy}
          onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
        <p className="drop-hint">Excel (.xlsx) ou CSV, até {MAX_ROWS} alunos. Primeira linha com os títulos das colunas. <a href={templateHref} download="modelo-importacao-alunos.csv">Baixar modelo</a></p>
      </div>
      <details className="paste-box"><summary>Ou cole as linhas copiadas do Excel ou do Google Planilhas</summary>
        <label htmlFor="import-paste" className="visually-hidden">Linhas coladas da planilha</label>
        <textarea id="import-paste" rows={6} value={pasted} onChange={e => setPasted(e.target.value)} placeholder="Cole aqui, com a linha de títulos" />
        <button type="button" className="secondary-button" disabled={busy || !pasted.trim()} onClick={() => load(parseDelimited(pasted), 'linhas coladas')}>Usar linhas coladas</button>
      </details>
      {error && <div className="error-message" role="alert">{error}</div>}
      {done && <div className="success-message" role="status">
        <strong>Importação concluída.</strong> {done.students_created} aluno(s) novo(s), {done.students_existing} já cadastrado(s), {done.guardians_created} responsável(is) novo(s), {done.guardians_reused} reaproveitado(s), {done.links_created} vínculo(s) e {done.enrollments_created} matrícula(s).
      </div>}
    </section>

    {table && <section className="panel" aria-labelledby="map-title">
      <h2 id="map-title">Que coluna é o quê</h2>
      <p>{fileName}: {table.length - 1} linha(s). O sistema sugeriu pelas colunas da planilha; ajuste se precisar.</p>
      <form className="structure-form" onSubmit={e => { e.preventDefault(); check(); }}><fieldset disabled={busy}>
        {FIELDS.map(f => <div key={f.key}><label htmlFor={`map-${f.key}`}>{f.label}{f.required ? ' (obrigatório)' : ''}</label>
          <select id={`map-${f.key}`} value={mapping[f.key] ?? ''} onChange={e => { const v = e.target.value; setPreview(null); setMapping(m => ({ ...m, [f.key]: v === '' ? '' : Number(v) })); }}>
            <option value="">— não usar —</option>
            {headers.map((h, i) => <option key={i} value={i}>{String(h ?? '').trim() || `Coluna ${i + 1}`}</option>)}
          </select></div>)}
        {usesClass && <div><label htmlFor="import-year">Período letivo das turmas (obrigatório)</label>
          <select id="import-year" value={yearId} onChange={e => { setYearId(e.target.value); setPreview(null); }}>
            <option value="">Selecione</option>{years.map(y => <option key={y.id} value={y.id}>{y.code}</option>)}
          </select></div>}
        <label className="check-label wide"><input type="checkbox" checked={legal} onChange={e => { setLegal(e.target.checked); setPreview(null); }} />Os responsáveis da planilha são responsáveis legais pelos alunos</label>
        {missing.length > 0 && <p className="field-error wide">Escolha a coluna de: {missing.map(f => f.label.toLowerCase()).join(', ')}.</p>}
        <div className="structure-tabs wide"><button className="primary-button" disabled={busy || !ready}>{busy ? 'Conferindo…' : 'Conferir antes de importar'}</button></div>
      </fieldset></form>
    </section>}

    {preview && <section className="panel" aria-labelledby="preview-title">
      <h2 id="preview-title">Prévia</h2>
      <p role="status">{s.students_created} aluno(s) novo(s), {s.students_existing} já cadastrado(s), {s.guardians_created} responsável(is) novo(s), {s.guardians_reused} já cadastrado(s), {s.links_created} vínculo(s) e {s.enrollments_created} matrícula(s).
        {errors > 0 && <strong> {errors} linha(s) com erro ficam de fora. Corrija na planilha e envie de novo, ou importe só as linhas sem erro.</strong>}</p>
      <div className="table-wrapper"><table>
        <thead><tr><th>Linha</th><th>Aluno</th><th>Situação</th><th>O que vai acontecer</th></tr></thead>
        <tbody>{preview.rows.map(r => <tr key={r.line}>
          <td>{r.line}</td><td>{names.get(r.line) || '—'}</td>
          <td><span className={STATUS[r.status]?.[1] ?? 'status'}>{STATUS[r.status]?.[0] ?? r.status}</span></td>
          <td>{r.errors.length ? <span className="field-error">{r.errors.join(' ')}</span> : r.actions.join(', ')}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="structure-tabs">
        <button type="button" className="primary-button" disabled={busy || !valid} onClick={confirm}>
          {busy ? 'Importando…' : errors ? `Importar só as ${valid} linha(s) sem erro` : `Importar ${valid} linha(s)`}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setPreview(null)}>Voltar</button>
      </div>
    </section>}
  </>;
}

