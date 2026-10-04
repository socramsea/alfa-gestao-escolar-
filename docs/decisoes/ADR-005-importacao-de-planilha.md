# ADR-005 — Importação de planilha no MVP 1

Status: **ACEITO**, por pedido do responsável pelo projeto em 2026-10-04, para a reunião de 2026-10-06.

## Contexto

Escolas já têm a lista de alunos e responsáveis numa planilha. Para adotar o sistema, a escola não pode redigitar tudo. O responsável pediu que, na reunião de 06/10, a escola possa arrastar ou subir a planilha dela e ver o sistema organizar tudo.

O MVP 1 ([ADR-004](ADR-004-mvp-em-duas-etapas.md)) não previa essa importação, e o cadastro de pessoas só aceitava um registro por vez.

## Decisão

1. **A importação de planilha entra no MVP 1** como entrega 7 do [roteiro](../ROTEIRO.md).
2. **Formatos:** Excel (.xlsx), CSV ou linhas coladas do Excel e do Google Planilhas. A leitura é feita no navegador; o arquivo não é enviado nem guardado. Só as linhas, já organizadas, chegam à API.
3. **Qualquer formato de planilha:** a secretaria escolhe que coluna é o quê, e o sistema sugere pelos títulos.
4. **Nada é gravado sem prévia.** A prévia mostra, linha a linha, o que vai acontecer ou o que está errado. A importação grava tudo ou nada; linhas com erro podem ficar de fora por escolha da secretaria.
5. **O que a importação faz:**
   - cria o aluno;
   - cria ou reaproveita o responsável, pela mesma regra da matrícula online;
   - cria o vínculo entre os dois;
   - se a planilha disser a turma, matricula o aluno no período escolhido.
6. **Reimportar não duplica.** O aluno é reconhecido pelo CPF ou por nome e nascimento; o vínculo e a matrícula, se já existem, ficam como estão.
7. **Até 500 linhas por importação.** Cada importação fica registrada com autor e resultado, por referência, sem dados pessoais.
8. **Dados fictícios na demonstração.** A planilha de exemplo está em [`docs/exemplos/planilha-alunos-ficticia.xlsx`](../exemplos/planilha-alunos-ficticia.xlsx). A planilha real de uma escola só entra depois dos critérios de produção da [visão do produto](../visao-negocio-e-arquitetura-do-mvp.md#11-critérios-de-segurança-antes-da-produção) e da autorização formal da escola.

## Consequências

- O roteiro ganha a entrega 7, e o aceite do MVP 1 passa a ser a entrega 8, com o sistema no ar.
- As entregas do MVP 2 passam a ser de 9 a 12.
- O cadastro reaproveitado não é alterado, porque o runtime não faz UPDATE. Telefone, e-mail ou CPF novos de um responsável já cadastrado não são gravados.
