# Alfa Gestão Escolar

Plataforma de gestão escolar para várias escolas, com os dados de cada escola isolados. A Escola Alfa Reis é o piloto, sempre com dados fictícios até a aprovação formal de produção.

## Por onde começar

- [`docs/ROTEIRO.md`](docs/ROTEIRO.md): o que está pronto, o que falta para o MVP e as regras de trabalho. Leia antes de começar qualquer mudança.
- [`docs/MVP-1.md`](docs/MVP-1.md): o MVP 1, matrícula sem papel da unidade nova, com os critérios de aceite e o passo a passo de demonstração no piloto.
- [`docs/visao-negocio-e-arquitetura-do-mvp.md`](docs/visao-negocio-e-arquitetura-do-mvp.md): o produto, o fluxo que define o MVP e seus critérios de aceite.
- [`docs/architecture/arquitetura-sistema-escolar.md`](docs/architecture/arquitetura-sistema-escolar.md): a arquitetura alvo. Cada entrega tem seu documento em `docs/architecture/entrega-N-*.md`.
- [`docs/decisoes/`](docs/decisoes/): decisões registradas (ADRs).

## Estrutura

```text
backend/    API Node.js + Express sobre PostgreSQL com RLS (migrations, módulos, testes)
frontend/   Interface React + Vite (testes do cliente e de navegador com Playwright)
deploy/     Pacote Docker Compose do piloto, configuração e smoke
docs/       Roteiro, visão do produto, arquitetura, entregas e decisões
```

## Executar e testar

- **Piloto completo com Docker:** siga [`deploy/README.md`](deploy/README.md).
- **Desenvolvimento:**
  - PostgreSQL local em `127.0.0.1:5433` com `docker compose up -d`, após definir `POSTGRES_PASSWORD` a partir de `.env.example`.
  - API: configure `backend/.env` a partir de `backend/.env.example` e, em `backend/`, rode `npm run db:migrate`, `npm run db:provision`, `npm run db:seed:admin` e `npm run dev`.
  - Interface: em `frontend/`, rode `npm run dev`.
- **Testes do backend:**
  - `npm run test:gate` recria um banco isolado com Docker e roda tudo.
  - `npm test` usa o banco local e exige a API rodando.
- **Testes do frontend:** `npm test` para o cliente e `npm run test:e2e` para o navegador.
