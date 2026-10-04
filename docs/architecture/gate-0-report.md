# Auditoria da Fase 0 — Alfa Gestão Escolar

**Registro histórico da conclusão inicial com migrations 001/002 e 30 testes.**
A arquitetura de alfa_auth foi posteriormente reforçada pela migration 003.
O estado atual, autorização do SECURITY DEFINER e suíte de 40 testes estão no
[relatório de restrição de alfa_auth](auth-hardening-report.md).
As descrições de leitura global por alfa_auth abaixo correspondem ao estado
anterior à migration 003, não à configuração vigente.

Veredito: **GATE 0 PASS**, limitado à fundação e aos critérios desta missão.
Ambiente: `/home/sea/alfa-gestao-escolar`, Node v22.22.3, PostgreSQL 15 Docker.
Nenhum módulo pedagógico, financeiro ou de matrícula foi implementado.

## Evidências executáveis

| Execução | Resultado | Evidência completa |
| --- | --- | --- |
| `npm test` / Docker oficial + API 4000 | 30 testes; 30 PASS; 0 FAIL; 0 skipped; 0 cancelled; 0 todo | [TAP oficial](evidence/gate-0-official.txt) |
| `npm run test:gate` / PostgreSQL Docker limpo | 30 testes; 30 PASS; 0 FAIL; 0 skipped; 0 cancelled; 0 todo | [Reconstrução e TAP](evidence/gate-0-clean-rebuild.txt) |
| `npm run db:audit` | PASS, incluindo conexões reais após chamadas HTTP | [Banco, roles e policies](evidence/gate-0-database.txt) |
| `npm run lint` | exit 0; sintaxe de todos os JS em src/scripts/tests/migrations | comando reproduzível no backend |

Além dos 30 testes, a reconstrução comprova separadamente a falha explícita da
migration diante de emails duplicados, sem mudar as duas linhas existentes,
e a idempotência de ambos os seeds, comparando UUIDs, hashes e timestamps.
O comando oficial também compara todos os registros de schools/users antes e
depois da suíte para confirmar a remoção das fixtures e a preservação dos dados.

O TAP contém `# suites 0` porque são testes planos do node:test, não grupos
describe. Não significa ausência de testes. Os cinco testes preexistentes
continuam presentes e passam. A adulteração de assinatura passou a trocar o
primeiro caractere Base64URL, evitando alteração de bits de padding sem efeito.

## Critérios do gate

| Critério | Prova |
| --- | --- |
| API sem superuser | pg_stat_activity: alfa-runtime = alfa_app; alfa-authentication = alfa_auth; rolsuper=false em ambos |
| API sem BYPASSRLS | rolbypassrls=false nas duas conexões; inicialização verifica atributos/memberships/ownership |
| Tenant da identidade autenticada | login rejeita school_id; JWT verificado; vínculo e role atuais reconstruídos no banco; contexto não usa dados livres do request |
| RLS efetivo | ENABLE/FORCE nas três tabelas; leitura sem WHERE, UUID alheio e contexto ausente bloqueados; WITH CHECK rejeita INSERT/UPDATE cross-tenant |
| A e B isolados | testes bilaterais em users/schools/me e SQL direto em users/audit_logs/schools |
| 401/403 | ausência/adulteração/expiração/algoritmo errado/vínculo falso e role atual sem permissão |
| Usuário/escola bloqueados | usuário inativo/deletado; escola trial/active permitida, inactive/suspended/unknown/deletada bloqueada |
| Seeds idempotentes | duas execuções de cada seed; snapshot integral invariável |
| Reconstrução | Docker limpo, migration 001+002, provisionamento, seeds, API e suíte completa |
| Toda a suíte | descoberta automática por node --test; 30 PASS nos dois ambientes, zero skips |

Os testes também negam efetivamente CREATE DATABASE, CREATE ROLE, criação de
tabela permanente/temporária, alteração de policy, DISABLE/NO FORCE RLS,
SET ROLE administrativo/cruzado e leitura de pgmigrations. alfa_auth não lê
audit_logs; alfa_app não lê hashes. DML permanece negado às duas roles.

