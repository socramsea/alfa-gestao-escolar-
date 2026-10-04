# Restrição de alfa_auth — resultado executável

Data: 2026-09-24. **GATE 0 PASS após o reforço de autenticação.**
A revisão de SECURITY DEFINER foi autorizada explicitamente pelo responsável.
Nenhum módulo de negócio foi implementado.

## Resultado

alfa_auth não tem SELECT de tabela ou coluna em users, schools ou audit_logs.
Autentica e reconstrói identidade somente por duas funções restritas, cujos
resultados nunca incluem password_hash. O owner alfa_auth_owner não faz login,
não é superuser, não ignora RLS, não possui tabelas/schema e não pode ser
assumido pelas roles da API. alfa_app e seu TenantContext permanecem intactos.

A API oficial foi reiniciada e respondeu em 127.0.0.1:4000. O PostgreSQL
oficial continua em 127.0.0.1:5433. Não houve conexão ao PostgreSQL antigo
5432 do host, alteração de volumes, rotação de senhas ou reescrita de hashes.

## Evidências

| Prova | Resultado | Artefato completo |
| --- | --- | --- |
| Reconstrução Docker isolada | 40 testes, 40 PASS, 0 FAIL, 0 skipped, 0 cancelled, 0 todo | [TAP e reconstrução](evidence/auth-hardening-clean-rebuild.txt) |
| Suíte contra Docker oficial/API 4000 | 40 testes, 40 PASS, 0 FAIL, 0 skipped, 0 cancelled, 0 todo | [TAP oficial](evidence/auth-hardening-official.txt) |
| Aplicação da 003 com comparação de dados | usuários, escolas, audit_logs e hashes preservados integralmente | [Migration e snapshot](evidence/auth-hardening-migration.txt) |
| Auditoria de conexões, owner, policies, ACLs e grants | PASS; SELECT de tabela e coluna de alfa_auth = false nas três tabelas | [Auditoria PostgreSQL](evidence/auth-hardening-database.txt) |
| Sintaxe JS | `npm run lint`, exit 0 | reproduzível no backend |

Verificação final dos 61 arquivos candidatos ao Git não encontrou os segredos
locais verificados (JWT, senha fictícia administrativa e senhas das duas roles
LOGIN). `.env` e `backend/.env` continuam ignorados. Essa comparação específica
não é apresentada como varredura universal de todos os tipos de segredo.

Os 30 testes anteriores continuam passando. Os 10 novos cobrem:

- SELECT direto e COPY negados, inclusive grants por coluna.
- Login por função com bcrypt existente e resultados sem hashes.
- Senha incorreta, identidade ausente, NULL, entrada inválida e tentativa de SQL injection.
- Limite de 72 bytes ASCII sem aceitar truncamento.
- Limite de 72 bytes Unicode sem aceitar truncamento.
- Hash inválido rejeitado sem exposição por HTTP.
- Owner NOLOGIN restrito e impossibilidade de assumir owner/alterar funções.
- EXECUTE negado a PUBLIC/alfa_app, mesmo concedendo USAGE temporariamente para testar o ACL da função.
- search_path hostil, funções falsas e tabelas temporárias não substituem os objetos reais.
- Inicialização recusa SELECT devolvido por coluna, EXECUTE público, owner LOGIN/membership e search_path alterado.

As permissões adicionais usadas para testes adversariais existem apenas dentro
de transações administrativas com ROLLBACK. Nenhum grant de teste permanece.
A auditoria posterior valida novamente os controles no banco oficial.

## Upgrade e reconstrução

A reconstrução executa 001, prova recusa de emails duplicados pela 002, aplica
002 e cria os seeds bcrypt. Antes da 003, insere uma fixture de hash
incompatível e comprova que a migration aborta sem apagá-la ou corrigi-la.
Depois remove somente essa fixture, aplica 003 e compara snapshots completos
para demonstrar preservação dos dados/hashes. Repete ambos os seeds para
provar idempotência, inicia API e executa toda a suíte por descoberta automática.
Usa container PostgreSQL 15 novo, porta aleatória no loopback e armazenamento
tmpfs; nenhum volume persistente é montado ou removido.

