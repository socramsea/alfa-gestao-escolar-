# Roteiro e regras de trabalho

Este é o único roteiro vigente do Alfa Gestão Escolar ([ADR-003](decisoes/ADR-003-linha-oficial-e-roteiro-unico.md)). Ele diz o que já está pronto, o que falta para o MVP e como o trabalho entra no `main`. Toda entrega atualiza este arquivo no próprio PR.

- **Começo:** fundação e cadastros básicos (entregas 0 a 4).
- **Meio:** captação e matrícula de alunos novos (entregas 5 e 6).
- **Fim:** o MVP definido na [visão do produto](visao-negocio-e-arquitetura-do-mvp.md#8-fluxo-funcional-mínimo-do-mvp). O responsável vê a prévia da renovação e confirma; a secretaria aprova ou recusa. Tudo com dados fictícios da Escola Alfa Reis.

## Linha oficial

O monolito JS é a linha oficial: backend Node.js + Express sobre PostgreSQL com RLS, e frontend React + Vite. O `main` é a única fonte da verdade.

| Branch | Situação |
|---|---|
| `main` | Linha oficial. |
| `monolito-js`, `feat/profissionais-atribuicoes`, `minha-maquina` | Mesmo commit (entrega 4); absorvidas pelo `main`. Podem ser apagadas. |
| `claude/sleepy-hamilton-9df3wc`, `claude/entrega-5-site`, `claude/entrega-6-matricula-online`, `claude/correcoes-logica-matricula` | Mescladas no `main`. Podem ser apagadas. |
| `claude/prototipo-ts`, `claude/pode-entra-pc-ticyor` | Mesmo commit. Protótipo TypeScript paralelo, **arquivado**: não recebe mais trabalho. Fica como referência para a entrega 7: o fluxo de renovação, a decisão "cadastro completado pelo responsável via link pessoal" e a demonstração `docs/demo/demo-renovacao.html`. |

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
| 7 | Renovação de matrícula: abertura do período, prévia, confirmação pela família, análise e aprovação, matrícula do novo ano, histórico | Fim | Proposta; confirmar antes de iniciar |
| 8 | Perfis e permissões: secretaria sem acesso administrativo total e, se for a decisão, conta do responsável | Fim | Proposta; confirmar antes de iniciar |
| 9 | Correção e cancelamento de registros: corrigir aluno, responsável e vínculo; trocar de turma; cancelar matrícula; com histórico | Fim | Proposta; depende de decisão |
| 10 | Aceite do MVP: dados fictícios da Alfa Reis, fluxo completo executado, critérios abaixo, gate com Docker, smoke e piloto | Fim | — |

As entregas 5, 6 e 6.1 passaram nos testes sem Docker. O gate com Docker, o `deploy/smoke.py` e a atualização do piloto ainda não foram executados para elas; faça isso antes de atualizar o piloto, sem esperar a entrega 10.

Depois do MVP, na ordem da visão do produto: pedagógico, financeiro e produção. Cada um entra neste roteiro antes de começar.

## Critérios de aceite do MVP

Critérios da [visão do produto](visao-negocio-e-arquitetura-do-mvp.md#12-critérios-de-aceite-do-mvp). A situação considera o que está no `main`.

| Critério | Situação |
|---|---|
| Estrutura modular documentada | Atendido |
| Ambiente de desenvolvimento reproduzível | Atendido: Docker Compose e testes que recriam o banco |
| PostgreSQL inicializado por migrations | Atendido |
| Seeds criam dados fictícios do Demo | Parcial: só escola e administrador; falta a massa do Demo (entrega 10) |
| Login e autenticação | Atendido |
| Usuários e permissões validados | Parcial: só administrador da escola e da plataforma (entrega 8) |
| Dados isolados por `school_id` | Atendido |
| Responsável acessa somente seus próprios alunos | Falta (entregas 7 e 8) |
| Secretaria cadastra aluno e responsável | Parcial: só com perfil de administrador (entrega 8) |
| Vínculo aluno-responsável | Atendido |
| Turma e período configuráveis | Atendido |
| Responsável visualiza uma prévia | Falta para renovação (entrega 7); existe para aluno novo (entrega 6) |
| Responsável confirma os dados | Falta para renovação (entrega 7); existe para aluno novo (entrega 6) |
| Secretaria visualiza a solicitação | Falta para renovação (entrega 7); existe para aluno novo (entrega 6) |
| Secretaria aprova ou rejeita | Falta para renovação (entrega 7); existe para aluno novo (entrega 6) |
| Status, data, usuário e histórico registrados | Atendido nos fluxos existentes |
| Testes automatizados de autenticação, autorização e isolamento | Atendido |
| Nenhum dado real no Demo | Atendido até aqui |

## Decisões pendentes

Cada uma vira um ADR quando for tomada. Já decididas na mesclagem de 2026-10-04: as 7 decisões propostas da entrega 5 e a revisão da decisão 3 da entrega 6 (dados da ficha no cadastro, PR #2).

1. **Acesso do responsável na renovação:** pelo link pessoal com a data de nascimento, como na matrícula online, ou por conta própria. Define o desenho das entregas 7 e 8.
2. **Perfis:** quais papéis existem além do administrador (secretaria, direção, coordenação…) e o que cada um faz. É a matriz de permissões pendente na [arquitetura](architecture/arquitetura-sistema-escolar.md#11-pendências-de-detalhamento).
3. **Correção de registros:** o que pode ser corrigido ou cancelado, por quem e com que histórico (entrega 9).
4. **Recusa da escola na captação:** hoje aparece como "desistiu", misturando recusa da escola com desistência da família.

## Regras de trabalho

1. **O `main` é a fonte da verdade.** O que não está no `main` não está pronto.
2. **Uma entrega por vez.** Cada entrega sai de uma branch criada a partir do `main` atualizado e vira um PR para o `main`. A próxima só começa depois que a anterior foi mesclada. Correções da mesma entrega podem ir no mesmo PR.
3. **Nada fora do roteiro.** Começar algo que não está aqui exige primeiro um PR que atualize este roteiro. Mudança de escopo, de ordem ou de regra de segurança exige também um ADR, como manda o [controle de mudanças](visao-negocio-e-arquitetura-do-mvp.md#14-controle-de-mudanças).
4. **ADRs com numeração única** em `docs/decisoes/`, com status Proposta ou Aceito. Um número nunca é reutilizado; o próximo livre é o 004.
5. **Definição de pronto:**
   - testes do backend, do frontend e do navegador passando;
   - documento da entrega em `docs/architecture/entrega-N-*.md`, com o que foi feito e como foi validado;
   - este roteiro atualizado: situação da entrega e critérios afetados;
   - PR revisado e mesclado no `main`.
6. **Dados fictícios** até a aprovação formal de produção pela escola.
