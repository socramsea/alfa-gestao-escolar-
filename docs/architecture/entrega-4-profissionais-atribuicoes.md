# Entrega 4 — profissionais e atribuições às turmas

Status: implementação do recorte local concluída; gate local isolado e smoke Docker de deploy aprovados em 2026-10-04; piloto local atualizado e fluxo executado nele por navegador automatizado na mesma data; conferência visual pelo responsável pendente.

## Por que esta entrega

A [arquitetura](arquitetura-sistema-escolar.md) prevê o pedagógico por etapa depois de pessoas e matrículas. O pedagógico exige saber qual profissional atua em qual turma: "professor opera somente atribuições autorizadas". Hoje o sistema cadastra alunos e responsáveis, mas não profissionais. Esta entrega cria esse cadastro e o vínculo com as turmas, sem ainda dar acesso ao professor.

## Decisões aprovadas pelo responsável (2026-10-04)

1. **Só cadastro, sem conta de acesso.** O profissional não recebe login nesta entrega. O cadastro não cria registro em `users`, como já ocorre com responsáveis.
2. **Vários profissionais por turma.** Uma turma aceita mais de um profissional ao mesmo tempo, em qualquer etapa.
3. **Atribuição com data de início e de fim.** A troca de profissional no meio do período fica registrada sem apagar quem estava na turma antes.
4. **Só a administração opera.** Cadastro e atribuição ficam com `school_admin` e `platform_admin`, pelos mesmos controles de estrutura, pessoas e matrículas. Nenhum perfil novo.

## Integração com o que existe

- Turmas existem em `class_groups`, vinculadas a período letivo, etapa e turno (migration 004). O período da turma tem `starts_on` e `ends_on`.
- Pessoas (alunos e responsáveis) seguem o padrão da migration 005: `school_id` obrigatório, FKs compostas, RLS ENABLE/FORCE, runtime com SELECT/INSERT, auditoria por referência e hash sem duplicar dados pessoais.
- A escola vem da identidade autenticada via `withTenant`; `school_id` não é aceito em corpo nem query.

## Modelo

Migration aditiva `007_staff_and_assignments.js`, sem alterar tabelas existentes.

- **`staff_members`** — profissional: nome completo obrigatório; telefone e e-mail opcionais, com a mesma validação de responsáveis. Homônimos permitidos, sem mescla automática.
- **`class_group_staff`** — atribuição: profissional, turma, papel, `starts_on` obrigatório e `ends_on` opcional na criação. Imutável.
- **`class_group_staff_endings`** — encerramento: referência à atribuição e data de fim, no máximo um por atribuição.
- **`staff_events`** — auditoria: ator, escola, operação, chave de idempotência, hash e referência.

O encerramento em tabela própria mantém o runtime sem UPDATE/DELETE, como nas entregas anteriores. A data de fim efetiva de uma atribuição é a do encerramento, quando existir, ou o `ends_on` informado na criação.

API autenticada e paginada como as demais: `GET/POST` em `/api/staff/members`, `/api/staff/assignments` e `/api/staff/assignment-endings`. POST com chave UUID de idempotência: 201 na criação, 200 no reenvio idêntico, 409 em conflito, 404 para referência inexistente ou de outra escola.

Tela `/secretaria/profissionais`, com abas Profissionais e Atribuições, no padrão de `/secretaria/pessoas`. O encerramento fica na aba Atribuições.

## Regras

- Datas da atribuição dentro do período letivo da turma, validadas no backend a partir do registro da turma.
- `ends_on`, quando informado, não anterior a `starts_on`; encerramento não anterior ao início nem posterior ao fim já informado.
- Referências de outra escola recusadas com 404, sem escrita e sem evento.

## Decisões complementares (2026-10-04)

O responsável respondeu "pode seguir com as suas sugestões" aos seis pontos que estavam em aberto. Nos itens 1, 3, 4 e 6 havia sugestão explícita. Nos itens 2 e 5 a pergunta estava em aberto e a regra abaixo foi escolhida na implementação; ficam sujeitas a revisão pelo responsável.

