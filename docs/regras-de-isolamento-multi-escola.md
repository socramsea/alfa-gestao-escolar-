# Regras de Negócio e Isolamento de Dados da API

## 1. Objetivo

Este documento define as regras oficiais de autenticação, autorização e isolamento de dados da API do Alfa Gestão Escolar.

Ele deve ser utilizado por arquitetos, desenvolvedores backend e frontend, QA, DevOps, revisores de Pull Requests, novos colaboradores e responsáveis por segurança e auditoria.

> Um usuário só pode acessar os dados permitidos pelo seu perfil e pela escola associada à sua identidade autenticada.

O cliente nunca pode escolher livremente a escola que deseja consultar ou alterar.

## 2. Conceito de multi-tenancy

Cada escola é um tenant isolado dentro da plataforma. A associação entre usuário e escola é feita por `users.school_id`.

O `school_id` autenticado define o escopo dos dados que o usuário pode consultar ou alterar.

Exemplo:

```text
Usuário A → Escola A
Usuário B → Escola B
```

O Usuário B não pode consultar, alterar ou excluir dados pertencentes à Escola A.

## 3. Fonte confiável do escopo

O escopo da escola deve ser obtido exclusivamente da identidade autenticada:

```js
req.user.school_id
```

O backend não deve usar os seguintes valores para definir o escopo de segurança:

```js
req.query.school_id
req.body.school_id
req.params.school_id
headers enviados pelo cliente
```

Esses valores podem ser utilizados apenas como filtros auxiliares, nunca para substituir ou ampliar o escopo autorizado pelo token.

### Regra obrigatória

O `school_id` enviado pelo cliente deve ser ignorado ou rejeitado quando tentar alterar o escopo autenticado.

Exemplo proibido:

```js
const schoolId = req.query.school_id;
```

Exemplo esperado:

```js
const schoolId = req.user.school_id;
```

## 4. Autenticação

A autenticação é realizada pelo endpoint:

```http
POST /api/auth/login
{ "school": "alfa-reis", "email": "...", "password": "..." }
```

Como o e-mail é único por escola, o login informa o código (`slug`) da escola.

O login deve validar:

- e-mail;
- senha;
- usuário existente;
- usuário ativo;
- usuário não excluído logicamente;
- senha compatível com o hash armazenado.

O token JWT deve conter, no mínimo:

```json
{
  "sub": "ID do usuário",
  "school_id": "ID da escola",
  "role": "perfil do usuário"
}
```

O token não deve ser considerado suficiente sozinho. O middleware deve consultar o usuário no banco para confirmar que ele continua ativo, não foi excluído, possui o perfil atual e está associado à escola correta.

## 5. Respostas de segurança

### 401 Unauthorized

Usar quando não existe token, o token é inválido ou expirado, o formato do header está incorreto, o usuário não foi localizado ou o usuário está inativo/excluído.

Exemplo:

```json
{"error":"Token ausente ou inválido"}
```

### 403 Forbidden

Usar quando o token é válido e o usuário está autenticado, mas seu perfil não possui autorização para a operação.

Exemplo:

```json
{"error":"Permissão insuficiente"}
```

## 6. Perfis de usuário

### `platform_admin`

Perfil administrativo da plataforma. A abrangência deve ser definida explicitamente pelo arquiteto: acesso global a todas as escolas ou acesso restrito à escola presente no token.

### `school_admin`

Administrador de uma escola específica. Pode acessar somente dados, usuários e configurações permitidas da própria escola.

### `teacher`

Professor. Pode acessar somente os módulos e dados autorizados para professores. Não pode acessar rotas administrativas protegidas por:

```js
requireRole("platform_admin", "school_admin")
```

### `student`

Aluno. Deve possuir acesso restrito aos próprios dados e aos módulos autorizados.

## 7. Matriz mínima de autorização

| Recurso | platform_admin | school_admin | teacher | student |
|---|---:|---:|---:|---:|
| Consultar usuários | conforme escopo definido | própria escola | proibido | proibido |
| Consultar escolas | conforme escopo definido | própria escola | proibido | proibido |
| Consultar próprio perfil | permitido | permitido | permitido | permitido |
| Consultar dados de outra escola | proibido por padrão | proibido | proibido | proibido |
| Alterar `school_id` pelo cliente | proibido | proibido | proibido | proibido |

Toda nova rota deve ser adicionada a esta matriz antes de ser implementada.

### 7.1 Matriz implementada (perfis da escola)

A matriz em vigor está em `src/modules/access/permissions.ts`, que é a fonte única. Toda rota declara a permissão exigida.

| Permissão | school_admin | director | secretary | finance | coordinator | teacher |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `school:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `users:read` | ✓ | ✓ | | | | |
| `users:manage` | ✓ | | | | | |
| `academic:read` (anos e turmas) | ✓ | ✓ | ✓ | | ✓ | ✓ |
| `academic:manage` | ✓ | | ✓ | | | |
| `students:read` | ✓ | ✓ | ✓ | | ✓ | |
| `students:manage` | ✓ | | ✓ | | | |
| `guardians:invite` (link de acesso) | ✓ | | ✓ | | | |
| `renewals:read` | ✓ | ✓ | ✓ | | | |
| `renewals:manage` (períodos) | ✓ | | ✓ | | | |
| `renewals:review` (aprovar/rejeitar) | ✓ | | ✓ | | | |
| `dashboard:read` | ✓ | ✓ | ✓ | | | |
| `audit:read` | ✓ | ✓ | | | | |

O responsável não é usuário da equipe. Ele acessa o portal por link pessoal (ADR-002) e só enxerga alunos vinculados a ele em `student_guardians`. Uma tentativa de acessar outro aluno retorna `404`, sem revelar que o registro existe.

`platform_admin` e `student` ainda não foram implementados e aguardam as decisões da seção 17.

### 7.2 Isolamento no banco de dados

Além do filtro por `school_id` nas consultas, as relações entre tabelas usam chaves estrangeiras compostas `(id, school_id)`. Assim o PostgreSQL recusa, por exemplo, um aluno da Escola B apontando para uma turma da Escola A, mesmo que o código falhe.

## 8. Isolamento obrigatório nas consultas

Toda consulta de uma entidade pertencente a uma escola deve filtrar pelo `school_id` autenticado.

```sql
SELECT id, name, email, role, active
FROM users
WHERE school_id = $1
  AND deleted_at IS NULL
