# Entrega 6 — matrícula online pela família

Status: implementação do recorte concluída; suíte completa aprovada em PostgreSQL isolado sem Docker em 2026-10-04 (ver "Validação"); gate oficial com Docker, smoke de deploy e atualização do piloto ainda não executados.

## Por que esta entrega

A [Entrega 5](entrega-5-site-e-captacao.md) traz a família até a escola: site, pré-matrícula e visita. Faltava fechar a matrícula sem papel. Nesta entrega a família completa a ficha pelo celular e a secretaria só confere e aprova. A matrícula final usa as tabelas e regras já existentes (Entregas 2 e 3).

## Decisões aprovadas pelo responsável (2026-10-04)

1. **Acesso por link pessoal e data de nascimento.** A secretaria envia o link pelo WhatsApp. A família confirma a data de nascimento da criança para entrar, sem senha nem aplicativo.
2. **A secretaria aprova.** Só depois da aprovação o sistema cria aluno, responsáveis, vínculos e matrícula.
3. **Dados da ficha:** criança, responsáveis, endereço e aceite de termos, **conforme a regra de cada escola**.

## Decisões propostas na implementação (sujeitas a revisão)

1. **Regras por escola, versionadas.** Cada escola escolhe o que exige além do básico: CPF da criança, saúde e alergias, CPF dos responsáveis, e-mail, endereço completo e segundo responsável. Também define o texto do regulamento. Cada ficha registra a versão das regras com que foi enviada.
2. **Sempre exigidos:** nome da criança, um responsável legal, um responsável financeiro e a declaração de veracidade. O CPF, quando informado, precisa ter dígitos verificadores válidos.
3. **A ficha aprovada alimenta o cadastro.** Revisada em 2026-10-04 (ver "Correções após revisão"): a aprovação grava no aluno o CPF, o nome social, a saúde e o endereço; no responsável, o CPF; e no vínculo, quem é o responsável financeiro. A ficha completa continua guardada na matrícula online.
4. **O link vale 15 dias.** Gerar outro revoga o anterior. Cinco datas erradas bloqueiam o link e a escola gera um novo.
5. **Correção pelo mesmo link.** A secretaria pode pedir correção com uma mensagem; a família vê o pedido e reenvia a partir do que já tinha preenchido.
6. **Ligação com a captação.** A ficha pode nascer de um interessado da Entrega 5. Aprovar marca o interessado como matriculado; recusar marca como desistiu, com o motivo.

## Fronteira da família

A família não tem conta. A API só a atende por duas funções do schema `family_public`, executadas por `alfa_app`:

| Função | O que faz |
|---|---|
| `family_public.application(hash do link, nascimento)` | Confere link e data, registra a tentativa e devolve os dados de pré-preenchimento, as regras vigentes, a situação e o pedido de correção. |
| `family_public.submit(hash do link, nascimento, chave, hash, regras, ficha)` | Confere de novo e grava a ficha se a situação permitir e as regras não tiverem mudado. É idempotente pela chave. |

O link nunca é guardado: o banco só tem o hash SHA-256. Link inexistente, expirado, revogado, data errada ou escola suspensa têm a mesma resposta; o bloqueio é informado para orientar a família. As funções seguem o padrão das Entregas 0 e 5: owner `alfa_family_owner` (NOLOGIN), `SECURITY DEFINER`, `search_path` fixo e `row_security=on`. A API recusa iniciar se a fronteira mudar.

## Modelo

Migration aditiva `009_online_enrollment.js`:

- **`enrollment_form_settings`**: regras da escola (campos exigidos e regulamento), versionadas.
- **`online_enrollments`**: a ficha convidada, com o nome da criança, o nascimento usado no acesso e o contato do responsável. Opcionalmente ligada a um interessado.
- **`online_enrollment_links`** e **`online_enrollment_link_revocations`**: links (somente o hash) e revogações.
- **`online_enrollment_access_attempts`**: tentativas de acesso, para o bloqueio.
- **`online_enrollment_submissions`**: fichas enviadas, com a versão das regras e o aceite.
- **`online_enrollment_reviews`**: decisões da secretaria (aprovada, correção, recusada), com aluno e matrícula criados na aprovação.
- **`online_enrollment_events`**: auditoria das escritas da equipe.

API da equipe em `/api/online-enrollments` (`settings`, `applications`, `links`, `reviews`), paginada e com idempotência. API da família em `/api/family/enrollments` (`access` e `submissions`), com link e data no corpo, nunca na URL.

Telas:

- `/matricula/<link>`: a ficha da família, pensada para celular.
- `/secretaria/captacao`, aba **Matrícula online**: lista, ficha, decisão, regras da escola e envio do link pelo WhatsApp. O detalhe do interessado ganhou o botão **Iniciar matrícula online**.

