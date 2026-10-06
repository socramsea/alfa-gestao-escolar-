# ADR-009 — Renovação: acesso pelo link pessoal e perfis da entrega 10

Status: **ACEITO** pelo responsável pelo projeto em 2026-10-06. Fecha a decisão pendente 1 do [roteiro](../ROTEIRO.md) e a parte da decisão 2 que a renovação precisa.

## Contexto

A entrega 10, a renovação de matrícula, dependia de duas decisões pendentes do roteiro:
- **Decisão 1:** como o responsável acessa a renovação, pelo link pessoal ou por conta própria.
- **Decisão 2:** quais perfis existem além do administrador.

A matrícula online (entrega 6) já tem um acesso da família pelo link pessoal, aberto com a data de nascimento da criança.

## Decisão

### 1. Acesso do responsável: link pessoal com data de nascimento, sem conta própria

A família entra na renovação como entra na matrícula online. Ela recebe um link pessoal e o abre com a data de nascimento da criança. Não há conta, nem senha.

**Por quê:**
- **As famílias já conhecem esse fluxo** da matrícula online (entrega 6).
- **Criar conta com senha para renovar é atrito** para um evento anual de cerca de 5 minutos, que não é usado no dia a dia.
- **O mecanismo já existe e foi testado**: token só na primeira resposta, bloqueio após 5 datas erradas, link novo que revoga o anterior e correção da data pela secretaria.

**Envio do link:**
- **No MVP 2:** como na matrícula online, a secretaria copia a mensagem ou abre o WhatsApp pelo computador. Também pode mandar por e-mail.
- **No MVP 3:** o envio passa a ser automático pelo módulo de Mensagens ([ADR-008](ADR-008-frequencia-mensagens-documentos-comunicacoes.md)).

### 2. Perfis na entrega 10: administrador e responsável

| Perfil | Como entra | O que faz na renovação |
|---|---|---|
| Administrador (secretaria ou direção) | Login, com o perfil `school_admin` que já existe | Vê tudo, abre a renovação, analisa e aprova ou recusa, e gerencia as turmas |
| Responsável (família) | Link pessoal, sem conta | Vê a prévia dos dados, propõe atualizações (contatos, endereço e responsáveis), confirma a renovação e vê os documentos que a escola pedir |

- **Professor e coordenação** ficam para a entrega 11 (perfis). A renovação funciona só com administrador e responsável, então não é preciso construir perfis antes.
- **Documentos na entrega 10:** a família vê quais documentos a escola pediu. O envio de arquivos fica para o módulo de Documentos, no MVP 3. Pela visão do produto, upload real só existe depois do armazenamento privado, e o ADR-008 exige o volume `/data/uploads/` com backup antes disso.
- **Atualização de dados:** o que a família muda vira uma proposta, conferida pela secretaria na aprovação, como na matrícula online. O sistema continua só inserindo; nada é sobrescrito.

## Consequências

- **A entrega 10 deixa de depender de decisões pendentes.** Ela começa depois que o PR #11 passar no gate e for mesclado, pela regra de uma entrega por vez.
- **A decisão pendente 1 está fechada.** A decisão 2 fica aberta só para a entrega 11: professor, coordenação e o que cada um faz.
- **O critério "responsável acessa somente seus próprios alunos" do MVP 2 é atendido pelo link**, que dá acesso só ao aluno daquela renovação, como no MVP 1.
- **O próximo ADR livre é o 010.**
