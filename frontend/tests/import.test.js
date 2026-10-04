import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, TEMPLATE_CSV, buildRows, guessMapping, parseDelimited, toIsoDate } from '../src/people/spreadsheet.js';

test('le colagem do Excel, CSV brasileiro com ponto e virgula e CSV com aspas e quebra de linha', () => {
  assert.deepEqual(parseDelimited('Aluno\tNascimento\nAna\t01/02/2020\n\n'), [['Aluno', 'Nascimento'], ['Ana', '01/02/2020']]);
  assert.deepEqual(parseDelimited('﻿Aluno;Turma\r\nBia;T1\r\n'), [['Aluno', 'Turma'], ['Bia', 'T1']]);
  assert.deepEqual(parseDelimited('Aluno,Obs\n"Souza, Ana","disse ""oi""\nna entrada"\n'),
    [['Aluno', 'Obs'], ['Souza, Ana', 'disse "oi"\nna entrada']]);
});

test('converte datas como a escola escreve e como o Excel guarda; data impossivel volta como esta', () => {
  assert.equal(toIsoDate('15/03/2021'), '2021-03-15');
  assert.equal(toIsoDate('5/3/2021'), '2021-03-05');
  assert.equal(toIsoDate('2021-03-15'), '2021-03-15');
  assert.equal(toIsoDate(new Date(Date.UTC(2021, 2, 15))), '2021-03-15');
  assert.equal(toIsoDate(44270), '2021-03-15');
  assert.equal(toIsoDate('31/02/2021'), '31/02/2021');
  assert.equal(toIsoDate('ontem'), 'ontem');
});

test('sugere as colunas pelos titulos comuns das escolas; cada campo recebe uma coluna so', () => {
  assert.deepEqual(guessMapping(['Aluno', 'Data Nasc.', 'Mãe', 'Celular da mãe', 'CPF da mãe', 'Pai', 'Turma', 'Série']),
    { student_name: 0, birth_date: 1, guardian_name: 2, guardian_phone: 3, guardian_cpf: 4, class_code: 6, level: 7 });
  assert.deepEqual(guessMapping(['Nome completo', 'Nascimento', 'Responsável', 'WhatsApp', 'E-mail', 'Parentesco', 'CPF']),
    { student_name: 0, birth_date: 1, guardian_name: 2, guardian_phone: 3, guardian_email: 4, relationship: 5, student_cpf: 6 });
  const template = parseDelimited(TEMPLATE_CSV);
  assert.deepEqual(guessMapping(template[0]), Object.fromEntries(FIELDS.map((f, i) => [f.key, i])));
});

test('monta as linhas com o numero da linha na planilha, ignora linhas vazias e corrige CPF numerico', () => {
  const table = [['Aluno', 'Nascimento', 'CPF', 'Responsável', 'Telefone'],
    ['Ana Fictícia', new Date(Date.UTC(2020, 1, 29)), 1234567890, '  Carla  ', 11988887777],
    ['', '', '', '', ''],
    ['Bia Fictícia', '01/02/2019', '', '', '']];
  const rows = buildRows(table, { student_name: 0, birth_date: 1, student_cpf: 2, guardian_name: 3, guardian_phone: 4 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { line: 2, student_name: 'Ana Fictícia', birth_date: '2020-02-29', student_cpf: '01234567890',
    guardian_name: 'Carla', guardian_phone: '11988887777', guardian_email: null, guardian_cpf: null, relationship: null,
    class_code: null, level: null });
  assert.equal(rows[1].line, 4);
  assert.equal(rows[1].birth_date, '2019-02-01');
  assert.equal(buildRows([['Aluno'], ['x'.repeat(400)]], { student_name: 0 })[0].student_name.length, 300);
});
