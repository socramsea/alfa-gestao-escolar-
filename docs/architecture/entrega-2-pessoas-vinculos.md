# Entrega 2 — alunos, responsáveis e vínculos

Recorte aprovado na conversa após o aceite manual da turma T1: cadastro mínimo, com dados fictícios no piloto. Mantém o monólito modular e a autorização administrativa da entrega de estrutura.

## Contrato implementado

Prefixo `/api/people`. GET paginado e POST para `students`, `guardians` e `student-guardians`. A escola é derivada da identidade autenticada; não é selecionável pelo cliente. Somente `school_admin` e `platform_admin`, dentro da própria escola. Responsável cadastrado não é usuário e não recebe login.

| Recurso | Campos aceitos no POST |
|---|---|
| students | full_name obrigatório (até 150 caracteres); birth_date obrigatória, data civil válida entre 1900-01-01 e hoje |
| guardians | full_name obrigatório (até 150); phone opcional (até 30, caracteres usuais de telefone); email opcional (até 150, formato de e-mail) |
| student-guardians | student_id e guardian_id UUID da mesma escola; relationship obrigatório (texto até 80); is_legal booleano explícito |

Telefone e e-mail vazios tornam-se NULL. E-mail é normalizado para minúsculas. Nome e e-mail não identificam unicamente pessoas: homônimos permanecem separados, com UUID visível para diferenciação na interface. Não há obrigação de telefone brasileiro ou CPF.

Um aluno pode ter vários responsáveis e um responsável pode se vincular a vários alunos. O mesmo par aluno–responsável não pode ser cadastrado duas vezes. O checkbox de responsável legal inicia desmarcado. Ele registra a informação declarada pelo administrador; não verifica documentos nem concede acesso a outros módulos.

GET aceita apenas `page`, inteiro de 1 a 10000; até 100 itens por página, ordem created_at/id. POST exige Idempotency-Key UUID; reenvio idêntico retorna 200, criação 201, conflito 409. Entrada inválida retorna 400; identidade inválida 401; perfil negado 403; referência ausente ou de outra escola 404.

## Persistência e proteção

Migration `005_people_and_guardians.js`, aditiva: students, guardians, student_guardians e people_events. FKs compostas preservam escola nas referências de aluno, responsável e ator. ENABLE/FORCE RLS em todas as tabelas; runtime apenas SELECT/INSERT; alfa_auth sem acesso direto.

Criação e auditoria acontecem em uma transação de withTenant. Evento contém ator, escola, operação, instante, chave, hash do payload e ID da entidade. Não replica nome, nascimento, contatos ou corpo do pedido. Reenvio recupera a entidade pelo ID sob o mesmo contexto de escola. UPDATE/DELETE não são concedidos ao runtime.

A inicialização da API exige RLS/FORCE também nas quatro tabelas novas. Migrations 001–004 e funções auth_private permanecem intactas. O gate verifica upgrade 004→005 com estrutura preexistente e reaplicação sem mudanças.

## Interface

Nova rota `/secretaria/pessoas`, com abas Alunos, Responsáveis e Vínculos. Navegação entre estrutura e pessoas, listagens paginadas, referências carregadas em todas as páginas, mensagens de falha e chave de reenvio preservada em tentativa repetida. O piloto começa com cadastro manual e dados fictícios.

## Limites

Não inclui matrícula, alocação em turma, renovação, edição/exclusão, importação, CPF, endereço, upload/documentos, saúde, responsável financeiro, vigência de vínculo, recuperação de senha, acesso ao portal, financeiro, pedagógico ou CRM. A aprovação desta entrega não resolve as decisões futuras de matrícula do modelo mínimo.

## Verificação

- `backend/tests/people/people.test.js`: API, validação, isolamento bilateral, IDOR, school_id injetado, perfis, escola suspensa, RLS/ACL, FKs, concorrência/idempotência, rollback de auditoria, paginação e homônimos.
- `frontend/tests/people.test.js`: contrato de transporte e erros.
- `frontend/e2e/people.spec.js`: criação pelas telas, vínculo, rejeição de duplicação, reload, nova sessão e viewport móvel.
- `backend/scripts/gate.js`: upgrade com dados existentes, reconstrução e regressões completas; `GATE_BROWSER=1` inclui os dois fluxos E2E.
- `deploy/smoke.py`: execução das imagens com controles, navegador, persistência após reinício e restauração de estrutura/pessoas.

## Resultado executado — 02/10/2026 (horário local)

Validação técnica PASS no ambiente local; aceite manual do usuário para esta nova entrega ainda pendente.

- Backend: **69 testes aprovados, zero falhas/skips** (53 regressões e 16 novos). Sintaxe passou. Inclui migrations 001–005, preflight, seeds e preservação da estrutura no upgrade. [TAP completo](evidence/people-clean-rebuild.txt).
- Frontend: **11 testes unitários aprovados**, zero falhas; build de produção passou. Comando: `node --test tests/*.test.js`, executado no frontend fora do sandbox para listar cada caso.
- Navegador: **2 cenários aprovados no gate local e os mesmos 2 na stack Docker**. Pessoas/vínculos persistem após reload e nova sessão; duplicação de vínculo recusada; viewport móvel verificado.
- Três imagens Docker construídas; smoke passou com no-new-privileges, filesystem somente leitura na API, proxy/headers, reinício e backup/restauração de estrutura e pessoas. [Smoke completo](evidence/people-deploy-smoke.txt).
- Piloto `alfa-piloto-local`: backup protegido criado, somente migration 005 aplicada, snapshot integral de escolas/usuários/estrutura/auditorias anteriores preservado. Três serviços saudáveis. [Upgrade](evidence/people-pilot-upgrade.txt).
- Verificação final no navegador em `http://127.0.0.1:8088`: login, turma T1 com 2027/Manhã/Grupo 1 preservada; três abas novas vazias. Nenhum dado real inserido. Banco oficial em 5433 não alterado.

Comandos principais: `npm run lint`, `npm run build`, `GATE_BROWSER=1 npm run test:gate`, `node --test tests/*.test.js`, build Compose com perfil setup e `python3 deploy/smoke.py`. O script temporário de atualização fez backup e comparação de snapshots antes/depois da migration somente no piloto.

A primeira tentativa de gate identificou chamada incompatível de Zod no validador de telefone; corrigida antes da reconstrução completa aprovada. Um check de sintaxe foi inicialmente chamado fora do diretório backend e repetido no diretório correto com sucesso.

Não houve commit, push, publicação remota ou mudança nas migrations 001–004. Disco com aproximadamente 2,3 GB disponíveis ao final; acompanhar espaço antes de novos builds.

### Arquivos desta entrega

Criados: migration 005; backend/src/modules/people/service.js e people.routes.js; backend/tests/people/people.test.js; frontend/src/pages/PeoplePage.jsx; frontend/src/auth/people-api.js; frontend/tests/people.test.js; frontend/e2e/people.spec.js; este documento e evidências.

Atualizados: backend/src/app.js, backend/src/config/db.js, backend/scripts/gate.js; frontend/src/App.jsx, frontend/src/auth/AuthContext.jsx, frontend/src/pages/StructurePage.jsx; deploy/smoke.py, deploy/README.md, deploy/PILOTO-LOCAL.md; docs/architecture/modelo-minimo-escolar.md. O checkout continua sem commits e com arquivos não rastreados; git diff vazio não representa ausência de implementação.
