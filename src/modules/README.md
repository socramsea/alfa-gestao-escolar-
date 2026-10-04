# Módulos de negócio

Cada módulo concentra rotas, validações e acesso a dados do seu domínio. Toda rota protegida declara uma permissão de `access/permissions.ts` e filtra pelo `school_id` da identidade autenticada.

| Módulo | Responsabilidade |
|---|---|
| `access` | Perfis e matriz de permissões (fonte única) |
| `auth` | Login da equipe, tokens, senhas |
| `audit` | Registro e consulta de auditoria |
| `schools` | Dados da escola autenticada |
| `users` | Equipe escolar |
| `academic` | Anos letivos e turmas |
| `students` | Alunos, vínculo com responsáveis, importação |
| `guardians` | Responsáveis e links de acesso ao portal |
| `renewals` | Períodos e solicitações de renovação, aprovação e matrícula |
| `portal` | API do portal do responsável |
| `dashboard` | Indicadores para a Direção |