Acesso por UUID alheio é provado no banco com SELECT parametrizado por UUID
sob o TenantContext oposto. A API não tinha endpoint `/api/users/:id`; ele
continua inexistente (404), sem criar funcionalidade somente para o teste.

## Decisões arquiteturais

- Escola autorizada somente se não deletada e status trial/active; regra SQL
  única compartilhada por autenticação, transação e policies.
- Email global único case-insensitive entre não deletados, incluindo inativos.
  Duplicatas abortam migration. Futuro multi-vínculo exige identidade global
  + memberships, com decisão explícita.
- Sem SECURITY DEFINER. alfa_auth tem SELECT global em colunas mínimas para
  autenticação; alfa_app executa operações tenant-scoped sob RLS.
- JWT identifica uma candidatura de acesso; estado e role são atuais no banco.
- Contexto local à transação, mesmo cliente do pool, revalidação, COMMIT/ROLLBACK,
  RESET defensivo e descarte quando a limpeza falha.
- FORCE RLS nas três tabelas; owner administrativo. Runtime somente leitura,
  compatível com os endpoints existentes. Grants temporários de escrita nos
  testes são revertidos por ROLLBACK, sem persistir permissões extras.

Detalhes: [TenantContext](tenant-context.md) e
[ADR-001](../decisoes/ADR-001-isolamento-multi-escola.md).

## Arquivos criados nesta missão

- `backend/migrations/002_tenant_foundation.js`
- `backend/src/config/admin-db.js`
- `backend/src/security/identity.js`
- `backend/src/security/tenant-context.js`
- `backend/src/security/token.js`
- `backend/scripts/migrate.js`
- `backend/scripts/provision-passwords.js`
- `backend/scripts/gate.js`
- `backend/scripts/verify-local.js`
- `backend/scripts/audit-db.js`
- `backend/scripts/check-syntax.js`
- `backend/tests/security/foundation.test.js`
- `docs/architecture/tenant-context.md`
- `docs/architecture/gate-0-report.md`
- `docs/decisoes/ADR-001-isolamento-multi-escola.md`
- `docs/architecture/evidence/gate-0-official.txt`
- `docs/architecture/evidence/gate-0-clean-rebuild.txt`
- `docs/architecture/evidence/gate-0-database.txt`

## Arquivos existentes alterados

- `.env.example`, `docker-compose.yml`
- `backend/.env.example`, `backend/database.json`, `backend/package.json`
- `backend/docs/fase-0-arquitetura.md`
- `backend/src/app.js`, `backend/src/server.js`, `backend/src/config/db.js`
- `backend/src/database/seed-admin.js`, `backend/src/database/seed-tenant-b.js`
- `backend/src/middlewares/auth.js`, `backend/src/middlewares/errorHandler.js`
- `backend/src/modules/auth/auth.controller.js`
- `backend/src/modules/users/users.routes.js`
- `backend/src/modules/schools/schools.routes.js`
- `backend/tests/security/multitenant-isolation.test.js`

Configuração local: `backend/.env` atualizado com URLs distintas e credenciais
aleatórias de runtime; `.env` da raiz criado para o Compose, ambos ignorados
pelo Git e com modo 0600. Os valores não aparecem neste relatório.

A migration **001 não foi editada**. SHA256 verificado:
`869503abe28643d4ecd8876c1e4bf70df921b462dd64d14518cc7294187def63`.

O checkout já estava inteiramente sem commits e com arquivos untracked no
início. Não foi feito commit, staging ou push; o inventário acima distingue
criação/alteração pela inspeção inicial, não por diff de um commit inexistente.
Os artefatos estão no workspace, prontos para revisão e versionamento.

## Comandos executados e reprodução

