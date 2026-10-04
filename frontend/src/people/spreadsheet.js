// Leitura de planilhas da escola para a importação: CSV, colagem do Excel/Google Planilhas e .xlsx.
// Funções puras, sem React, para serem testadas sozinhas.

export const MAX_ROWS = 500;

// Campos do sistema, na ordem da tela. Cada coluna da planilha pode ir para um deles.
export const FIELDS = [
  { key: 'student_name', label: 'Nome do aluno', required: true },
  { key: 'birth_date', label: 'Data de nascimento do aluno', required: true },
  { key: 'student_cpf', label: 'CPF do aluno' },
  { key: 'guardian_name', label: 'Nome do responsável' },
  { key: 'guardian_phone', label: 'Telefone (WhatsApp) do responsável' },
  { key: 'guardian_email', label: 'E-mail do responsável' },
  { key: 'guardian_cpf', label: 'CPF do responsável' },
  { key: 'relationship', label: 'Parentesco' },
  { key: 'class_code', label: 'Turma (código)' },
  { key: 'level', label: 'Série ou grupo' }
];

const plain = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Reconhece o título da coluna; a ordem importa ("CPF do responsável" é CPF, não nome).
const RULES = [
  [h => /cpf/.test(h) && /(resp|mae|pai|famil)/.test(h), 'guardian_cpf'],
  [h => /cpf/.test(h), 'student_cpf'],
  [h => /e-?mail/.test(h), 'guardian_email'],
  [h => /(telefone|celular|whats|fone|contato)/.test(h), 'guardian_phone'],
  [h => /(nascimento|nasc\b|data)/.test(h), 'birth_date'],
  [h => /(parentesco|relacao|vinculo|grau)/.test(h), 'relationship'],
  [h => /(serie|ano escolar|grupo|nivel|segmento)/.test(h), 'level'],
  [h => /(turma|classe|sala)/.test(h), 'class_code'],
  [h => /(responsavel|mae|pai|familiar)/.test(h), 'guardian_name'],
  [h => /(aluno|aluna|estudante|crianca|nome)/.test(h), 'student_name']
];

// Sugere qual coluna vai para cada campo; cada campo recebe no máximo uma coluna.
export function guessMapping(headers) {
  const mapping = {};
  headers.forEach((header, index) => {
    const h = plain(header);
    const rule = RULES.find(([test, key]) => mapping[key] === undefined && test(h));
    if (rule) mapping[rule[1]] = index;
  });
  return mapping;
}

// Texto delimitado: tabulação (colado do Excel), ponto e vírgula (CSV brasileiro) ou vírgula, com aspas.
export function parseDelimited(text) {
  const source = text.replace(/^﻿/, '');
  const first = source.split(/\r?\n/).find(line => line.trim()) ?? '';
  const sep = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim()));
}

const iso = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date.toISOString().slice(0, 10) : null;
};

// Datas como a escola escreve (dd/mm/aaaa), como o Excel guarda (data ou número de série) ou já em aaaa-mm-dd.
// Uma data que não dá para entender volta como está, e a prévia aponta o erro na linha.
export function toIsoDate(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    if (value < 1 || value > 2958465) return String(value);
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  let m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1])) ?? text;
  m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3])) ?? text;
  return text;
}

function cellText(value, key) {
  if (value === null || value === undefined) return '';
  if (key === 'birth_date') return toIsoDate(value);
  // O Excel guarda CPF digitado como número e perde o zero à esquerda.
  if ((key === 'student_cpf' || key === 'guardian_cpf') && typeof value === 'number') return String(Math.trunc(value)).padStart(11, '0');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  return String(value).trim();
}

// Transforma a tabela (primeira linha = títulos) nas linhas que a API recebe, com o número da linha na planilha.
export function buildRows(table, mapping) {
  const rows = [];
  table.slice(1).forEach((cells, index) => {
    const row = { line: index + 2 };
    let filled = false;
    for (const { key } of FIELDS) {
      const column = mapping[key];
      const text = column === undefined || column === '' ? '' : cellText(cells[column], key).slice(0, 300);
      row[key] = text || null;
      if (text) filled = true;
    }
    if (filled) rows.push(row);
  });
  return rows;
}

// Modelo para a escola preencher: ponto e vírgula e BOM, para o Excel abrir com acentos.
export const TEMPLATE_CSV = '﻿' + [
  FIELDS.map(f => f.label).join(';'),
  'Ana Fictícia Souza;15/03/2021;;Carla Fictícia Souza;(11) 98888-7777;carla@exemplo.test;;Mãe;T1;Infantil 4'
].join('\r\n') + '\r\n';
