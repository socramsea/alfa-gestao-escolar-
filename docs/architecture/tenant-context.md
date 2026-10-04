# TenantContext — fundação da Fase 0

## Fronteira de confiança

Body, query, headers e params não definem tenant. O login aceita estritamente
email e senha; `school_id` adicional causa 400. O email é globalmente único
entre registros não deletados, inclusive usuários inativos, sem diferenciar
maiúsculas/minúsculas. A migration 002 detecta duplicatas antes de criar o
índice e aborta sem alterar dados ou escolher uma escola.

A identidade encontrada precisa passar por bcrypt, estar ativa e não deletada,
e pertencer a escola autorizada. A função SQL **SECURITY INVOKER**
`public.school_allows_access(status, deleted_at)` centraliza a regra:
`deleted_at IS NULL AND status IN ('trial', 'active')`. Estados desconhecidos
são bloqueados. Login, reconstrução de identidade, transação e RLS usam essa
mesma regra. A regra de escola permanece SECURITY INVOKER. Após autorização
explícita no ADR-002, a migration 003 encapsula autenticação e reconstrução de
identidade em duas funções SECURITY DEFINER restritas, sem retorno de hashes.

O JWT tem assinatura HS256, issuer, audience e expiração verificados; os UUIDs
são validados. O `school_id` emitido vem do registro autenticado. A cada
requisição, o servidor recupera usuário, vínculo, role e estado atuais; rejeita
vínculo divergente do JWT. O claim de role não autoriza acesso.

## Três conexões com responsabilidades distintas

| Identidade | Uso | Privilégios |
| --- | --- | --- |
| Administrador (`ADMIN_DATABASE_URL`) | migrations, senhas das roles, seeds e auditoria/testes administrativos | Nunca usado pelos módulos da API |
| `alfa_auth` (`AUTH_DATABASE_URL`) | autenticar e reconstruir identidade | EXECUTE nas duas funções de auth_private; nenhum SELECT/DML nas tabelas de aplicação |
| `alfa_app` (`DATABASE_URL`) | operações tenant-scoped | SELECT sob RLS em users (sem password_hash), schools e audit_logs; sem DML |
| `alfa_auth_owner` (NOLOGIN, sem conexão) | owner das duas funções | SELECT interno nas colunas necessárias de users/schools; sem DML, superuser, BYPASSRLS, memberships ou ownership de tabelas |

As duas roles da API têm LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
NOREPLICATION, NOBYPASSRLS e NOINHERIT, sem memberships ou ownership. PUBLIC
não recebe acesso às tabelas; CREATE no schema e permissões públicas do banco
são revogados. A inicialização recusa identidade insegura ou ausência de
ENABLE/FORCE RLS. O runtime não pode assumir alfa_auth ou postgres.

**Fronteira de autenticação restrita:** alfa_auth não possui grants de leitura
de tabela nem de coluna. As policies de leitura global pertencem somente a
alfa_auth_owner, que não faz login e não pode ser assumido pelas roles da API.
Somente o administrador e o código das funções podem usar esse acesso interno.

`auth_private.authenticate(email, password)` compara bcrypt dentro do banco e
retorna id, school_id, name, email, role e active apenas após validar senha,
usuário e escola. Não aceita school_id. Para identidade ausente, também calcula
bcrypt com hash fictício; isso reduz diferenças grosseiras de tempo, sem
prometer tempo constante entre todos os casos/custos.
`auth_private.resolve_identity(uuid)` retorna os mesmos campos públicos, sem
hash, para usuário/escola válidos. O middleware só a chama após verificar JWT;
a função não verifica JWT nem autentica por UUID sozinha.

As funções têm owner técnico restrito, `search_path = pg_catalog, pg_temp`,
`row_security = on`, objetos qualificados por schema e nenhum SQL dinâmico.
EXECUTE é revogado de PUBLIC/alfa_app e concedido a alfa_auth. A inicialização
recusa SELECT devolvido à role, owner com poderes indevidos, EXECUTE público
ou configuração insegura das funções.

A migration 003 exige bcrypt 2a nos registros não deletados e aborta claramente
se encontrar outro formato, sem conversão automática. É o formato dos seeds
e das identidades existentes validadas nesta execução. API e função recusam
senha vazia ou acima de 72 bytes; a API também rejeita NUL. A regra não trunca
senhas silenciosamente. Novos formatos exigem migração de verificador explícita.

Em produção, entregar somente as duas credenciais restritas à API e manter a
credencial administrativa em processo/secret separado. O `.env` local reúne
variáveis para conveniência de desenvolvimento e é ignorado pelo Git; isso
não constitui isolamento de credenciais contra o usuário do host. A credencial
alfa_auth ainda permite tentar senhas e consultar campos públicos por UUID
conhecido. A mudança impede extração direta de hashes por essa credencial;
não é uma proteção contra comprometimento total da aplicação/administrador.

