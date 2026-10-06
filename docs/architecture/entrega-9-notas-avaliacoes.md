# Entrega 9 — notas e avaliações

Status: implementação concluída e validada com uma réplica do gate, sem Docker, em PostgreSQL 16, em 2026-10-06 (ver "Validação"). Ainda faltam o gate oficial com Docker (PostgreSQL 15) e o smoke de deploy. O PR só é mesclado depois do aceite do MVP 1 ([ADR-007](../decisoes/ADR-007-notas-e-avaliacoes-na-entrega-9.md)).

## Por que esta entrega

É o primeiro módulo pedagógico do MVP 2. A escola cria as avaliações de cada turma e lança as notas dos alunos matriculados. O sistema calcula a média ponderada sozinho, e nenhuma nota some: corrigir uma nota grava um novo lançamento com o motivo.

## Como funciona

Em **Notas** (`/secretaria/notas`):

1. **Tipos de avaliação:** a escola cadastra uma vez cada tipo (por exemplo, Prova com peso 2 e Trabalho com peso 1).
2. **Turma:** escolhe a turma. A tela mostra as avaliações em ordem de data e os alunos matriculados.
3. **Nova avaliação:** escolhe o tipo e informa título, data e peso. Sem peso, vale o do tipo. A data precisa estar dentro do período letivo da turma.
4. **Lançar notas:** escolhe a avaliação e digita as notas na lista de alunos, com vírgula ou ponto. Campos vazios ficam de fora. Ao salvar, vão juntas todas as notas novas e alteradas.
5. **Corrigir:** mudar uma nota já lançada pede o motivo da correção. A nota anterior fica no histórico como **Substituída**.
6. **Histórico da turma:** tabela de alunos × avaliações com a média de cada aluno. Notas corrigidas aparecem com `*`.
7. **Histórico de lançamentos:** para a avaliação escolhida, mostra cada nota com situação, motivo, autor e horário.

## Regras

- **Escala:** de 0 a 10, com até duas casas decimais. Nota zero é nota.
- **Peso:** maior que 0 e no máximo 100, com até duas casas.
- **Média:** Σ(nota × peso) / Σ(peso), só sobre as avaliações em que o aluno tem nota, com duas casas. O cálculo é feito no banco, a cada consulta, sobre as notas vigentes.
- **Nota vigente:** a que nenhuma outra corrigiu.
- **Quem recebe nota:** só alunos matriculados na turma da avaliação, no mesmo ano letivo.
- **Lote:**
  - de 1 a 200 notas;
  - tudo ou nada: com qualquer item recusado, nenhuma nota é gravada;
  - a resposta lista o erro de cada item pela posição (`items[].index`).
- **Correção:** precisa de `corrects_id` igual à nota vigente e de um motivo.
  - Sem `corrects_id`, um aluno que já tem nota é recusado: o envio não sobrescreve.
  - Com um `corrects_id` antigo, o lançamento é recusado (409), porque outra pessoa mudou a nota.
  - Nota corrigida igual à atual é recusada.
- **Concorrência:** um lançamento por vez em cada avaliação, com trava transacional. Dois envios simultâneos para o mesmo aluno gravam uma nota só; o outro recebe 409.
- **Idempotência:** toda escrita exige `Idempotency-Key`.
  - A mesma chave com os mesmos dados devolve o resultado original (200, `replayed: true`), sem gravar de novo.
  - A mesma chave com outros dados é recusada (409).
- **Só inserção:** o runtime não tem `UPDATE` nem `DELETE`. O banco também barra correção sem motivo, correção de outro aluno ou de outra avaliação, segunda nota original e segunda correção da mesma nota.
- **Evento `nota_lancada`:** cada nota gravada, original ou correção, publica uma linha em `outbox_events`, na mesma transação.
  - A linha leva `student_assessment_id`, `assessment_id`, `student_id` e `corrects_id`, sem nota nem nome.
  - Depois da confirmação, o canal `alfa_eventos` recebe `{"topic":"nota_lancada"}`, uma vez por lote.
- **Erros em português:** toda recusa da API de notas traz `error` com a mensagem para a secretaria.
  - Erros de campo trazem também `field`, por exemplo `scores.0.reason`.
  - Erros de lote trazem `items`.

## API e banco

| Rota | O que faz |
|---|---|
| `GET /api/assessments/types?page=` | Tipos de avaliação da escola, 100 por página |
| `POST /api/assessments/types` | Cria um tipo: `code`, `name`, `default_weight` |
| `GET /api/assessments?class_group_id=` | Lista da turma: `class_group`, `assessments` (com `scored_count`) e `students` (notas vigentes, `average`, `graded_count`) |
| `POST /api/assessments` | Cria uma avaliação: `class_group_id`, `assessment_type_id`, `title`, `held_on` e `weight` opcional |
| `GET /api/assessments/:id/scores` | Histórico de lançamentos da avaliação, inclusive notas substituídas |
| `POST /api/assessments/:id/scores` | Lança em lote: `scores[]` com `student_id`, `score` e, na correção, `corrects_id` e `reason` |