1. **Papéis:** regente, auxiliar e especialista; o papel é obrigatório.
2. **Sobreposição:** o mesmo profissional não pode ter duas atribuições na mesma turma com datas que se cruzam, mesmo com papéis diferentes (409). Em turmas diferentes, inclusive no mesmo turno, é permitido.
3. **Sem data de fim:** a atribuição vale até o fim do período letivo da turma.
4. **Componente curricular:** fora desta entrega; entra quando a oferta curricular for especificada.
5. **Dados do profissional:** somente nome completo, com telefone e e-mail opcionais. Nenhum documento ou cargo é exigido.
6. **Correção de erro:** uma atribuição lançada por engano só pode ser encerrada, não apagada.

A sobreposição é verificada no serviço, sob trava transacional por profissional e turma; não há constraint de exclusão no banco. Datas dentro do período letivo também são validadas no serviço.

## Fora deste recorte

Conta de acesso e senha do professor, o que o professor enxerga, horários e grade, componentes curriculares, frequência, avaliações, carga horária, contratos e folha, edição e exclusão de cadastros.

## Critérios técnicos a preservar

Migration aditiva após a 006; FKs compostas por escola; RLS ENABLE/FORCE; menor privilégio; validação estrita; auditoria na mesma transação; idempotência; nenhum UPDATE genérico ou exclusão de histórico. As novas tabelas entram na verificação de startup.

A validação deverá repetir a matriz das entregas anteriores: isolamento entre escolas, IDOR, perfis, escola suspensa, RLS e FKs direto no banco, rollback de auditoria, concorrência, paginação, fluxo no navegador, gate isolado e smoke Docker, com backup do piloto antes da atualização.

## Validação executada em 2026-10-04

`GATE_BROWSER=1 npm run test:gate` no backend: PostgreSQL temporário, migrations 001–007, 99 testes aprovados, 16 deles em `backend/tests/staff/staff.test.js`. Cobrem cadastro sem criação de conta, período derivado da turma, vários profissionais por turma, sobreposição (inclusive concorrente), datas fora do período, encerramento único, IDOR, validação estrita, perfis, escola suspensa, RLS, FKs e checks no banco, rollback de auditoria, ausência de UPDATE/DELETE e paginação. No navegador, `frontend/e2e/staff.spec.js` cadastra o profissional, atribui à turma, confere a recusa da sobreposição, encerra a atribuição e verifica a persistência após recarregar e nova sessão. `frontend/tests/staff.test.js` cobre o cliente HTTP.

`python3 deploy/smoke.py` terminou com `DEPLOY SMOKE PASS` nas imagens `:local` reconstruídas, com os cinco fluxos de navegador e com profissionais, atribuições e encerramentos incluídos na verificação de reinício e de backup/restauração.

Piloto local, também em 2026-10-04: backup `piloto-antes-profissionais-*.dump`, API parada, setup aplicou a migration 007 e API e frontend subiram com as imagens novas. Contagem e conteúdo de todas as tabelas anteriores ficaram idênticos antes e depois. As tabelas de profissionais começam vazias.

Em seguida, um roteiro de navegador automatizado executou no piloto (`http://127.0.0.1:8088`) o cadastro de `Professora Fictícia Piloto`, a atribuição como regente à turma T1 de 2027 a partir de 01/02/2027, a recusa de uma segunda atribuição sobreposta (409) e o encerramento em 30/06/2027, com persistência após recarregar. O banco do piloto ficou com 1 profissional, 1 atribuição, 1 encerramento e 3 eventos de auditoria.

Limites: o responsável informou ter testado antes dessa execução, mas o banco e o log de acessos do piloto não mostravam nenhum cadastro de profissional naquele momento; a conferência visual do resultado continua pendente. O resultado local não certifica publicação remota.
