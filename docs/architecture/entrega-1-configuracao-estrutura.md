# Entrega 1 — configuração e estrutura escolar

Status: implementação do MVP em validação. Contrato inicial abaixo preservado
como referência; o recorte executável está em [deploy/README.md](../../deploy/README.md).
Data: 2026-09-29.
Referência: [arquitetura consolidada](arquitetura-sistema-escolar.md).

## Resultado esperado

Uma escola configura as etapas que atende e cadastra período letivo,
grupos/séries, turnos e turmas. Dados persistem, ficam isolados por escola
e cada escrita confirmada possui auditoria. A interface apresenta registros
reais e estado vazio quando ainda não existem cadastros.

## Decisões solicitadas

Após a solicitação explícita de MVP pronto para testes/deploy, o recorte técnico
adotado é: administradores atuais cadastram estrutura somente da própria escola;
o único módulo funcional é estrutura, sem endpoint de habilitação comercial;
turmas suportam associação a um ou mais grupos/séries da mesma etapa. Isso evita
criar autoridade global ou fixar prematuramente uma única série por turma.
As decisões de produto D1/D2 abaixo permanecem relevantes à operação definitiva.

- **D1 — autoridade:** escola configura etapas e operador habilita módulos,
  ou administrador escolar configura ambos? A primeira opção demanda um
  procedimento administrativo separado; não concede poder global ao perfil
  `platform_admin` da API atual. Sem resposta, não criar endpoint de habilitação.
- **D2 — turma:** uma série/grupo por turma ou turmas multisseriadas já nesta
  entrega? Isso define FK simples ou entidade de associação e as futuras
  verificações de compatibilidade da matrícula. Sem resposta, não fixar essa
  cardinalidade em migration.

Não há aprovação presumida. Permissões de secretaria, professores e famílias
continuam fora desta entrega até especificação própria.

## Contrato proposto para revisão técnica

Prefixo da API: `/api/structure`. Endpoints autenticados, escola derivada da
identidade; `school_id` em payload é rejeitado. Corpo validado estritamente.
Listagens paginadas, ordem estável e limite máximo de 100 registros.

| Recurso | Campos de criação propostos | Operações iniciais |
| --- | --- | --- |
| `/stages` | code: infantil, fundamental_initial ou fundamental_final | Consulta; configuração depende de D1 |
| `/academic-years` | code, starts_on, ends_on | Criar e listar períodos; código único por escola; datas válidas e início anterior ao fim |
| `/levels` | stage_code, code, name | Criar e listar grupos/séries; etapa deve ser oferecida pela escola |
| `/shifts` | code, name | Criar e listar turnos; código único por escola |
| `/class-groups` | academic_year_id, shift_id, code, referência(s) a grupos/séries conforme D2 | Criar e listar turmas com referências da mesma escola |

Campos textuais: remover espaços externos, rejeitar vazios e limitar tamanho
no contrato e no banco. Datas civis não são timestamps. UUIDs são referências,
não permissões. Não inferir faixa etária de nome de grupo nem promoção a partir
da série. Não atribuir vagas padrão, médias ou calendário de avaliação.

Alteração, encerramento, exclusão e desabilitação terão contratos próprios;
não expor PATCH genérico. Capacidade e reserva de vagas ficam pendentes da
regra operacional, sem transformar ausência de configuração em vagas ilimitadas
para uma futura matrícula.

## Arquivos previstos

- Nova migration após 003: entidades de estrutura/configuração, índices,
  referências compostas, RLS e grants específicos; sem reescrever 001–003.
- `backend/src/modules/structure/`: schemas, rotas e serviços transacionais.
- `backend/src/config/db.js`: incluir novas tabelas na verificação de isolamento.
- `backend/src/app.js`: registrar o módulo.
- `backend/tests/structure/`: testes de API, integridade, autorização e concorrência.
- Frontend: página de configuração/estrutura, cliente autenticado e navegação.
- Runner de validação: preservar reconstrução isolada e regressões da fundação.

## Escritas, auditoria e conflitos

Cada serviço revalida o perfil atual dentro de `withTenant`. Não usar pool
administrativo nem alterar a fronteira `auth_private`. Privilégios de INSERT
serão restritos às tabelas necessárias; sem UPDATE/DELETE em eventos de auditoria.
A referência ator–escola em auditoria deve ser validada antes das novas escritas.

Criação e auditoria são atômicas. Requisições de criação possuem chave de
idempotência com escopo de escola, ator e operação. Repetição do mesmo conteúdo
retorna o resultado original; reutilização da chave com outro conteúdo gera
409. Chave não substitui as constraints de unicidade do domínio.

Respostas previstas: 400 entrada inválida, 401 identidade inválida, 403 falta
de permissão/módulo, 404 referência não visível, 409 conflito e 500 falha interna
genérica. SQL, parâmetros de autenticação e dados de outras escolas não aparecem
em erros. O middleware atual precisa evoluir para distinguir esses erros de domínio.

## Provas necessárias para considerar a entrega concluída

1. Banco limpo aplica migrations e preserva as provas de segurança existentes.
2. Escola infantil, fundamental e mista cadastram somente suas estruturas.
3. A e B não leem nem referenciam registros uma da outra; consulta sem contexto
   não retorna dados; RLS de escrita e FKs são testadas diretamente.
4. Perfil não autorizado recebe 403; mudança de perfil prevalece sobre token antigo.
5. Endpoint recusa tenant no payload e referências incompatíveis.
6. Reenvio e requisições concorrentes não duplicam efeito nem auditoria.
7. Falha na auditoria reverte criação; falha de negócio não deixa evento de sucesso.
8. Interface cria e consulta dados reais, mostra falhas e não anuncia sucesso antes do commit.
9. Só módulos implementados podem ser anunciados como funcionais; habilitação de
   catálogo não equivale a implementação de financeiro, pedagógico ou matrícula.

## Limite desta preparação

Validação executada nesta preparação: `npm run test:gate`, no backend, terminou
com exit 0, 40 testes aprovados, zero falhas e zero skips. Reconstrução em
container Docker temporário com tmpfs e porta isolada, incluindo migrations
001–003, preflight, seeds, API e sintaxe. Não executou migrations no banco oficial.
Esse resultado certifica a reconstrução da fundação existente, não a Entrega 1.

Essa preparação foi sucedida pela implementação da migration 004, módulo de
estrutura, interface e pacote Docker. A validação do MVP deve ser lida no
relatório específico, sem confundir os 40 testes da preparação com a suíte atual.
Publicação em servidor continua dependente de destino/configuração definidos.