Todas as rotas exigem login de administrador da escola, validam a entrada com zod e trabalham dentro de `withTenant`. Usam SQL parametrizado, sem ORM.

A migration `013_assessments` cria cinco tabelas, todas com `school_id`, RLS `ENABLE` e `FORCE`, e só `SELECT` e `INSERT` para `alfa_app`. Nenhuma migration anterior foi alterada. A API confere o RLS dessas tabelas ao subir.

| Tabela | Conteúdo |
|---|---|
| `assessment_types` | Tipos de avaliação, com código único na escola e peso padrão |
| `assessments` | Avaliações da turma: tipo, título, data e peso; o ano letivo vem da turma |
| `student_assessments` | Notas: original (`corrects_id` nulo) ou correção (`corrects_id` e `reason`) |
| `assessment_events` | Registro de idempotência e auditoria: operação, chave, hash do pedido e as referências do resultado, sem copiar as notas |
| `outbox_events` | Canal interno de eventos: tópico `nota_lancada` e identificadores |

## Fora deste recorte

- Conta e perfil do professor: a secretaria lança com o acesso de administrador (entrega 11, perfis).
- Bimestres ou trimestres, recuperação, arredondamento por regra da escola, média mínima e situação de aprovação.
- Frequência, boletim, visão da família e aviso às famílias.
- Disciplinas: a avaliação é da turma.
- Um consumidor de `nota_lancada`: os eventos ficam na tabela de saída até existir um módulo de mensagens no roteiro.
- Edição ou exclusão de tipos e avaliações.

## Aceite

| # | Critério | Situação |
|---|---|---|
| 1 | A escola cadastra tipos de avaliação com peso padrão | Atendido nos testes |
| 2 | A escola cria avaliações da turma dentro do período letivo | Atendido nos testes |
| 3 | A secretaria lança as notas da turma em lote, pela lista de alunos | Atendido nos testes |
| 4 | A média ponderada aparece por aluno e confere com Σ(nota × peso) / Σ(peso) | Atendido nos testes |
| 5 | A correção grava novo lançamento com motivo, e a nota original continua no histórico | Atendido nos testes |
| 6 | Reenvio não duplica; envio simultâneo não grava duas notas | Atendido nos testes |
| 7 | Uma escola não vê nem lança notas de outra | Atendido nos testes |
| 8 | Os erros aparecem em português | Atendido nos testes |
| 9 | O evento `nota_lancada` é gravado com as notas, e só quando elas são gravadas | Atendido nos testes |
| 10 | O gate oficial com Docker e o smoke de deploy passam | Falta |
| 11 | O responsável percorre a tela com dados fictícios e aprova | Falta |

## Validação executada em 2026-10-06

A validação usou uma réplica do `npm run test:gate`, sem Docker. Ela segue as mesmas etapas do script:
- cluster PostgreSQL 16 novo e descartável;
- migrations com as provas de preflight;
- seeds e checagem de idempotência dos seeds;
- API isolada;
- suíte completa do backend;
- checagem de sintaxe;
- testes de navegador.

O Chromium rodou sem sandbox, só por ser root neste ambiente. O gate oficial usa PostgreSQL 15 em Docker.

| Suíte | Resultado |
|---|---|
| Backend (`node --test`) | 148 de 148, sendo 9 novos de notas |
| Frontend (`npm test`) | 31 de 31, sendo 4 novos de notas |
| Navegador (Playwright) | 9 de 9, com o fluxo novo de notas |

- **Testes novos de backend:**
  - tipos e período letivo;
  - lote e média;
  - correção e histórico;
  - lote tudo ou nada com erros por item;
  - idempotência;
  - evento `nota_lancada`, com `LISTEN` real no canal;
  - RLS entre duas escolas;
  - só inserção, RLS `FORCE` e checagem na partida;
  - concorrência.
- **Fluxo no navegador:**
  - cria o tipo, duas avaliações e as notas pela tela;
  - confere as médias 7,0 e 6,0;
  - recusa nota 11 e correção sem motivo;
  - corrige com motivo e confere a média 6,67 e o histórico;
  - recarrega e confere de novo.
- **Mudanças de apoio:**
  - O gate passa a montar o frontend antes do teste de navegador, para não testar um `dist` antigo.
  - O `deploy/smoke.py` tem as contagens novas: 7 turmas, 7 alunos, 6 matrículas e as tabelas de notas. Elas foram conferidas no banco depois de todos os specs.
