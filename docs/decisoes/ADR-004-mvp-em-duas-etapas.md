# ADR-004 — MVP em duas etapas: matrícula sem papel, depois renovação

Status: **ACEITO**, por decisão do responsável pelo projeto em 2026-10-04.

## Contexto

O projeto tinha duas ideias de MVP ao mesmo tempo, e cada uma apontava para um fim diferente:

- **A [visão do produto](../visao-negocio-e-arquitetura-do-mvp.md), de 22/09:** o MVP é a renovação dos alunos atuais. A família vê a prévia e confirma, e a secretaria aprova. Não foi construído.
- **O que o responsável pediu em 04/10:** a escola vai abrir uma unidade nova que deve nascer sem papel. A captação e a matrícula de aluno novo foram construídas nas entregas 5 e 6 e estão no `main`.

O [roteiro](../ROTEIRO.md) tentava cumprir as duas ideias, e o fim ficava indefinido.

## Decisão

1. **O MVP 1 é a matrícula sem papel da unidade nova:** do site da escola até o aluno matriculado na turma. A definição, os critérios de aceite e o passo a passo de demonstração estão em [`docs/MVP-1.md`](../MVP-1.md).
2. **No piloto do MVP 1, a secretaria usa o acesso de administrador.** Perfis próprios ficam para o MVP 2.
3. **O MVP 1 está aceito quando:**
   - o teste completo com Docker passa;
   - o piloto está atualizado;
   - o responsável pelo projeto percorre o caminho completo com dados fictícios e aprova.
4. **O MVP 2 é o MVP original da visão do produto:** a renovação, com os perfis e a correção de registros. O fluxo e os 18 critérios de aceite da visão passam a ser os do MVP 2.

## Consequências

- O roteiro passa a ter o fim do MVP 1 como próximo passo e o MVP 2 em seguida.
- As decisões pendentes sobre o acesso do responsável, os perfis e a correção de registros só são necessárias para o MVP 2.
- O que estranhar no passo a passo do MVP 1 vira correção antes do aceite, e não entrega nova.
