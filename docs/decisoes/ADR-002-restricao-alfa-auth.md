# ADR-002 — Remover leitura direta de credenciais por alfa_auth

Status: **ACEITO E IMPLEMENTADO**, autorização explícita do responsável
("SIM") em 2026-09-24. Substitui somente a proibição anterior de SECURITY
DEFINER e a leitura direta por alfa_auth no ADR-001; preserva identidade de
login global, regra de escola e isolamento tenant-scoped.

## Problema

A migration 002 concedia SELECT de password_hash em users para alfa_auth e
uma policy SELECT global. A consulta HTTP não devolvia o hash, mas quem
obtivesse essa credencial PostgreSQL poderia extrair hashes diretamente.
Filtros no código ou uma GUC de email controlável pela própria role não
removeriam esse poder.

## Decisão aplicada pela migration 003

1. Revogar SELECT de tabela **e de coluna** de alfa_auth em users/schools,
   retirar suas policies globais e manter DML negado. Nenhuma senha é rotacionada
   ou hash reescrito por esta mudança; migrations 001 e 002 permanecem intactas.
2. Criar alfa_auth_owner com NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
   NOREPLICATION, NOBYPASSRLS e NOINHERIT, sem memberships em qualquer direção.
   Ele possui as funções, nunca as tabelas/schema, e só lê as colunas internas
   necessárias por policies SELECT explícitas. Não recebe DML/audit_logs.
3. Criar schema auth_private sem acesso de PUBLIC/alfa_app. alfa_auth recebe
   USAGE e EXECUTE apenas nas duas funções de negócio abaixo. Nenhuma role
   da API recebe CREATE no schema ou capacidade de assumir o owner.
4. `authenticate(text,text)`: recebe email e senha, verifica limites, consulta
   identidade única, compara bcrypt no PostgreSQL e valida usuário/escola.
   Retorna somente id, school_id, name, email, role, active; falha retorna
   zero linhas. Não há school_id de entrada nem retorno de hash.
5. `resolve_identity(uuid)`: recupera os mesmos campos de usuário/escola
   válidos. O middleware chama após verificar JWT e compara vínculo atual;
   a função não autentica UUID nem emite tokens.
6. Funções SECURITY DEFINER com owner técnico, search_path fixo em
   pg_catalog, pg_temp, row_security=on, tabelas/funções de aplicação
   qualificadas por schema e nenhum SQL dinâmico. EXECUTE de PUBLIC e
   alfa_app revogado na mesma transação de criação.
7. Iniciar API somente após verificar atributos do owner, ausência de
   memberships/ownership indevido, negação de acesso direto de alfa_auth,
   ACLs/configuração das duas funções e controles RLS anteriores.

## Compatibilidade e validação

Os seeds existentes geram bcrypt 2a. A migration recusa explicitamente hash
não compatível de usuário não deletado antes de alterar privilégios; não
seleciona um algoritmo fraco nem converte dados automaticamente. O verificador
aceita bcrypt 2a com o custo armazenado. Um hash inválido introduzido depois
não autentica. Para identidade ausente/inválida, usa hash fictício cost 12
para executar bcrypt, sem prometer tempo constante entre todos os custos.

Senha deve ter 1 a 72 bytes: API e SQL recusam excesso sem truncamento.
Zod rejeita NUL antes do envio ao PostgreSQL. Testes provam compatibilidade
ASCII e Unicode no limite de 72 bytes. A regra compartilhada
school_allows_access continua SECURITY INVOKER e permite apenas escola não
deletada em trial/active.

## Provas executadas

A suíte passou com 40/40 testes no Docker limpo e no Docker oficial da porta
5433. Novas provas incluem SELECT de tabela/coluna e COPY negados, ausência de
hash nos resultados, senha errada/identidade ausente, owner e EXECUTE restritos,
negação de SET ROLE/alteração de função, busca em search_path hostil com tabelas
temporárias falsas e recusa de configurações inseguras no startup.

A reconstrução cria seeds antes da 003 e compara snapshots para provar upgrade
sem reescrever hashes. Também comprova recusa de hash incompatível e seeds
idempotentes. A aplicação oficial comparou usuários, escolas, audit_logs e
hashes antes/depois da migration: nenhuma alteração nesses dados.

Ver [relatório e evidências](../architecture/auth-hardening-report.md).

## Limites

A credencial alfa_auth ainda permite tentativas de autenticação e consultas
de campos públicos por UUID conhecido. Não há novo mecanismo de limitação de
tentativas nesta mudança. Ela deixou de permitir extração direta de hashes;
isso não equivale a proteger contra comprometimento total da API ou do
administrador PostgreSQL. O owner interno necessariamente lê os hashes.

As senhas agora são verificadas no banco. Conexões externas de produção devem
proteger o transporte e os logs de parâmetros; nesta execução o banco oficial
permanece em 127.0.0.1:5433 e nenhum segredo foi registrado nos artefatos.

## Referências técnicas

- [PostgreSQL 15: uso seguro de SECURITY DEFINER](https://www.postgresql.org/docs/15/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY): search_path confiável, pg_temp por último e revogação de EXECUTE público na transação de criação.
- [PostgreSQL 15: pgcrypto](https://www.postgresql.org/docs/15/pgcrypto.html): crypt para comparação com bcrypt e limite de 72 bytes; compatibilidade efetiva também provada pela suíte.
