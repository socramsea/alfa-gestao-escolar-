# Entrega 10 — renovação de matrícula

Status: **esqueleto**, na branch `feat/mvp2-renovacao`. Já existem as tabelas (migration 014) e as rotas, que ainda respondem 501. A implementação começa e o merge acontece só depois que o PR #11 passar no gate e for mesclado. Decisões em [ADR-009](../decisoes/ADR-009-renovacao-link-pessoal-e-perfis.md).

## Por que esta entrega

É o MVP original da [visão do produto](../visao-negocio-e-arquitetura-do-mvp.md#8-fluxo-funcional-mínimo-do-mvp). A família do aluno atual vê a prévia dos dados e confirma a renovação; a secretaria analisa e aprova ou recusa. O sistema registra status, data, usuário e histórico.

## Fluxo previsto

1. **A secretaria abre a campanha:** do período letivo atual para o seguinte, com data de abertura e de fechamento.
2. **Inclui os alunos:** os matriculados no período atual, por turma ou todos.
3. **Gera o link pessoal de cada aluno** e envia como na matrícula online: copia a mensagem, abre o WhatsApp no computador ou manda por e-mail. No MVP 3, o envio fica automático ([ADR-008](../decisoes/ADR-008-frequencia-mensagens-documentos-comunicacoes.md)).
4. **Pede documentos, se precisar:** só uma lista. O envio de arquivos fica para o MVP 3.
5. **A família abre o link com a data de nascimento da criança**, sem conta.
   - Vê a prévia: aluno, turma atual, responsáveis, contatos, endereço e documentos pedidos.
   - Propõe atualizações e confirma.
6. **A secretaria analisa.** Pode pedir correção com uma mensagem, recusar com motivo ou aprovar. Para aprovar, escolhe a turma e a série do novo período, e o sistema cria a matrícula.
7. **Histórico:** cada passo fica registrado com data e usuário, e nada é sobrescrito.

## Tabelas (migration 014)

Todas têm `school_id`, RLS `ENABLE` e `FORCE` e só `SELECT` e `INSERT` para `alfa_app`. A API confere o RLS delas ao subir.

| Tabela | Conteúdo |
|---|---|
| `reenrollment_campaigns` | Campanha: período de origem e de destino, abertura e fechamento. Uma por par de períodos |
| `reenrollments` | Renovação de um aluno numa campanha, a partir da matrícula atual. Uma por aluno e campanha |
| `reenrollment_links` | Link pessoal: só o hash do token e a validade |
| `reenrollment_link_revocations` | Link revogado quando outro é gerado |
| `reenrollment_access_attempts` | Tentativas de acesso, para bloquear o link após 5 datas erradas |
| `reenrollment_document_requests` | Documentos pedidos pela escola, só os nomes |
| `reenrollment_submissions` | Confirmação da família com as atualizações propostas |
| `reenrollment_reviews` | Decisão da secretaria. A aprovação aponta para a matrícula criada no novo período |
| `reenrollment_events` | Idempotência e auditoria das ações da secretaria |

## Rotas (hoje respondem 501)

| Rota | Quem | O que vai fazer |
|---|---|---|
| `GET` e `POST /api/reenrollments/campaigns` | Secretaria | Listar e abrir campanhas |
| `GET` e `POST /api/reenrollments` | Secretaria | Listar as renovações da campanha e incluir alunos |
| `GET /api/reenrollments/:id` | Secretaria | Detalhe com prévia, confirmação, documentos e histórico |
| `POST /api/reenrollments/links` | Secretaria | Gerar o link pessoal; o anterior é revogado |
| `POST /api/reenrollments/document-requests` | Secretaria | Pedir um documento |
| `POST /api/reenrollments/reviews` | Secretaria | Pedir correção, recusar ou aprovar com turma e série |
| `POST /api/family/reenrollments/access` | Família | Abrir a prévia com a data de nascimento |
| `POST /api/family/reenrollments/submissions` | Família | Confirmar, com as atualizações propostas |

## Regras previstas

- **Acesso da família:** é o mesmo da matrícula online.
  - Só o hash do token fica no banco.
  - O link é bloqueado após 5 datas erradas.
  - Um link novo revoga o anterior.
  - A família só alcança o banco por funções de `family_public`.
- **Prazo:** a família só confirma entre a abertura e o fechamento da campanha.
- **Quem entra na campanha:** só alunos com matrícula no período de origem.
- **Matrícula nova:** a aprovação falha se o aluno já tiver matrícula no período de destino. Isso já é garantido pela matrícula única por aluno e período.
- **Idempotência e auditoria:** toda escrita da secretaria exige `Idempotency-Key`. O sistema só insere.
- **Erros:** em português, no padrão da entrega 9.

## O que resolver na implementação

1. **Atualizações aprovadas no cadastro, sem `UPDATE`.**
   - O problema: contato, endereço e responsáveis precisam passar a valer, mas o sistema só insere.
   - A proposta: uma tabela de atualizações de cadastro, só de inserção, lida como valor vigente.
   - Esse desenho tem interseção com a entrega 13 (correção de registros) e precisa ser fechado antes.
2. **Data de nascimento errada no cadastro do aluno bloqueia o link.**
   - Reaproveitar a correção de data da matrícula online, ou depender da entrega 13.
3. **Irmãos:** um link por aluno, que é o mais simples, ou um link por família.
4. **Limite no nginx:** incluir `/api/family/reenrollments` no limite por visitante da família.
5. **Funções novas de `family_public`:** acrescentar as assinaturas na checagem de partida (`site-boundary.js`).
6. **Evento no canal interno:** avaliar um `renovacao_confirmada` em `outbox_events`, para o MVP 3 avisar a família.

## Fora deste recorte

- Envio de arquivos: módulo de Documentos, no MVP 3.
- Conta própria do responsável: ADR-009.
- Perfis de professor e coordenação: entrega 11.
- Contrato, assinatura e financeiro da matrícula: MVP 3 e depois.
