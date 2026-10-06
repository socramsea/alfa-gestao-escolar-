# ADR-007 — Notas e avaliações como entrega 9, no MVP 2

Status: **ACEITO**, por pedido do responsável pelo projeto em 2026-10-06.

## Contexto

O roteiro previa a renovação de matrícula como entrega 9 e deixava o pedagógico para depois do MVP 2. O responsável pediu o módulo de notas e avaliações como entrega 9, com:
- lançamento em lote pela turma;
- média ponderada automática;
- correção que não apaga a nota anterior;
- um evento `nota_lancada` para um mecanismo de mensagens futuro.

O pedido citava `docs/produto/mvp2.md` e `docs/produto/aceite-mvp2.md`, que não existem no repositório. O escopo e o aceite desta entrega ficam no [documento da entrega 9](../architecture/entrega-9-notas-avaliacoes.md).

## Decisão

1. **Notas e avaliações entram no MVP 2 como entrega 9.** A renovação passa a ser a entrega 10, os perfis a 11, a correção de registros a 12 e o aceite do MVP 2 a 13.
2. **Escala fixa de 0 a 10, com até duas casas decimais.** O peso vem da avaliação. Se a avaliação não informa peso, vale o peso padrão do tipo de avaliação.
3. **Média do aluno na turma = Σ(nota × peso) / Σ(peso)**, calculada no banco, com duas casas.
   - Entram só as avaliações em que o aluno tem nota. Avaliação sem nota não conta como zero.
   - Nota zero é nota e entra na média.
4. **Correção = nova linha com `corrects_id` e motivo obrigatório.** O banco garante três coisas:
   - a correção é do mesmo aluno na mesma avaliação;
   - cada nota é corrigida no máximo uma vez;
   - existe uma única nota original por aluno e avaliação.
   
   Para corrigir, a tela informa qual nota está substituindo. Se outra pessoa mudou a nota antes, o lançamento é recusado.
5. **Lançamento em lote, tudo ou nada.** Qualquer item com problema recusa o lote inteiro, e a resposta lista o erro de cada item.
6. **`nota_lancada` vai para uma tabela de saída (`outbox_events`), na mesma transação das notas.**
   - O registro guarda só identificadores, sem nota nem nome.
   - Ao confirmar o lote, o banco avisa no canal `alfa_eventos` com `pg_notify`, levando só o tópico.
   - Quem consumir lê a tabela com as próprias permissões. Hoje nenhum módulo consome esses eventos.
7. **Sem perfil de professor nesta entrega.** A tela é usada com o acesso de administrador, como no MVP 1. A conta do professor depende da entrega 11 (perfis).

## Consequências

- O roteiro é renumerado a partir da entrega 9, e o próximo ADR livre passa a ser o 008.
- Ainda não há bimestre ou etapa do ano: a média é do ano letivo da turma. Bimestres, recuperação, frequência e boletim ficam para depois e entram no roteiro antes de começar.
- O pedido citava a entrega 11 como consumidora de `nota_lancada`, mas o roteiro não tem um mecanismo de mensagens. Quando houver, ele entra no roteiro com o próprio ADR.
- A entrega 9 só pode ser mesclada depois do aceite do MVP 1 e do congelamento da reunião de 06/10 (regra 2 do roteiro).