ORDER BY email;
```

O valor de `$1` deve vir de `req.user.school_id`, nunca diretamente de parâmetros enviados pelo cliente.

Exemplo esperado:

```js
const schoolId = req.user.school_id;

const result = await pool.query(
  `
    SELECT id, school_id, name, email, role, active, created_at
    FROM users
    WHERE school_id = $1
      AND deleted_at IS NULL
    ORDER BY email
  `,
  [schoolId]
);
```

## 9. Proteção contra alteração de escopo

Deve ser testado o acesso abaixo usando um token da Escola B:

```http
GET /api/users?school_id=ID_DA_ESCOLA_A
Authorization: Bearer TOKEN_DA_ESCOLA_B
```

Resultado esperado:

- nenhum dado da Escola A é retornado;
- o backend continua usando o `school_id` da Escola B;
- o parâmetro é ignorado ou rejeitado;
- o escopo autorizado nunca é ampliado pelo cliente.

## 10. Exclusão lógica

Usuários e escolas não devem ser removidos fisicamente sem decisão explícita do arquiteto.

A exclusão padrão deve usar:

```sql
active = false
deleted_at = NOW()
updated_at = NOW()
```

Consultas normais devem ignorar registros excluídos logicamente:

```sql
WHERE deleted_at IS NULL
```

Usuários inativos não podem autenticar nem acessar recursos protegidos.

## 11. Unicidade de e-mail

O banco deve impedir duplicidade de usuários conforme a regra definida pela empresa.

A decisão recomendada para um sistema multi-escola é:

> Um e-mail não pode se repetir dentro da mesma escola.

Tecnicamente, isso pode ser representado por:

```sql
UNIQUE (school_id, email)
```

A decisão final deve ser confirmada pelo arquiteto, pois o e-mail pode ser único globalmente ou apenas dentro de cada escola.

O código não deve usar `ON CONFLICT (email)` sem que exista uma restrição compatível no banco.

## 12. Endpoints validados

```http
POST /api/auth/login
GET /api/auth/me
GET /api/users
GET /api/schools
```

As rotas `/api/users` e `/api/schools` exigem JWT válido, usuário ativo, perfil autorizado e filtro por `school_id`.

## 13. Testes obrigatórios

### Sem token

```http
GET /api/users
```

Esperado: `401 Unauthorized`.

### Token inválido

```http
GET /api/users
Authorization: Bearer token-invalido
```

Esperado: `401 Unauthorized`.

### Perfil sem permissão

Com um usuário `teacher`:

```http
GET /api/users
```

Esperado: `403 Forbidden`.

### Isolamento por escola

Um usuário da Escola B deve receber somente usuários e dados da Escola B. A Escola A não pode aparecer nos resultados.

### Tentativa de troca de escopo

Com token da Escola B:

```http
GET /api/users?school_id=ID_DA_ESCOLA_A
```

Esperado: dados somente da Escola B.

### Usuário inativo

Um usuário com `active = false` deve ter o login recusado ou o token rejeitado.

## 14. Validação realizada

Os testes manuais realizados confirmaram:

```text
[OK] Login com JWT
[OK] Validação do token
[OK] Validação do usuário no banco
[OK] Bloqueio sem token com 401
[OK] Bloqueio por perfil com 403
[OK] Isolamento da Escola A
[OK] Isolamento da Escola B
[OK] Filtro baseado no school_id do token
[OK] Parâmetro school_id externo não altera o escopo
[OK] Exclusão lógica dos usuários de teste
```

## 15. Checklist para novas funcionalidades

Antes de criar uma nova rota, o desenvolvedor deve responder:

1. Qual perfil pode acessar esta rota?
2. A rota pertence a uma escola?
3. O filtro usa `req.user.school_id`?
4. O usuário pode consultar apenas a própria escola?
5. Existe risco de `school_id` enviado pelo cliente substituir o escopo?
6. O que acontece sem token?
7. O que acontece com token válido, mas sem permissão?
8. O que acontece com usuário inativo?
9. Existe teste usando outra escola?
10. A alteração exige migration ou atualização da matriz de autorização?

Uma Pull Request não deve ser aprovada se essas respostas não estiverem claras.

## 16. Regra de ouro

> Nunca confiar no identificador de escola enviado pelo cliente. O escopo autorizado deve vir da identidade autenticada e ser aplicado pelo backend em todas as consultas e alterações.

Esta regra é obrigatória para todas as áreas futuras da API.

## 17. Decisões pendentes do arquiteto

As decisões abaixo devem ser formalizadas antes de novas implementações:

1. `platform_admin` terá acesso global ou ficará limitado ao `school_id` do token?
2. ~~O e-mail será único globalmente ou apenas dentro de cada escola?~~ Implementado como único por escola, com login informando o código da escola.
3. Quais módulos cada perfil (`school_admin`, `teacher` e `student`) poderá acessar?
4. Quais operações exigirão auditoria?

Quando uma dessas decisões for tomada, este documento deve ser atualizado e a alteração deve ser vinculada ao sprint, issue ou Pull Request correspondente.
