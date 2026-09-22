# ADR-001: Isolamento multi-escola e autorização por perfil

- **Status:** Proposta para aprovação do arquiteto
- **Data:** 2026-09-22
- **Escopo:** API do Alfa Gestão Escolar
- **Relacionada:** `docs/regras-de-isolamento-multi-escola.md`

## Contexto

A plataforma atende múltiplas escolas no mesmo sistema. Os dados de cada escola devem permanecer isolados, e o acesso deve respeitar o perfil do usuário autenticado.

Os testes manuais da Fase 1C confirmaram que:

- a ausência de token retorna `401 Unauthorized`;
- um perfil sem permissão retorna `403 Forbidden`;
- usuários de escolas diferentes recebem dados separados;
- `school_id` enviado em query string não altera o escopo do token.

## Decisão proposta

### 1. Fonte de autoridade do tenant

O escopo da escola será obtido exclusivamente da identidade autenticada:

```js
req.user.school_id
```

O backend não deve aceitar `req.query.school_id`, `req.body.school_id`, `req.params.school_id` ou headers fornecidos pelo cliente como fonte de autoridade para escolher a escola.

Toda consulta ou alteração de entidade pertencente a uma escola deve aplicar o `school_id` autenticado.

### 2. Autenticação e estado do usuário

O middleware de autenticação deve validar o JWT e consultar o usuário no banco. O acesso deve ser recusado quando o usuário:

- não existir;
- estiver inativo (`active = false`);
- estiver excluído logicamente (`deleted_at IS NOT NULL`);
- possuir token inválido ou expirado.

Falhas de autenticação devem retornar `401 Unauthorized`.

### 3. Autorização por perfil

A autorização deve ser explícita por rota:

- `platform_admin`: abrangência global ou limitada conforme decisão final do arquiteto;
- `school_admin`: somente dados da própria escola;
- `teacher`: somente módulos pedagógicos autorizados;
- `student`: somente os próprios dados e módulos autorizados.

Usuário autenticado sem autorização deve receber `403 Forbidden`.

### 4. Unicidade de e-mail

**Proposta:** o e-mail deve ser único dentro de cada escola, por meio de uma migration com:

```sql
UNIQUE (school_id, email)
```

A migration deve verificar duplicidades existentes antes de criar a restrição. O código não deve usar `ON CONFLICT (email)` sem uma constraint compatível.

## Decisões pendentes para aprovação

1. `platform_admin` terá acesso global a todas as escolas ou também ficará limitado ao `school_id` do token?
2. A unicidade de e-mail será por escola, conforme a proposta acima, ou global na plataforma?
3. Quais endpoints e módulos serão permitidos para `teacher`?
4. Quais endpoints e módulos serão permitidos para `student`?
5. Quais operações exigirão auditoria obrigatória?

## Consequências

### Positivas

- reduz o risco de vazamento entre escolas;
- impede que o cliente escolha outro tenant por parâmetro;
- torna a autorização revisável por perfil;
- fornece critérios objetivos para testes e Pull Requests;
- facilita o onboarding de novos colaboradores.

### Impactos

- toda nova rota multi-escola deverá aplicar o filtro de tenant;
- será necessário criar migration para a regra de unicidade aprovada;
- será necessário automatizar os testes de autenticação, autorização e isolamento;
- a regra de `platform_admin` precisa ser aprovada antes de implementar acesso global.

## Critérios de aceite da Fase 1C

- [ ] Ausência de token retorna `401`.
- [ ] Token inválido ou expirado retorna `401`.
- [ ] Usuário inativo ou excluído não acessa recursos protegidos.
- [ ] Perfil sem permissão retorna `403`.
- [ ] `school_id` é obtido exclusivamente do usuário autenticado.
- [ ] Usuário da Escola A não acessa dados da Escola B.
- [ ] Usuário da Escola B não acessa dados da Escola A.
- [ ] `school_id` enviado por query, body ou parâmetro não altera o escopo.
- [ ] Consultas respeitam exclusão lógica.
- [ ] A unicidade de e-mail é implementada por migration após aprovação.
- [ ] Existem testes automatizados para todos os cenários acima.

## Plano de implementação após aprovação

1. Confirmar as decisões pendentes com o arquiteto.
2. Inspecionar e tratar duplicidades de e-mail existentes.
3. Criar a migration de unicidade aprovada.
4. Criar testes automatizados de autenticação, autorização e isolamento.
5. Revisar todas as rotas multi-escola.
6. Executar a suíte de testes e validar os critérios de aceite.
7. Atualizar este ADR de **Proposta** para **Aceito** e registrar a referência do sprint ou Pull Request.
