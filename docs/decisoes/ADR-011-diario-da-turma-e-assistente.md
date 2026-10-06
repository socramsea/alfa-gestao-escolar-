# ADR-011 — Diário da turma e assistente de busca com IA

Status: **PROPOSTA**, a partir do pedido do responsável pelo projeto em 2026-10-06. Depende da decisão dele sobre a posição no roteiro e sobre o modelo de IA.

## Contexto

Professores e secretaria pediram que o espaço de cada sala ([ADR-010](ADR-010-telas-organizadas-por-tarefa.md)) tenha:
- um **livro de ocorrências da turma**, com tudo o que aconteceu naquele dia;
- **ocorrências por aluno**, que aparecem também na ficha do aluno;
- o **plano de aula** que o professor aplicou, opcional.

No futuro, os professores usariam um tablet para seguir o plano de aula.

O responsável também quer um **assistente de IA num chat**, que encontre os dados para quem pergunta. Ele considerou um modelo Llama rodando num computador da empresa, ou um agente próprio.

## Proposta

### 1. Diário da turma

**Uma entrega só: "Diário da turma: chamada, ocorrências e plano de aula".** Ela substitui a entrega de frequência (13) e fica depois dos perfis (12), porque quem registra é o professor, com o próprio login.

**Ocorrências:**
- Ficam no dia, com autor e horário, e são ligadas à turma e, quando for o caso, a um ou mais alunos.
- O sistema só insere. A correção é uma ocorrência nova que aponta para a anterior, como nas notas.
- Ocorrências podem falar de comportamento ou saúde de crianças. Por isso, cada perfil vê só o que precisa: o professor vê as da sua turma, a coordenação e a secretaria veem todas, e a família não vê nesta entrega.

**Plano de aula:**
- O professor registra por dia o que aplicou: texto livre, opcional.
- Anexos de arquivo ficam para o módulo de Documentos, no MVP 3 ([ADR-008](ADR-008-frequencia-mensagens-documentos-comunicacoes.md)).

**Tablet:** as telas do diário são feitas para funcionar bem no tablet desde já. Um aplicativo próprio fica para depois.

**Alternativa:** se a entrega ficar grande demais, divide-se em duas: chamada primeiro, ocorrências e plano de aula em seguida.

### 2. Assistente de busca com IA

**Primeiro, busca e fichas bem feitas.** A entrega 10 traz busca no topo, ficha do aluno e ficha da turma, e isso resolve a maior parte do "achar os dados". O assistente vem depois, como módulo próprio, depois do MVP 2.

**O assistente nunca acessa o banco direto.** Ele usa ferramentas de consulta da própria API, como "buscar aluno", "ocorrências da turma" e "notas do aluno".
- Cada consulta roda com o login e as permissões de quem perguntou, e o RLS isola as escolas.
- Toda pergunta e toda consulta ficam registradas.
- O assistente só lê: nunca grava, altera ou envia nada.
- Assim, uma escola não vê dados de outra, e um texto mal-intencionado dentro de uma ocorrência não dá ao assistente acesso a mais nada.

**O modelo é trocável.** A escolha do modelo não muda a arquitetura acima.

| Opção | A favor | Contra |
|---|---|---|
| Modelo local (Llama via Ollama), num computador da empresa | O dado não sai da empresa e não há custo por pergunta | Precisa de máquina com memória e, de preferência, placa de vídeo. Modelos pequenos erram mais em português e no uso das ferramentas. Manutenção é nossa |
| Modelo hospedado, por API de um fornecedor | Melhor qualidade em português e no uso de ferramentas, sem máquina para manter | Custo por uso. O dado passa por um fornecedor, o que exige contrato de tratamento de dados (DPA) e, se for no exterior, regras de transferência internacional |

**Teste antes de decidir.** Com dados fictícios, montar as ferramentas de consulta e comparar as duas opções com as mesmas 20 perguntas reais da secretaria e dos professores. Os critérios são:
- acerto;
- tempo de resposta;
- custo;
- máquina necessária.

O computador do responsável já tem o Ollama instalado, o que facilita o teste local.

**LGPD:** são dados de crianças e adolescentes (LGPD, art. 14). O assistente mostra só o que o perfil de quem pergunta já pode ver. Com modelo hospedado, o fornecedor entra no checklist de DPA do ADR-008.

## O que o responsável decide

1. O diário da turma substitui a entrega 13 (frequência), como "chamada, ocorrências e plano de aula", ou vira entregas separadas?
2. O assistente de IA fica depois do MVP 2, como módulo próprio, depois do teste comparando modelo local e hospedado?

## Consequências, se aceito

- **Roteiro:** a entrega 13 passa a se chamar "Diário da turma". O assistente entra como módulo depois do MVP 2, com o resultado do teste registrado num ADR próprio.
- **Escopo:** frequência, ocorrências e plano de aula nascem como parte da ficha da turma da entrega 10, e não como telas soltas.
