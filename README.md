# Alfa Gestão Escolar

Plataforma de gestão escolar multi-escola e multiunidade, para escolas que operam em papel e WhatsApp e querem passar a captar, matricular e renovar alunos pelo celular.

**Captação e matrícula de novos alunos (nova unidade)**

- Site da escola editável pela própria equipe: rotina, turmas, uniforme com fotos e dúvidas frequentes.
- Pré-matrícula no site com agendamento de visita e protocolo.
- Fila de captação: conversa pelo WhatsApp, visita, e matrícula online com um clique.
- Funil no painel: quantos contatos viram visita e matrícula, e de onde vêm as famílias.

**Renovação de matrícula (alunos atuais)**

- A Secretaria faz um cadastro mínimo (ou cola uma planilha) e envia um link pelo WhatsApp.
- O responsável confere e completa os dados pelo celular, sem instalar aplicativo nem criar senha.
- A Secretaria vê **só o que mudou**, aprova com um clique, e o sistema grava os dados e cria a matrícula do novo ano.
- A Direção acompanha em tempo real quem respondeu, por turma, e cobra quem falta com um clique no WhatsApp.

Contexto de negócio: [`docs/problema-e-proposta-de-valor.md`](docs/problema-e-proposta-de-valor.md) · Decisões: [`docs/decisoes/`](docs/decisoes/) · Regras de isolamento: [`docs/regras-de-isolamento-multi-escola.md`](docs/regras-de-isolamento-multi-escola.md)

## Estrutura

```
src/            API (Node.js, TypeScript, Express 5, PostgreSQL)
  modules/      um diretório por domínio (ver src/modules/README.md)
  database/     migrations versionadas e seed de demonstração
tests/          testes de integração contra PostgreSQL real
web/            interface (React + Vite): área da escola e portal do responsável
```

## Segurança e escala

- Cada escola é um tenant. O escopo vem sempre do token e nunca do cliente.
- Chaves estrangeiras compostas `(id, school_id)` fazem o próprio banco recusar referências entre escolas.
- O usuário é revalidado no banco a cada requisição (ativo, perfil e escola).
- A matriz de permissões por perfil fica em um único arquivo: `src/modules/access/permissions.ts`.
- Tokens separados para a equipe e para o portal. O link do responsável é armazenado só como hash, expira e é bloqueado após 5 erros.
- Há auditoria de ações relevantes e histórico de cada solicitação de renovação.
- Testes automatizados cobrem autenticação, autorização, isolamento e o fluxo completo.

## Requisitos

- Node.js 20+ e npm 10+
- Docker (para o PostgreSQL) ou PostgreSQL 16 local

## Publicação

O `Dockerfile` gera um container único (site, sistema e API). O passo a passo para o piloto está em [`docs/publicacao.md`](docs/publicacao.md).

## Rodando a demonstração

```bash
docker compose up -d postgres
cp .env.example .env          # troque JWT_SECRET
npm install
npm run db:migrate
npm run db:seed               # dados FICTÍCIOS; use -- --reset para recriar
npm run dev                   # API em http://localhost:4000

cd web && npm install && npm run dev   # interface em http://localhost:5173
```

O seed imprime os acessos. Escola `alfa-reis`, senha `AlfaDemo2026`:

| Perfil | E-mail |
|---|---|
| Secretaria | secretaria@alfareis.demo |
| Direção | direcao@alfareis.demo |
| Administração | admin@alfareis.demo |

Ele também imprime o endereço do site da escola (`/escola/alfa-reis`), um link do portal do responsável e a data de nascimento para entrar.

## Qualidade

```bash
npm run check       # lint + typecheck + testes (requer PostgreSQL)
```

Os testes usam o banco `alfa_gestao_test` (variável `DATABASE_URL`), que é **apagado e recriado** a cada execução. Para criá-lo no Docker:

```bash
docker compose exec postgres createdb -U alfa alfa_gestao_test
```

A CI (`.github/workflows/ci.yml`) roda lint, typecheck, testes e build da API e da interface.

## API

| Método e rota | Permissão |
|---|---|
| `POST /api/auth/login`, `GET /api/auth/me` | pública / autenticado |
| `GET /api/schools/current` | `school:read` |
| `GET, POST, PATCH, DELETE /api/users` | `users:read` / `users:manage` |
| `GET, POST /api/school-years`, `GET, POST, PATCH /api/classes` | `academic:*` |
| `GET, POST, PATCH, DELETE /api/students`, `POST /api/students/import` | `students:*` |
| `POST /api/guardians/:id/access-links` | `guardians:invite` |
| `GET, POST /api/renewal-campaigns`, `POST …/:id/open, close, sync` | `renewals:read` / `renewals:manage` |
| `GET, PATCH /api/renewal-requests`, `POST …/:id/approve, reject, request-changes` | `renewals:read` / `renewals:review` |
| `GET /api/dashboard`, `GET /api/dashboard/renewals/:id` | `dashboard:read` |
| `GET /api/audit-logs` | `audit:read` |
| `GET, POST, PATCH /api/units` | `school:read` / `units:manage` |
| `GET, PUT /api/site`, `POST, DELETE /api/site/assets` | `site:manage` |
| `GET, POST /api/admission-leads`, `POST …/:id/status, notes, visits, convert` | `admissions:read` / `admissions:manage` |
| `GET, POST, DELETE /api/visit-slots` | `admissions:read` / `admissions:manage` |
| `GET /api/dashboard/admissions` | `dashboard:read` |
| `GET /api/public/schools/:slug`, `GET /api/public/assets/:id`, `POST /api/public/schools/:slug/leads` | público |
| `POST /api/portal/session`, `GET /api/portal/me`, `GET, POST /api/portal/renewals/:id` | link do responsável |

## Próximos passos

1. Aprovar ADR-002 e ADR-003 e decidir o escopo do `platform_admin` (painel da plataforma para cadastrar escolas).
2. Receber textos, preços e fotos reais e publicar o piloto da nova unidade (`docs/publicacao.md`).
3. Adicionar Row-Level Security no PostgreSQL como segunda camada de isolamento.
4. Gerar comprovante e contrato aceitos (PDF) e permitir upload seguro de documentos.
5. Seguir para os módulos acadêmico e financeiro conforme a ordem de fases.
