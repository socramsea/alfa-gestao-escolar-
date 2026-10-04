# ADR-003 — Linha oficial e roteiro único

Status: **ACEITO**, por decisão do responsável pelo projeto em 2026-10-04 (linha oficial). As entregas 7 a 10 do roteiro são propostas e precisam ser confirmadas antes de começar.

## Contexto

Até 2026-10-04 o projeto tinha três linhas de código sem rumo comum:

- **`main`:** um esqueleto TypeScript da fase 0, parado desde 22/09.
- **Monolito JS:** sem nenhum commit em comum com o `main`, mas com as entregas 1 a 6.
- **Protótipo TypeScript:** derivado do `main`, com renovação, portal do responsável, site e captação.

Cada linha seguia uma sequência própria:

- a "Ordem oficial de desenvolvimento" da [visão do MVP](../visao-negocio-e-arquitetura-do-mvp.md);
- a "Sequência de implementação" da [arquitetura](../architecture/arquitetura-sistema-escolar.md);
- a numeração das entregas realmente feitas, que não bate com nenhuma das duas.

O site e a captação foram construídos duas vezes no mesmo dia. O fluxo que define o fim do MVP, a renovação confirmada pelo responsável e aprovada pela secretaria, só existia no protótipo. Nenhum PR tinha sido mesclado, e havia dois ADR-001 e dois ADR-002 diferentes.

## Decisão

1. **O monolito JS é a linha oficial** e passa a ser o `main`. A fusão preserva os dois históricos. Os documentos de negócio do `main` continuam valendo como definição do MVP.
2. **[`docs/ROTEIRO.md`](../ROTEIRO.md) é a única sequência vigente.** A "Ordem oficial de desenvolvimento" da visão do MVP e a "Sequência de implementação" da arquitetura ficam como registro histórico.
3. **O fim do MVP é o da visão do produto:** o fluxo de renovação executado com dados fictícios da Escola Alfa Reis, com os critérios de aceite atendidos.
4. **O trabalho segue as regras do roteiro:** uma entrega por vez, por PR para o `main`; nada fora do roteiro; ADRs com numeração única; e a definição de pronto.
5. **O protótipo TypeScript é arquivado.** O fluxo de renovação, a decisão de cadastro pelo responsável via link pessoal e a demonstração clicável servem de referência para a entrega 7. Se adotada, essa decisão recebe um número novo nesta sequência.

## Consequências

- As entregas em andamento entram no `main` nesta ordem: entrega 5 (PR #1), entrega 6 e as correções do PR #2. Cada PR passa a apontar para o `main` depois que o anterior for mesclado.
- A numeração de ADRs continua a do monolito; o próximo livre é o 004.
- As branches absorvidas ou arquivadas não recebem mais trabalho. Apagá-las é uma decisão à parte.
