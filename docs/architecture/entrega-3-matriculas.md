# Entrega 3 — matrícula com turma obrigatória

Status: implementação do recorte local concluída; gate local isolado e smoke Docker de deploy aprovados em 2026-10-03; fluxo de matrícula executado no piloto local por navegador automatizado em 2026-10-04 e conferido no banco; o responsável confirmou na tela do piloto, na mesma data, que a matrícula aparece na lista.

## Autorização recebida

Após o aceite de estrutura escolar e pessoas/vínculos, o usuário autorizou a matrícula vinculada ao aluno, período letivo e turma. Confirmou que a turma é obrigatória para confirmar a matrícula.

Os cadastros e os dados do piloto existente devem ser preservados. Permanecem fora deste recorte financeiro, pedagógico, CRM, portal, renovação e transferência de turma.

## Integração confirmada pela inspeção

- Alunos existem em students, isolados por school_id (migration 005).
- Turmas existem em class_groups, vinculadas a período, etapa e turno (migration 004).
- Grupos/séries oferecidos pela turma são associados em class_group_levels. A matrícula precisa identificar o grupo/série quando a turma possui mais de um, sem escolher silenciosamente.
- A administração atual usa school_admin/platform_admin e withTenant; não há autorização global implícita.
- A turma T1 do piloto e as pessoas existentes não serão recriadas ou substituídas.

Fluxo previsto: selecionar aluno → período → turma do período → grupo/série oferecido pela turma → confirmar. A escola vem da identidade autenticada. Turno e etapa devem ser compatíveis com a turma; referências de outra escola não são aceitas.

## Decisões aprovadas

1. **Uma matrícula por aluno em cada período letivo.** Constraint única `(school_id, student_id, academic_year_id)`; duas criações concorrentes resultam em uma matrícula e conflito explícito.
2. **Controle de vagas fora deste piloto.** Não existe campo capacity nas turmas e esta entrega não acrescenta reserva nem promete disponibilidade.
3. **Turma obrigatória**, como confirmado antes.

A matrícula também registra o grupo/série efetivamente oferecido pela turma; quando houver várias séries, o operador seleciona uma explicitamente. Período deriva do registro da turma no backend, nunca do valor declarado pelo navegador.

## Implementação

Migration `006_enrollments.js`; entidade `enrollments` imutável neste MVP, com aluno, período, turma e grupo/série (`level_id`) obrigatórios. FKs compostas vinculam aluno/escola, turma/período e série/grupo da turma. `enrollment_events` registra apenas ator, escola, chave, hash, instante e referência; sem duplicar dados pessoais.

`GET/POST /api/enrollments`, paginado e autenticado para os perfis administrativos atuais. POST usa chave UUID de idempotência. Primeira criação retorna 201; repetição do mesmo pedido retorna 200; payload divergente ou unicidade violada retorna 409; referência inválida/invisível retorna 404. `school_id` deriva de withTenant e não pode ser enviado no corpo/query.

Migration 006 aplica ENABLE/FORCE RLS; runtime limitado a SELECT/INSERT; autenticação sem leitura direta; verificador de startup exige RLS em enrollments e enrollment_events. Criação e evento de auditoria compartilham transação.

A tela `/secretaria/matriculas` lista os registros e confirma uma matrícula usando aluno, período, turma e grupo/série cadastrados. O período filtra as turmas e o backend deriva/confere o período da turma. Grupo/série precisa estar associado à turma.

## Critérios técnicos a preservar

Migration aditiva após 005; FKs compostas, RLS ENABLE/FORCE, menor privilégio, validação estrita, auditoria transacional e idempotência. Nenhum UPDATE genérico ou exclusão de histórico. Reenvio não duplica matrícula; tentativas concorrentes respeitam as regras que forem aprovadas.

A validação deverá executar regressões de estrutura/pessoas, testes de matrícula/isolamento/IDOR, fluxo no navegador, build e smoke local. A atualização do piloto exige backup e comparação dos dados anteriores. Banco oficial e outros projetos permanecem fora do escopo.

Este documento não representa funcionalidade implementada nem resultado de teste de matrícula. Migration 006 foi criada para a entrega. A migration foi aplicada somente ao piloto local isolado, com backup protegido e snapshot antes/depois. Build de frontend e imagens locais passaram; containers estão saudáveis. Código/build/health não comprovam a regra funcional.

## Validação executada em 2026-10-03

`GATE_BROWSER=1 npm run test:gate` no backend: PostgreSQL temporário em tmpfs, migrations 001–006, seeds, API e suíte completa com 83 testes aprovados, 14 deles em `backend/tests/enrollments/enrollments.test.js`. Cobrem período derivado da turma, uma matrícula por aluno/período (inclusive concorrente), idempotência, IDOR e série fora da turma, validação estrita, perfis, escola suspensa, RLS, FKs compostas, rollback de auditoria, ausência de UPDATE/DELETE e paginação. No navegador, `frontend/e2e/enrollment.spec.js` confirma a matrícula pela tela, a recusa de duplicidade e a persistência após recarregar e nova sessão. `frontend/tests/enrollment.test.js` cobre o cliente HTTP.

Smoke Docker de deploy, também em 2026-10-03: `python3 deploy/smoke.py` terminou com `DEPLOY SMOKE PASS` usando as três imagens `:local` reconstruídas com o código de matrícula. Verificou setup repetido, proxy/headers, runtime sem credenciais administrativas e com `no-new-privileges`, os três fluxos no navegador (estrutura, pessoas e matrícula), persistência após reinício da API e backup/restauração, agora incluindo `enrollments` e `enrollment_events`. As contagens do smoke foram ajustadas para os dados criados pelos três specs.

Bloqueio de host encontrado e resolvido antes do smoke: havia dois daemons Docker ativos no mesmo socket (`docker-ce` do apt e o snap `docker` 29.8.0). Quando o snap atendia, o AppArmor negava a troca do perfil `snap.docker.dockerd` para `docker-default` sob `no-new-privileges` (`exec: operation not permitted`). O snap foi parado e desabilitado; o smoke passou no `docker-ce` 29.8.2. Nenhum controle do pacote foi removido. O banco de desenvolvimento da porta 5433 existia somente no daemon do snap; há dump em `deploy/backups/`.

Limites: o piloto local teve backup (`piloto-antes-smoke-matriculas-20261004T020514Z.dump`), e foi reiniciado com as imagens novas, preservando os cadastros. Em 2026-10-04, um roteiro de navegador automatizado executou no piloto (`http://127.0.0.1:8088`) o cadastro de um aluno fictício, a matrícula em 2027/T1/Grupo 1, a recusa da segunda tentativa (409) e a persistência após recarregar; o banco do piloto ficou com 1 aluno, 1 matrícula e 1 evento de auditoria. Um registro anterior de conferência manual em 2026-10-03 foi retirado: o banco e o log de acessos do piloto não mostravam nenhum cadastro de aluno ou matrícula naquela data. Na mesma data, o responsável abriu a tela de matrículas do piloto e confirmou que a matrícula aparece na lista. O resultado local não certifica publicação remota.
