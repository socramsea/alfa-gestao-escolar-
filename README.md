# Alfa Gestão Escolar

Plataforma de gestão escolar multi-escola, construída incrementalmente conforme a visão de negócio e arquitetura do MVP.

## Estado atual

A Fase 0 — Fundamentos está em implementação. Esta etapa prepara:

- backend Node.js + TypeScript + Express;
- PostgreSQL via Docker Compose;
- migrations versionadas;
- estrutura modular;
- logger e tratamento de erros;
- validação de ambiente;
- base para autenticação e isolamento por escola.

## Requisitos

- Node.js 20+
- npm 10+
- Docker e Docker Compose

## Executar PostgreSQL

```bash
docker compose up -d postgres
```

## Instalar dependências

```bash
npm install
```

## Configurar ambiente

```bash
cp .env.example .env
```

Revise os valores de `.env` antes de executar o backend. O arquivo `.env` não deve ser versionado.

## Executar em desenvolvimento

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:4000/health
```

## Migrations

```bash
npm run db:migrate
```

## Estrutura

```text
backend/
├── src/
│   ├── config/
│   ├── database/
│   │   └── migrations/
│   ├── middlewares/
│   ├── modules/
│   ├── app.ts
│   └── server.ts
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## Regras essenciais

- Dados de escola devem ser associados a `school_id`.
- O escopo autorizado deve vir do usuário autenticado, nunca de um parâmetro livre do cliente.
- Dados reais não devem ser usados no ambiente de demonstração.
- Consulte `docs/visao-negocio-e-arquitetura-do-mvp.md` antes de implementar novos módulos.
