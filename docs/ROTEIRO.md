# Roteiro e regras de trabalho

Este é o único roteiro vigente do Alfa Gestão Escolar ([ADR-003](decisoes/ADR-003-linha-oficial-e-roteiro-unico.md)). Ele diz o que já está pronto, o que falta e como o trabalho entra no `main`. Toda entrega atualiza este arquivo no próprio PR.

O MVP sai em duas etapas ([ADR-004](decisoes/ADR-004-mvp-em-duas-etapas.md)):

- **MVP 1, matrícula sem papel da unidade nova:** do site da escola até o aluno matriculado na turma, mais a importação da planilha que a escola já tem ([ADR-005](decisoes/ADR-005-importacao-de-planilha.md)). Falta colocar no ar e aceitar. Ver [`docs/MVP-1.md`](MVP-1.md).
- **MVP 2, notas e renovação dos alunos atuais:** primeiro as notas e avaliações da turma ([ADR-007](decisoes/ADR-007-notas-e-avaliacoes-na-entrega-9.md)); depois o MVP original da [visão do produto](visao-negocio-e-arquitetura-do-mvp.md#8-fluxo-funcional-mínimo-do-mvp), em que a família vê a prévia e confirma e a secretaria aprova ou recusa; e a frequência, depois dos perfis ([ADR-008](decisoes/ADR-008-frequencia-mensagens-documentos-comunicacoes.md)).

Até o MVP 1, o caminho tem começo, meio e fim:

- **Começo:** fundação e cadastros básicos (entregas 0 a 4). Feito e testado no piloto.
- **Meio:** captação, matrícula de aluno novo e importação de planilha (entregas 5 a 7). Feito, falta validar no ar. **Estamos aqui.**
- **Fim:** sistema no ar e aceite do MVP 1 (entrega 8), apresentado na reunião de 06/10.

## Cronograma até a reunião de 06/10

| Quando | O que | Quem |
|---|---|---|
| Dom 04, noite | Importação de planilha pronta e no `main` (entrega 7) | Claude |
| Dom 04, noite | Guia e scripts para colocar no ar numa VPS ([`deploy/NO-AR.md`](../deploy/NO-AR.md)) | Claude |
| Seg 05 | Sem servidor contratado a tempo. A reunião roda no piloto do computador do responsável (Pop!_OS), aberto pela internet por um túnel com HTTPS: guia e scripts em [`deploy/NO-AR-COMPUTADOR.md`](../deploy/NO-AR-COMPUTADOR.md) | Claude |
| Seg 05 | Limites do nginx (login, pré-matrícula e família) contados por visitante atrás do Caddy ou do túnel ([ADR-006](decisoes/ADR-006-ip-real-nos-limites-do-nginx.md)) | Claude |
| Seg 05 | Falta enviar os títulos das colunas da planilha da escola, sem dados, e decidir entre conta compartilhada ou uma escola por participante | Responsável |
| Seg 05 | Teste completo com Docker, atualização do piloto, escola da reunião e contas dos participantes | Responsável, com o guia; Claude corrige se falhar |
| Seg 05, noite | Ensaio do passo a passo do [MVP 1](MVP-1.md) pelo endereço do túnel, de um celular fora do Wi-Fi | Responsável e Claude |
| Seg 05, noite | Congelamento: depois disso, só correção | — |
| Ter 06, 17h | Túnel aberto, endereço conferido no celular e enviado aos participantes; plano B: piloto local e capturas de tela | Responsável |
| Ter 06, 18h | Reunião e aceite do MVP 1 | Responsável |
| Depois da reunião | Servidor próprio (VPS) com o guia [`deploy/NO-AR.md`](../deploy/NO-AR.md), para o sistema ficar no ar sem depender do computador | Responsável e Claude |

## Linha oficial

O monolito JS é a linha oficial: backend Node.js + Express sobre PostgreSQL com RLS, e frontend React + Vite. O `main` é a única fonte da verdade.

| Branch | Situação |
|---|---|
| `main` | Linha oficial. |
| `monolito-js`, `feat/profissionais-atribuicoes`, `minha-maquina` | Mesmo commit (entrega 4); absorvidas pelo `main`. Podem ser apagadas. |
| `claude/entrega-5-site`, `claude/entrega-6-matricula-online`, `claude/correcoes-logica-matricula` | Mescladas no `main`. Podem ser apagadas. |
| `claude/prototipo-ts`, `claude/pode-entra-pc-ticyor` | Mesmo commit. Protótipo TypeScript paralelo, **arquivado**: não recebe mais trabalho. Fica como referência para a renovação (entrega 10): o fluxo, a decisão "cadastro completado pelo responsável via link pessoal" e a demonstração `docs/demo/demo-renovacao.html`. |

O esqueleto TypeScript da fase 0 continua no histórico do `main`, antes da adoção do monolito.

## Entregas

| # | Entrega | Etapa | Situação |
|---|---|---|---|
| 0 | Fundação: login, autorização, isolamento por escola com RLS, auditoria | Começo | No `main` ([ADR-001](decisoes/ADR-001-isolamento-multi-escola.md), [ADR-002](decisoes/ADR-002-restricao-alfa-auth.md)) |
| 1 | [Configuração e estrutura](architecture/entrega-1-configuracao-estrutura.md): etapas, períodos, séries, turnos, turmas | Começo | No `main` |
| 2 | [Pessoas e vínculos](architecture/entrega-2-pessoas-vinculos.md): alunos, responsáveis, vínculo | Começo | No `main` |
| 3 | [Matrículas](architecture/entrega-3-matriculas.md): aluno em turma por período | Começo | No `main` |
| 4 | [Profissionais e atribuições](architecture/entrega-4-profissionais-atribuicoes.md) | Começo | No `main` |
| 5 | [Site da escola, pré-matrícula e captação](architecture/entrega-5-site-e-captacao.md) | Meio | No `main` ([PR #1](https://github.com/socramsea/alfa-gestao-escolar-/pull/1)) |
| 6 | [Matrícula online de aluno novo pela família](architecture/entrega-6-matricula-online.md) | Meio | No `main` ([PR #4](https://github.com/socramsea/alfa-gestao-escolar-/pull/4)) |
| 6.1 | [Correções de lógica da captação e da matrícula online](architecture/entrega-6-matricula-online.md#correções-após-revisão-2026-10-04) | Meio | No `main` ([PR #2](https://github.com/socramsea/alfa-gestao-escolar-/pull/2)) |
| 7 | [Importação de planilha](architecture/entrega-7-importacao-planilha.md): alunos, responsáveis, vínculos e matrículas a partir da lista da escola | Meio | No `main` ([PR #6](https://github.com/socramsea/alfa-gestao-escolar-/pull/6)) |
| 8 | **No ar e aceite do MVP 1:** teste completo com Docker, sistema online com HTTPS (na reunião, a partir do computador do responsável por um túnel, [guia](../deploy/NO-AR-COMPUTADOR.md); depois, numa VPS, [guia](../deploy/NO-AR.md)), contas de demonstração e [passo a passo de demonstração](MVP-1.md#passo-a-passo-de-demonstração) aprovado pelo responsável | Fim do MVP 1 | **Em andamento**, até 06/10 às 18h |
| 9 | [Notas e avaliações](architecture/entrega-9-notas-avaliacoes.md): tipos de avaliação, avaliações da turma, lançamento em lote, média ponderada, correção com histórico e evento `nota_lancada` ([ADR-007](decisoes/ADR-007-notas-e-avaliacoes-na-entrega-9.md)) | MVP 2 | Em revisão ([PR #11](https://github.com/socramsea/alfa-gestao-escolar-/pull/11)); mescla depois do aceite do MVP 1 |
| 10 | Renovação de matrícula: abertura do período, prévia, confirmação pela família, análise e aprovação, matrícula do novo ano, histórico | MVP 2 | Proposta; depende das decisões 1 e 2 |
| 11 | Perfis e permissões: secretaria sem acesso administrativo total e, se for a decisão, conta do responsável | MVP 2 | Proposta; depende da decisão 2 |
| 12 | Frequência: chamada por turma e dia pelo professor, presença como padrão, justificativa em até 5 dias úteis e alerta à coordenação abaixo de 75% ([ADR-008](decisoes/ADR-008-frequencia-mensagens-documentos-comunicacoes.md)) | MVP 2 | Decidida; depende da entrega 11 (conta de professor) |
| 13 | Correção e cancelamento de registros: corrigir aluno, responsável e vínculo; trocar de turma; cancelar matrícula; com histórico | MVP 2 | Proposta; depende da decisão 3 |
| 14 | Aceite do MVP 2: dados fictícios da Alfa Reis, notas lançadas, frequência registrada, fluxo de renovação executado, critérios abaixo, gate com Docker, smoke e piloto | MVP 2 | — |

Depois do MVP 2, nesta ordem ([ADR-008](decisoes/ADR-008-frequencia-mensagens-documentos-comunicacoes.md); detalhes em [`integracoes-zapi-zapsign.md`](architecture/integracoes-zapi-zapsign.md)):

1. Mensagens por WhatsApp (Z-API), só transacionais.
2. Documentos e assinatura eletrônica (ZapSign).
3. Comunicações às famílias.

Pré-requisitos dos três:
- servidor próprio com domínio e HTTPS;
- contratos de tratamento de dados (DPA) assinados com os dois fornecedores;
- consentimento das famílias.

Depois deles: o restante do pedagógico (bimestres e boletim), financeiro e produção. Cada um ganha número de entrega ao entrar neste roteiro, antes de começar.

## Critérios de aceite

### MVP 1

São 16 critérios, listados em [`docs/MVP-1.md`](MVP-1.md#critérios-de-aceite):

- 5 atendidos;
- 8 construídos, que faltam validar no ar;
- 1 parcial: falta o teste com Docker;
- 2 que faltam: o sistema no ar e a aprovação do responsável.

### MVP 2

Critérios da [visão do produto](visao-negocio-e-arquitetura-do-mvp.md#12-critérios-de-aceite-do-mvp). A situação considera o que está no `main`.

| Critério | Situação |
|---|---|
| Estrutura modular documentada | Atendido |
| Ambiente de desenvolvimento reproduzível | Atendido: Docker Compose e testes que recriam o banco |
| PostgreSQL inicializado por migrations | Atendido |
| Seeds criam dados fictícios do Demo | Parcial: só escola e administrador; falta a massa do Demo (entrega 14) |
| Login e autenticação | Atendido |
| Usuários e permissões validados | Parcial: só administrador da escola e da plataforma (entrega 11) |
| Dados isolados por `school_id` | Atendido |
| Responsável acessa somente seus próprios alunos | Falta (entregas 10 e 11) |
| Secretaria cadastra aluno e responsável | Parcial: só com perfil de administrador (entrega 11); também por planilha (entrega 7) |
| Vínculo aluno-responsável | Atendido |
| Turma e período configuráveis | Atendido |
| Responsável visualiza uma prévia | Falta para renovação (entrega 10); existe para aluno novo (MVP 1) |
| Responsável confirma os dados | Falta para renovação (entrega 10); existe para aluno novo (MVP 1) |
| Secretaria visualiza a solicitação | Falta para renovação (entrega 10); existe para aluno novo (MVP 1) |
| Secretaria aprova ou rejeita | Falta para renovação (entrega 10); existe para aluno novo (MVP 1) |
| Notas e avaliações da turma, com média ponderada e correção com histórico | Construído (entrega 9); falta o gate com Docker e o aceite |
| Frequência por turma e dia, com justificativa e alerta abaixo de 75% | Falta (entrega 12) |
| Status, data, usuário e histórico registrados | Atendido nos fluxos existentes |
| Testes automatizados de autenticação, autorização e isolamento | Atendido |
| Nenhum dado real no Demo | Atendido até aqui |

## Decisões pendentes

Cada uma vira um ADR quando for tomada. As três primeiras só são necessárias para o MVP 2.

Já decididas de 2026-10-04 a 2026-10-06:
- as 7 decisões propostas da entrega 5;
- a revisão da decisão 3 da entrega 6: dados da ficha no cadastro (PR #2);
- o MVP em duas etapas ([ADR-004](decisoes/ADR-004-mvp-em-duas-etapas.md));
- a importação de planilha no MVP 1 ([ADR-005](decisoes/ADR-005-importacao-de-planilha.md));
- o IP real do visitante nos limites do nginx ([ADR-006](decisoes/ADR-006-ip-real-nos-limites-do-nginx.md));
- notas e avaliações como entrega 9, no MVP 2, com renumeração das seguintes ([ADR-007](decisoes/ADR-007-notas-e-avaliacoes-na-entrega-9.md));
- frequência como entrega 12, no MVP 2, e mensagens (Z-API), documentos e assinatura (ZapSign) e comunicações depois do MVP 2, com risco aceito da conexão não oficial da Z-API e as regras de LGPD, consentimento, credenciais, armazenamento, frequência e processamento de eventos ([ADR-008](decisoes/ADR-008-frequencia-mensagens-documentos-comunicacoes.md)).

1. **Acesso do responsável na renovação:** pelo link pessoal com a data de nascimento, como na matrícula online, ou por conta própria. Define o desenho das entregas 10 e 11.
2. **Perfis:** quais papéis existem além do administrador (secretaria, direção, coordenação…) e o que cada um faz. É a matriz de permissões pendente na [arquitetura](architecture/arquitetura-sistema-escolar.md#11-pendências-de-detalhamento).
3. **Correção de registros:** o que pode ser corrigido ou cancelado, por quem e com que histórico (entrega 13).
4. **Recusa da escola na captação:** hoje aparece como "desistiu", misturando recusa da escola com desistência da família.

## Regras de trabalho

1. **O `main` é a fonte da verdade.** O que não está no `main` não está pronto.
2. **Uma entrega por vez.** Cada entrega sai de uma branch criada a partir do `main` atualizado e vira um PR para o `main`. A próxima só começa depois que a anterior foi mesclada. Correções da mesma entrega podem ir no mesmo PR.
3. **Nada fora do roteiro.** Começar algo que não está aqui exige primeiro um PR que atualize este roteiro. Mudança de escopo, de ordem ou de regra de segurança exige também um ADR, como manda o [controle de mudanças](visao-negocio-e-arquitetura-do-mvp.md#14-controle-de-mudanças).
4. **ADRs com numeração única** em `docs/decisoes/`, com status Proposta ou Aceito. Um número nunca é reutilizado; o próximo livre é o 009.
5. **Definição de pronto:**
   - testes do backend, do frontend e do navegador passando;
   - documento da entrega em `docs/architecture/entrega-N-*.md`, com o que foi feito e como foi validado;
   - este roteiro atualizado: situação da entrega e critérios afetados;
   - PR revisado e mesclado no `main`.
6. **Dados fictícios** até a aprovação formal de produção pela escola.