No ambiente oficial, a 003 também foi aplicada com snapshot de schools, users
e audit_logs antes/depois. Snapshots ficaram somente em memória; seus dados
não foram escritos nos relatórios. Os testes criaram/removeram somente suas
fixtures fictícias e confirmaram preservação dos registros preexistentes.

## Alterações

Criados:

- `backend/migrations/003_restrict_auth_credentials.js`
- `backend/src/config/auth-boundary.js`
- `docs/architecture/auth-hardening-report.md`
- Os quatro artefatos `docs/architecture/evidence/auth-hardening-*.txt` acima.

Alterados:

- `backend/src/config/db.js`: valida a fronteira de autenticação no startup.
- `backend/src/security/identity.js`: chamadas parametrizadas às duas funções.
- `backend/src/modules/auth/auth.controller.js`: verificação de senha no banco e rejeição de NUL.
- `backend/src/middlewares/auth.js`: reconstrução por função após validar JWT.
- `backend/tests/security/foundation.test.js`: dez testes adicionais.
- `backend/scripts/gate.js`: prova upgrade com hashes existentes e preflight de formato.
- `backend/scripts/audit-db.js`: inclui owner, funções e grants de coluna.
- `docs/architecture/tenant-context.md`, `docs/decisoes/ADR-001-isolamento-multi-escola.md` e `backend/docs/fase-0-arquitetura.md`: arquitetura atual.
- `docs/architecture/gate-0-report.md`: identificado como relatório histórico, com link para o resultado atual.
- Proposta ADR-002 renomeada para `docs/decisoes/ADR-002-restricao-alfa-auth.md`, aceita e atualizada com a implementação.

Migrations 001/002 não foram editadas. SHA256 antes/depois:

```text
001: 869503abe28643d4ecd8876c1e4bf70df921b462dd64d14518cc7294187def63
002: 666a0c911f40df5744e0a752466be6c3d05053fbabf37b2afe940802cc47758c
```

Não houve mudança em .env, credenciais existentes, frontend, package-lock,
controle de roles funcionais ou endpoints de negócio. Nenhum commit/push foi
feito; o checkout já estava sem commits e com arquivos untracked.

## Comandos executados

No backend, foram executados:

```bash
npm run lint
npm run test:gate
npm start
npm test
npm run db:audit
```

A aplicação oficial usou o mesmo runner administrativo de `npm run db:migrate`
com uma comparação adicional de snapshots em memória antes/depois. Aplicou
somente `003_restrict_auth_credentials`, sem rollback das anteriores. O
comando usual para reproduzir a aplicação em outro ambiente configurado é:

```bash
npm run db:migrate
```

A instância antiga da API (PID 851929) recebeu SIGTERM somente após confirmar
cwd e comando `src/server.js` deste backend. A nova instância validou as roles,
RLS e fronteira de autenticação antes de abrir a porta 4000. Inspeção de
`docker port alfa-postgres 5432/tcp` confirmou `127.0.0.1:5433`; 5432 ali é
apenas a porta interna do container.

O primeiro teste Docker foi bloqueado pelo sandbox e repetido com autorização
do ambiente. Não houve redução dos controles para fazer a suíte passar.

## Decisões e riscos restantes

Ver [ADR-002](../decisoes/ADR-002-restricao-alfa-auth.md) e
[TenantContext](tenant-context.md).

A leitura interna de hashes continua necessária ao owner técnico, mas foi
retirada da credencial LOGIN alfa_auth. Essa credencial ainda permite tentar
senhas e resolver campos públicos de UUIDs conhecidos. Não foi implementado
rate limiting adicional. RLS não protege contra controle total do processo
ou do administrador PostgreSQL.

O verificador aceita o formato bcrypt 2a comprovado dos seeds/identidades
existentes; outro formato exige decisão e migração explícitas. Transporte e
logs de produção precisam proteger as senhas enviadas ao banco; as consultas
da aplicação são parametrizadas e não registram seus parâmetros.

**Blockers restantes: nenhum para esta correção e os critérios originais do
Gate 0.** O resultado não declara prontidão geral de produção.