A API não usa superuser porque superusers ignoram RLS, mesmo com FORCE.
`platform_admin` também permanece limitado à própria escola; não há endpoint
ou bypass global de administração de plataforma nesta fase.

## Transação e pool

`authMiddleware` cria `req.user` a partir do banco e fornece `req.withTenant`.
Esse helper reserva um cliente de pg.Pool, abre BEGIN e executa
`set_config('app.current_school_id', schoolId, true)` parametrizado. O terceiro
argumento true limita o contexto à transação. Todas as operações do callback
usam **o mesmo cliente**, nunca `pool.query` paralelo.

Antes do callback, a identidade é revalidada por id, school_id, active,
deleted_at e escola válida, sob RLS. `/api/auth/me` devolve essa identidade.
Listagens verificam novamente a role atual recuperada na transação.

Sucesso termina com COMMIT; qualquer falha tenta ROLLBACK. Antes de devolver
o cliente, RESET remove também eventual contexto de sessão introduzido
acidentalmente pelo callback. Falha no rollback/reset descarta a conexão.
Não há transação aberta durante o envio da resposta HTTP. Uma alteração de
estado já confirmada é observada pela próxima validação; uma operação que já
passou pela validação não é cancelada retroativamente.

## RLS e limites

A migration 002 habilita **ENABLE e FORCE ROW LEVEL SECURITY** nas três tabelas.
O owner permanece administrativo, nunca alfa_app/alfa_auth.

- schools: id igual ao TenantContext e regra central de escola autorizada.
- users e audit_logs: school_id igual ao TenantContext e escola visível por RLS.
- USING controla linhas visíveis; WITH CHECK controla valores novos.
- Contexto ausente/vazio não retorna linhas para alfa_app.
- A API mantém filtros explícitos como defesa adicional.

A configuração customizada não autentica quem executa SQL: alfa_app pode
tecnicamente definir a GUC. O código que a estabelece é parte da fronteira de
confiança. A proteção comprovada é contra filtros ausentes e acessos
cross-tenant no contexto correto, não contra comprometimento total do processo
ou das credenciais. Não há acesso SQL arbitrário exposto por HTTP.

Os endpoints atuais são de leitura; INSERT/UPDATE/DELETE são negados por
privilégio. Para provar WITH CHECK independentemente desse bloqueio, os testes
concedem INSERT/UPDATE temporariamente em transação administrativa, executam
SET LOCAL ROLE alfa_app e sempre fazem ROLLBACK. Controles positivos de escrita
na própria escola passam; escrita cross-tenant gera erro de RLS. Nenhum grant
de escrita permanece. Qualquer futura escrita exigirá revisão de privilégios,
validação de referências tenant-scoped e auditoria; não foi implementada aqui.

## HTTP

Sem X-Powered-By. CORS permite somente origens exatas em CORS_ORIGINS, sem
credenciais de cookies; wildcard é recusado, lista vazia não habilita CORS.
CORS não substitui autenticação. Zod valida login e claims. JSON inválido e
corpo grande recebem erro genérico; falhas internas não expõem SQL, stack ou
credenciais. Falha operacional de banco gera 500, não falso 401.

## Testes e reprodução

Ver [relatório atual](auth-hardening-report.md) para comandos, resultados completos,
arquivos e limitações. `npm run test:gate` cria PostgreSQL 15 oficial limpo em
Docker, com porta aleatória no loopback e tmpfs, aplica migrations, prova a
rejeição de duplicatas, provisiona senhas efêmeras e cria os seeds sob a 002.
Depois prova que a 003 rejeita hash incompatível e preserva as identidades e
hashes existentes, repete os seeds, inicia a API e roda a suíte inteira. Só seu container
temporário é encerrado; nenhum volume persistente é montado ou apagado.

`npm run test:local` exige o Docker oficial localhost:5433/alfa_gestao e API
em 127.0.0.1:4000. Repete seeds, roda testes e verifica preservação integral dos
registros preexistentes. Testes usam fixtures fictícias com UUIDs dinâmicos e
as removem ao final. A suíte verifica falhas 401/403, isolamento bilateral,
estados de usuário/escola, UUID alheio, SQL sem filtro, escrita cross-tenant,
reúso max=1, concorrência, rollback e perda de conexão. A porta local 5432 é
recusada pelos módulos de conexão; não houve conexão ou alteração no PostgreSQL
antigo do host.

As 40 provas atuais incluem SELECT/COPY negados, EXECUTE restrito, owner
NOLOGIN, negação de alteração de funções/SET ROLE, busca por objetos em
search_path hostil, tabelas temporárias falsas, bcrypt ASCII/Unicode com
72 bytes e recusa de drift no startup. Os resultados anteriores de 30 testes
permanecem no [relatório histórico do Gate 0](gate-0-report.md).
