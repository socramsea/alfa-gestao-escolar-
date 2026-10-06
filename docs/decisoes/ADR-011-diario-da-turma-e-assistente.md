# ADR-011 — Diário da turma, agenda do professor e assistente de busca com IA

Status: **PROPOSTA**, a partir do pedido do responsável pelo projeto em 2026-10-06. A parte 3, página e agenda do professor, foi decidida por ele no mesmo dia. Faltam as perguntas 1 e 2: a posição do diário no roteiro e o modelo de IA.

## Contexto

Professores e secretaria pediram que o espaço de cada sala ([ADR-010](ADR-010-telas-organizadas-por-tarefa.md)) tenha:
- um **livro de ocorrências da turma**, com tudo o que aconteceu naquele dia;
- **ocorrências por aluno**, que aparecem também na ficha do aluno;
- o **plano de aula** que o professor aplicou, opcional.

No futuro, os professores usariam um tablet para seguir o plano de aula.

O responsável também quer um **assistente de IA num chat**, que encontre os dados para quem pergunta. Ele considerou um modelo Llama rodando num computador da empresa, ou um agente próprio.

Depois, ainda em 2026-10-06, ele pediu que **cada professora tenha o próprio acesso**, com uma página para cada sala e uma agenda para organizar as coisas dela dentro do sistema da escola.

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

### 3. Página e agenda do professor

**Cada professor entra com o próprio acesso** e vê só as salas em que dá aula. O acesso vem com os perfis (entrega 12). A primeira tela é a página dele: as suas salas, o que tem hoje e as suas tarefas.

**Uma página para cada sala.** A página da sala é a ficha da turma do [ADR-010](ADR-010-telas-organizadas-por-tarefa.md), com o diário e a agenda da sala. Quem dá aula em mais de uma sala, como os professores de Educação Física ou de Inglês, tem uma página para cada sala e uma agenda só.

**A agenda reúne, numa tela:**

| O quê | Quem marca | Quem vê |
|---|---|---|
| Horário da semana: as aulas de cada sala | A secretaria, em Configurações, ou por planilha | O próprio professor |
| Compromissos da escola: reuniões, conselho de classe | A coordenação ou a secretaria | Todos os professores |
| Agenda da sala: provas, passeios, trabalhos | Os professores da sala e a secretaria | Os professores da sala e a secretaria |
| Tarefas e lembretes pessoais, com caixa de marcar quando feitos | O próprio professor | O próprio professor e a direção |

**Regras:**
- O que é sobre um aluno vai para o diário, como ocorrência, e não para a anotação pessoal. Assim a coordenação vê o que precisa ver.
- A agenda segue a regra de só inserção: cancelar um compromisso ou marcar uma tarefa como feita grava um registro novo.
- O horário da semana é um cadastro novo. Ele não existe hoje no banco.

**Decidido pelo responsável em 2026-10-06:**
- A página e a agenda entram junto com o Diário da turma (entrega 13), porque usam as mesmas salas e o mesmo acesso de professor.
- As anotações pessoais são do próprio professor: só ele anota e marca. A secretaria não as vê.
- **A direção vê tudo** o que acontece na escola e no sistema: todas as salas, todos os alunos, as agendas e o histórico de quem fez o quê, com nome, dia e hora. Isso inclui as anotações pessoais.
- Cada professor tem login e senha próprios. Ele vê e registra só nas turmas em que dá aula e no que é responsabilidade dele, e tudo o que registra leva o nome dele.

**Como isso fica no banco:**
- Os dados continuam num banco só da escola, com a regra por escola que já existe ([ADR-001](ADR-001-isolamento-multi-escola.md)). Por cima dela entra uma regra por professor.
- A conta de usuário do professor passa a ser ligada ao cadastro dele em Professores e equipe.
- Ele só lê e grava nas turmas em que tem atribuição vigente, que já existe hoje como "professores da turma", com data de início e de fim.
- Quando a atribuição termina, o acesso àquela turma termina junto. O que ele registrou continua no histórico, com o nome dele.
- A secretaria cria o acesso. A senha é pessoal: só o professor a conhece, e ela nunca é compartilhada.

O protótipo clicável já mostra a página e a agenda nas visões "Profª Regina", com uma sala, e "Prof. Paulo", com duas salas.

## O que o responsável decide

1. O diário da turma substitui a entrega 13 (frequência), como "chamada, ocorrências e plano de aula", ou vira entregas separadas?
2. O assistente de IA fica depois do MVP 2, como módulo próprio, depois do teste comparando modelo local e hospedado?
3. **Página e agenda do professor: decidida em 06/10.** Entram junto com o diário. Só o professor anota e marca as anotações pessoais, e cada professor tem acesso próprio, limitado às turmas dele. A direção vê tudo.

## Consequências, se aceito

- **Roteiro:** a entrega 13 passa a se chamar "Diário da turma". O assistente entra como módulo depois do MVP 2, com o resultado do teste registrado num ADR próprio.
- **Escopo:** frequência, ocorrências e plano de aula nascem como parte da ficha da turma da entrega 10, e não como telas soltas.
- **Perfis (entrega 12):** o professor tem login e senha próprios, e o acesso fica limitado às turmas em que ele tem atribuição vigente. A conta de usuário passa a ser ligada ao cadastro do professor.
- **Banco:** a agenda pede tabelas novas, para o horário da semana, os compromissos e as anotações pessoais, com RLS e só inserção como as demais. O acesso por professor entra como uma regra a mais, por cima da regra por escola.
