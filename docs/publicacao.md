# Publicação para o piloto

Guia para colocar o sistema na internet com dados reais da nova unidade. Antes de usar dados reais, cumpra os critérios da seção 11 de `docs/visao-negocio-e-arquitetura-do-mvp.md`.

## O que é publicado

Um único container (ver `Dockerfile`) entrega:

- o site da escola: `https://SEU-DOMINIO/escola/alfa-reis`
- a área da equipe: `https://SEU-DOMINIO/login`
- o portal das famílias: `https://SEU-DOMINIO/r/...`
- a API: `https://SEU-DOMINIO/api/...`

Ao iniciar, o container aplica as migrations pendentes.

## Do que você precisa

1. **Um serviço de containers** com HTTPS automático (Render, Railway, Fly.io ou uma VPS com Docker e Caddy).
2. **PostgreSQL 16 gerenciado** com backup diário automático (o próprio serviço costuma oferecer).
3. **Um domínio** (ex.: `alfareis.com.br`).

## Variáveis de ambiente

| Variável | Valor |
|---|---|
| `DATABASE_URL` | URL do PostgreSQL gerenciado (com `?sslmode=require` se o serviço exigir) |
| `JWT_SECRET` | 48 bytes aleatórios: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PUBLIC_APP_URL` | `https://SEU-DOMINIO` (usado nos links enviados pelo WhatsApp) |
| `CORS_ORIGIN` | `https://SEU-DOMINIO` |
| `NODE_ENV` | `production` (já definido na imagem) |

Nunca coloque essas variáveis no repositório.

## Primeiro acesso

O seed de demonstração **não roda em produção**. Para criar a escola real, rode uma única vez, com `DATABASE_URL` de produção, um script SQL revisado como este:

```sql
INSERT INTO schools (name, slug, status) VALUES ('Escola Alfa Reis', 'alfa-reis', 'active');
INSERT INTO units (school_id, name, slug)
  SELECT id, 'Unidade Jardim', 'jardim' FROM schools WHERE slug = 'alfa-reis';
-- Gere o hash da senha com: node -e "require('bcryptjs').hash('SENHA', 12).then(console.log)"
INSERT INTO users (school_id, name, email, role, password_hash)
  SELECT id, 'Nome do administrador', 'admin@alfareis.com.br', 'school_admin', '<HASH>'
    FROM schools WHERE slug = 'alfa-reis';
```

Depois disso, tudo é feito pela interface: unidades, equipe, turmas, horários de visita e o conteúdo do site.

## Checklist antes de abrir para as famílias

- [ ] HTTPS ativo no domínio
- [ ] Backup automático do banco ligado e **uma restauração testada**
- [ ] `JWT_SECRET` forte e exclusivo de produção
- [ ] Textos, preços e fotos reais no editor do site; site publicado
- [ ] Horários de visita abertos e período de matrícula criado
- [ ] Equipe treinada (Secretaria: captação, visitas, aprovação)
- [ ] Aprovação formal da escola registrada