Inspeção: `pwd`, `git status --short`, `rg`, leitura de arquivos, `sha256sum`,
`git check-ignore .env backend/.env`. Consultas somente leitura também usaram
`docker exec alfa-postgres psql -U postgres -d alfa_gestao -X -c ...` para
estados das escolas, atributos das roles e RLS/ownership.

No terminal do backend (`cd ~/alfa-gestao-escolar/backend`):

```bash
npm run lint
npm run db:migrate
npm run db:provision
npm start
```

Com a API rodando, em outro terminal do backend:

```bash
npm test
npm run test:gate
npm run db:audit
```

`npm run test:local` é equivalente a `npm test`. Os verificadores executam os
dois scripts de seed duas vezes e toda a suíte automaticamente. Comandos
individuais dos seeds também estão disponíveis:

```bash
npm run db:seed:admin
npm run db:seed:tenant-b
```

Para reconstrução independente, `npm run test:gate` só precisa de Node,
dependências do lockfile instaladas e Docker com imagem postgres:15 disponível.
Ele gera credenciais efêmeras em memória, usa porta aleatória diferente de
5432/5433 no host e descarta somente seu container com armazenamento tmpfs.
Não depende de UUID de seed, banco oficial, `.env` funcional ou API já iniciada.
O arquivo local pode existir; as variáveis explícitas do gate prevalecem.

Para instalação manual limpa, copiar os `.env.example`, preencher localmente
os segredos (URLs das duas roles com senhas aleatórias de pelo menos 24
caracteres; JWT_SECRET de pelo menos 32 bytes; ADMIN_PASSWORD fictício de pelo
menos 12 caracteres), subir o Compose e executar migrations → provisionamento
→ seeds → API → testes. Não usar os placeholders como senha. Em produção,
separar a entrega de secrets administrativos dos secrets da API.

Na raiz foi executado:

```bash
docker compose up -d --no-deps postgres
docker port alfa-postgres 5432/tcp
```

A recriação aplicou bind `127.0.0.1:5433`, preservando o volume confirmado
`alfa-gestao-escolar_pgdata:/var/lib/postgresql/data`. A API reconectou e a
suíte/auditoria foram repetidas. Nenhum `down`, `down -v` ou comando de remoção
de volume foi executado. A porta 5432 do host não foi acessada nem alterada;
5432 nos argumentos Docker é somente a porta interna do container.

A instância antiga da API foi encerrada com SIGTERM após verificar PID,
comando `src/server.js` e cwd deste backend, para iniciar a nova configuração
na porta 4000. Não foram encerrados processos de outros projetos.

## Blockers encontrados e resolvidos

- Decisões arquiteturais inicialmente pendentes: resolvidas pelo usuário e ADR.
- Docker/sockets/subprocesso git bloqueados pelo sandbox: comandos necessários
  repetidos com a autorização do ambiente; nenhum controle da aplicação foi
  enfraquecido.
- Porta 4000 ocupada pela API antiga: processo identificado e reiniciado.
- Publicação antiga de 5433 em todas as interfaces: Compose aplicado com
  loopback e volume preservado; suíte repetida depois da mudança.

**Blockers restantes: nenhum para os dez critérios do Gate 0.**

## Riscos e limites restantes

- alfa_auth lê hashes globalmente para autenticar sem SECURITY DEFINER.
  Essa credencial e o processo de autenticação são parte sensível da fronteira
  de confiança; não devem ser reutilizados para consultas de negócio.
- RLS depende de o backend estabelecer o tenant autenticado. Uma GUC não
  impede abuso por quem já controla o processo/SQL/credenciais da aplicação.
- `.env` local reúne credenciais de desenvolvimento; produção precisa de
  distribuição separada de secrets. A credencial administrativa já existente
  foi preservada, sem rotação nesta missão.
- Revogação é verificada no próximo acesso/validação, não cancela operações
  já em andamento. Implementações futuras de escrita exigem revisão própria
  de privilégios, vínculos entre entidades e auditoria.
- Não há endpoint de negócio por UUID, módulos novos ou certificação geral
  de produção. Este PASS atesta somente a fundação e as provas descritas.
