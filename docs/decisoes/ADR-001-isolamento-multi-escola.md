# ADR-001 — Isolamento multi-escola

Status: ACEITO para a fundação do MVP. Decisões de estado da escola e identidade
aprovadas explicitamente pelo responsável pelo projeto nesta missão.
A decisão 3 foi revisada com autorização explícita em 2026-09-24:
ver [ADR-002](ADR-002-restricao-alfa-auth.md).

## Contexto

Filtros por school_id isolavam respostas, mas a API usava postgres, que ignora
RLS. O login escolhia um registro por email com LIMIT 1, embora a unicidade
original permitisse repetir email entre escolas. Não havia verificação do
estado da escola. A migration 001 deve permanecer intacta.

## Decisões

1. Escola permite autenticação/acesso somente com deleted_at IS NULL e status
   em ('trial', 'active'). Todo outro estado é negado. A função SQL invoker
   school_allows_access centraliza a regra para aplicação e policies.
2. Login continua email + password, sem school_id fornecido pelo cliente.
   O índice parcial UNIQUE em lower(email), WHERE deleted_at IS NULL, torna
   o email globalmente único entre não deletados, **inclusive inativos**.
   Isso segue a preferência explícita do índice e evita ambiguidade ao
   reativar usuário. A migration falha claramente diante de duplicatas sem
   corrigir, apagar ou escolher identidade automaticamente. Não há LIMIT 1.
3. A proibição inicial de SECURITY DEFINER foi substituída pelo ADR-002.
   alfa_auth passa a ter somente EXECUTE nas funções restritas de autenticação
   e reconstrução de identidade, sem SELECT nas tabelas. O owner técnico
   alfa_auth_owner é NOLOGIN, sem superuser/BYPASSRLS/memberships ou ownership
   das tabelas; as funções não retornam hashes. A migration 003 revoga também
   os grants de coluna antigos. alfa_app continua sendo o pool tenant-scoped.
4. Validar senha, usuário e escola; obter school_id do registro autenticado;
   emitir JWT. Nas requisições seguintes, verificar assinatura/claims,
   reconstruir identidade e autorização no banco e verificar o vínculo.
   JWT não determina role/estado atual. TenantContext vem dessa identidade.
5. Operações de tenant usam alfa_app, sem superuser, BYPASSRLS, ownership ou
   memberships. Conexão administrativa distinta fica nos comandos de
   migrations/provisionamento/seeds, sem importação pelos módulos HTTP.
6. Usar contexto local à transação em cliente reservado de pg.Pool. Garantir
   commit/rollback, reset defensivo e descarte em falha de limpeza. Revalidar
   identidade na transação antes de ler dados; me respeita id e school_id.
7. ENABLE/FORCE RLS em users, audit_logs e schools. schools.id é o tenant;
   sua policy também exige escola autorizada. USING e WITH CHECK protegem
   leitura e escrita; nenhum tenant tem bypass por role funcional do usuário.
8. Conceder apenas SELECT necessário aos endpoints existentes. DML negado;
   testes de policies de escrita usam grants transacionais revertidos, não
   ampliação permanente de privilégios para fazer testes passarem.

## Consequências e limites

O mesmo email não pode representar usuários não deletados em duas escolas.
Necessidade futura de participação em várias escolas exige mudança explícita
para **identidade global + memberships**; não flexibilizar silenciosamente
este índice nem voltar a escolher tenant por LIMIT 1.

A unicidade original (school_id, email) continua existindo, inclusive para
excluídos. Reutilização de email após exclusão pode ainda conflitar dentro da
mesma escola; não foi implementado fluxo de recadastro nesta fundação.

alfa_auth não pode mais ler hashes diretamente; esse acesso interno pertence
somente ao owner NOLOGIN das funções. A credencial de autenticação ainda
permite tentativas de senha e consulta de campos públicos por UUID conhecido. RLS protege consultas tenant-scoped
contra filtros esquecidos; não protege contra total comprometimento da API,
credenciais de autenticação ou administrador do banco. Escolas/usuários
bloqueados deixam de passar nas validações seguintes, sem cancelamento
retroativo de operações em andamento.

As migrations 002 e 003 não oferecem rollback automático para remover controles;
reversão exige plano administrativo explícito. Reconstrução usa migrations
para frente em banco limpo. Senhas são fornecidas por ambiente, nunca migration.

## Provas

Ver [TenantContext](../architecture/tenant-context.md),
[relatório atual](../architecture/auth-hardening-report.md) e evidências da suíte completa
no Docker oficial e em reconstrução limpa. O gate exige todos os critérios;
resultados parciais não são aprovação.