## Fora deste recorte

Envio automático de WhatsApp ou SMS, código de verificação por mensagem, assinatura digital do contrato, upload de documentos, financeiro (taxa e mensalidade), renovação dos alunos atuais (MVP 2, entrega 11 do [roteiro](../ROTEIRO.md)), ficha do aluno com histórico de alterações e edição de cadastro já aprovado.

## Validação executada em 2026-10-04

Mesmo ambiente da Entrega 5: PostgreSQL 16 isolado, sem Docker, banco recriado a cada rodada.

- **Backend:** 128 testes aprovados, 13 em `backend/tests/online-enrollments/`. Cobrem:
  - regras versionadas e estritas;
  - convite a partir da captação ou manual;
  - token só na criação e guardado como hash, com revogação ao gerar outro;
  - data errada, bloqueio após 5 erros, link expirado e escola suspensa;
  - regras por escola, CPF válido e responsáveis legal e financeiro;
  - idempotência e regras alteradas entre a leitura e o envio;
  - correção e reenvio;
  - aprovação criando aluno, responsáveis, vínculos e matrícula, e recusa concluindo a captação;
  - isolamento, perfis, RLS, ausência de UPDATE/DELETE, rollback da aprovação e fronteira verificada na inicialização.
- **Frontend:** 23 testes do cliente HTTP aprovados.
- **Navegador:** 7 specs aprovados. O novo `frontend/e2e/online-enrollment.spec.js` faz o caminho completo: a escola define as regras e cria a ficha; a família erra e acerta a data, completa e envia pelo celular; a secretaria aprova na turma; a matrícula aparece na tela de Matrículas e a família vê "Matrícula confirmada".

`deploy/smoke.py` foi atualizado com as contagens das novas tabelas e dos alunos, responsáveis e matrículas criados pela aprovação. O nginx limita por IP os acessos da família.

## Correções após revisão (2026-10-04)

Uma revisão da lógica encontrou falhas que foram reproduzidas pela API e corrigidas com testes:

1. **A situação do interessado não regride.** Registrar o comparecimento de uma visita pendente gravava "visitou" mesmo depois da matrícula aprovada ou da desistência, e essa passava a ser a situação. Agora, com o atendimento encerrado, o comparecimento só entra no histórico da visita. Reabrir continua possível por uma anotação da equipe.
2. **A secretaria corrige a data de nascimento do convite.** Com a data errada, a família não entrava, e o convite não podia ser refeito para o mesmo interessado. A correção fica em `online_enrollment_birth_date_corrections` (migration `010`), por `POST /api/online-enrollments/birth-date-corrections`, e na tela pelo item **Corrigir data de nascimento** da ficha.
   - A última correção vale para o acesso da família, para o envio e para o aluno criado na aprovação.
   - Corrigir zera as tentativas erradas do link ativo, então a família entra pelo mesmo link.
   - Não há correção depois de aprovada ou recusada, e o histórico é preservado.
3. **Irmãos compartilham o responsável.** Cada aprovação criava um responsável novo, então a mesma mãe com dois filhos virava dois cadastros. Agora a aprovação reaproveita o responsável já cadastrado na escola:
   - mesmo CPF é a mesma pessoa;
   - sem CPF divergente, mesmo nome e mesmo telefone também são, ignorando acentos, maiúsculas, espaços e o código do país;
   - outro nome no mesmo telefone (a avó, por exemplo) e outro CPF continuam sendo outra pessoa;
   - o cadastro reaproveitado não é alterado, pois o runtime não faz UPDATE; os dados novos ficam na ficha.
4. **Os dados da ficha chegam ao cadastro** (migration `011`). Aluno ganhou CPF, nome social, saúde e endereço; responsável, CPF; vínculo, `is_financial`. As colunas são opcionais: nulo quer dizer "não informado", como nos cadastros manuais e nos registros anteriores. O CPF é único por escola, para aluno e para responsável. Por isso, aprovar uma criança cujo CPF já está cadastrado é recusado (409), em vez de criar um aluno duplicado, e a ficha não aceita o mesmo CPF para os dois responsáveis.

Validação das correções, no mesmo ambiente: 132 testes do backend, 23 do frontend e os 7 specs de navegador aprovados. O spec da matrícula online passou a começar com a data de nascimento errada, que a secretaria corrige antes de a família entrar.

## Pendente no ambiente com Docker

1. `GATE_BROWSER=1 npm run test:gate`;
2. `python3 deploy/smoke.py`;
3. atualização do piloto local, com backup antes e conferência visual pelo responsável.
