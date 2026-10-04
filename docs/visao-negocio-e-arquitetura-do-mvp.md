# Regra de Negócio e Decisão Arquitetural do MVP

- **Produto:** Alfa Gestão Escolar
- **Status:** Aprovado como direção do MVP
- **Escopo inicial:** Escola Alfa Reis
- **Objetivo:** construir uma plataforma de gestão escolar escalável, segura e multi-escola
- **Documento relacionado:** `docs/decisoes/ADR-001-isolamento-multi-escola.md`

## 1. Objetivo do produto

Construir uma plataforma de gestão escolar preparada para atender múltiplas instituições, mantendo os dados de cada escola isolados e permitindo a evolução gradual dos módulos de negócio.

A Escola Alfa Reis será utilizada como primeiro ambiente de validação funcional, com dados fictícios durante o desenvolvimento. O sistema não deverá receber dados reais antes de cumprir os critérios de aprovação para produção definidos neste documento.

## 2. Princípios obrigatórios

### 2.1 Multi-escola e multi-tenant

- Cada escola terá seu próprio conjunto de dados.
- O código e o banco devem suportar múltiplas escolas.
- Todo dado pertencente a uma escola deve estar associado a `school_id`.
- O escopo de acesso deve ser determinado pelo usuário autenticado, nunca por um identificador fornecido livremente pelo cliente.
- Usuários só podem acessar dados permitidos pelo seu papel e pela escola autorizada.

### 2.2 Segurança desde o início

A segurança é requisito funcional e não uma etapa posterior. O sistema deve possuir:

- autenticação real;
- autorização por papel e escola;
- isolamento de dados;
- auditoria;
- histórico de alterações importantes;
- criptografia em trânsito e em repouso;
- políticas de acesso;
- proteção de documentos;
- backups e recuperação testada.

### 2.3 Arquitetura modular

O backend deve ser organizado por módulos de negócio, mantendo responsabilidades separadas e permitindo evolução sem acoplamento desnecessário.

A estrutura deve facilitar:

- manutenção;
- testes;
- revisão de código;
- onboarding de novos colaboradores;
- inclusão de novos módulos;
- substituição ou evolução de integrações.

### 2.4 Banco de dados versionado

O schema do PostgreSQL deve ser controlado por migrations versionadas. O ambiente deve poder ser recriado em qualquer máquina autorizada.

Devem existir:

- migrations reproduzíveis;
- seeds para ambientes de desenvolvimento e teste;
- UUIDs para identificadores públicos;
- exclusão lógica quando aplicável;
- histórico de alterações quando exigido pela regra de negócio.

## 3. Escopo do MVP

O MVP funcional deve concentrar-se no core da plataforma:

1. identidade e acesso;
2. escolas e unidades;
3. usuários, papéis e permissões;
4. alunos e responsáveis;
5. matrículas e renovação;
6. auditoria e histórico essenciais.

Módulos pedagógicos e financeiros serão desenvolvidos em sequência, somente depois que a base de identidade, isolamento e segurança estiver validada.

## 4. Diretrizes de ambiente

O protótipo atual serve para visão e validação funcional. Ele não representa produção.

- Dados do Demo devem ser fictícios.
- Dados reais somente poderão ser usados com autorização formal da Alfa Reis.
- Desenvolvimento, testes e produção devem ser ambientes separados.
- Integrações reais não devem ser ativadas no MVP inicial.
- Pagamentos reais só poderão ser habilitados após validação das regras financeiras e de segurança.
- Upload real de documentos só poderá ser habilitado após a estrutura de armazenamento privado e controle de acesso estar pronta.
- O acesso de produção deverá utilizar domínio e HTTPS.

## 5. Stack aprovada

### Frontend

- React;
- Vite;
- interface responsiva;
- acessível por navegador;
- preparação para evolução futura como PWA.

### Backend

- Node.js;
- Express;
- módulos organizados por domínio;
- autenticação e autorização;
- validação de entradas;
- auditoria;
- regras de escopo por escola;
- tratamento centralizado de erros;
- logger estruturado.

### Banco

- PostgreSQL;
- isolamento por `school_id`;
- UUIDs;
- migrations;
- seeds;
- exclusão lógica;
- histórico de alterações.

### Infraestrutura

- ambiente de desenvolvimento;
- ambiente de testes;
- ambiente de produção;
- Docker Compose para desenvolvimento;
- domínio e HTTPS em produção;
- backups;
- monitoramento;
- recuperação validada.

## 6. Perfis funcionais do produto

Os perfis de negócio previstos são:

- **Administrador:** configuração geral e usuários;
- **Direção:** indicadores, aprovações e relatórios;
- **Secretaria:** alunos, matrículas e documentos;
- **Financeiro:** cobranças, pagamentos e recibos;
- **Coordenação:** turmas, professores e desempenho;
- **Professor:** frequência, notas e avaliações;
- **Responsável:** dados dos alunos, matrícula e pagamentos;
- **Aluno:** notas, frequência e comunicados.

Cada perfil deverá ter permissões explícitas. A implementação não deve assumir que um perfil pode acessar todos os módulos.

### Regra específica do responsável

O responsável só poderá acessar os alunos vinculados a ele por meio da relação `AlunoResponsável`. Não será permitido acessar outro aluno alterando identificadores na URL, query string ou payload.

## 7. Ordem oficial de desenvolvimento

### Fase 0 — Fundamentos do sistema

- Git e branches;
- ambientes;
- Docker Compose;
- migrations;
- logger;
- tratamento de erros;
- validação de entradas;
- estrutura modular;
- documentação;
- base de autenticação;
- base de multi-escola.

### Fase 1 — Identidade e multi-escola

- escolas;
- unidades;
- usuários;
- papéis;
- permissões;
- autenticação;
- sessão segura ou JWT com renovação;
- auditoria.

### Fase 2 — Alunos e responsáveis

- cadastro de alunos;
- cadastro de responsáveis;
- vínculo aluno-responsável;
- documentos, inicialmente com estrutura segura e sem upload real se a proteção ainda não estiver pronta;
- histórico;
- segurança de acesso.

### Fase 3 — Matrículas e renovação

- abertura do período;
- prévia;
- confirmação pelo responsável;
- análise da Secretaria;
- aprovação;
- histórico;
- notificações conforme escopo aprovado.

### Fase 4 — Acadêmico

- disciplinas;
- frequência;
- notas;
- avaliações;
- boletins;
- fechamento;
- histórico de alterações.

### Fase 5 — Financeiro

- planos;
- mensalidades;
- cobranças;
- descontos;
- bolsas;
- pagamentos em sandbox;
- conciliação.

Pagamentos reais e dados completos de cartão não fazem parte do MVP inicial.

### Fase 6 — Produção

- backups;
- monitoramento;
- segurança operacional;
- treinamentos;
- políticas internas;
- SLA;
- suporte;
- validação formal da escola.

## 8. Fluxo funcional mínimo do MVP

O fluxo de negócio que deve ser demonstrado é:

```text
Administrador configura a base
        ↓
Secretaria cadastra aluno e responsável
        ↓
Administrador ou Secretaria configura turma e período
        ↓
Responsável acessa o portal
        ↓
Responsável visualiza a prévia
        ↓
Responsável confirma os dados
        ↓
Secretaria analisa a solicitação
        ↓
Secretaria aprova ou rejeita
        ↓
Sistema registra status, data, usuário e histórico
```

O MVP somente será considerado funcional quando esse fluxo puder ser executado com dados fictícios da Escola Alfa Reis.

> **Atualização (ADR-002):** o cadastro da Secretaria passa a ser mínimo (nome e nascimento do aluno, nome e telefone do responsável) ou por importação de lista. O responsável completa os demais dados pelo link pessoal enviado via WhatsApp, e a Secretaria confere apenas o que foi alterado.

## 9. Entidades iniciais

A base inicial deve ser preparada para as seguintes entidades:

- Escola;
- Unidade;
- Usuário;
- Papel;
- Permissão;
- Aluno;
- Responsável;
- AlunoResponsável;
- Professor;
- Funcionário;
- AnoLetivo;
- Série;
- Turma;
- Matrícula;
- Pré-matrícula;
- Renovação;
- Documento;
- Contrato;
- Aceite;
- Auditoria.

Entidades financeiras, pedagógicas avançadas e de comunicação serão ativadas nas fases correspondentes.

## 10. Auditoria e histórico

As ações importantes devem registrar, no mínimo:

- usuário responsável pela ação;
- escola e unidade relacionadas;
- data e hora;
- operação realizada;
- entidade afetada;
- identificador do registro;
- resultado da operação;
- valores anteriores e posteriores quando aplicável e seguro.

A renovação deve registrar data, hora, usuário e mudança de status. Contratos aceitos devem preservar a versão aceita quando esse módulo for implementado.

## 11. Critérios de segurança antes da produção

O sistema só poderá receber dados reais quando todos os itens abaixo forem atendidos:

- autenticação real;
- isolamento por escola;
- autorização por perfil;
- auditoria de alterações;
- histórico de notas e documentos quando esses módulos estiverem ativos;
- backup restaurável;
- HTTPS;
- documentos e dados protegidos;
- API validada;
- testes de segurança;
- governança e políticas internas;
- treinamento da equipe;
- validação formal da escola.

A aprovação de produção deve ser registrada formalmente e não pode ser inferida apenas porque o fluxo do Demo funciona.

## 12. Critérios de aceite do MVP

- [ ] O projeto possui estrutura modular documentada.
- [ ] O ambiente de desenvolvimento pode ser reproduzido.
- [ ] PostgreSQL é inicializado por migrations.
- [ ] Seeds criam dados fictícios do Demo.
- [ ] Login e autenticação funcionam.
- [ ] Usuários e permissões são validados.
- [ ] Dados são isolados por `school_id`.
- [ ] O responsável acessa somente seus próprios alunos.
- [ ] Secretaria pode cadastrar aluno e responsável.
- [ ] Existe vínculo aluno-responsável.
- [ ] Existe turma e período configurável.
- [ ] O responsável visualiza uma prévia.
- [ ] O responsável confirma os dados.
- [ ] A Secretaria visualiza a solicitação.
- [ ] A Secretaria aprova ou rejeita.
- [ ] Status, data, usuário e histórico são registrados.
- [ ] Testes automatizados cobrem autenticação, autorização e isolamento.
- [ ] Nenhum dado real é utilizado no Demo.

## 13. Próxima ação aprovada

A próxima ação do projeto é executar a **Fase 0 — Fundamentos do sistema**.

A implementação deve começar por:

1. confirmar o repositório e a estrutura de branches;
2. criar a estrutura inicial de pastas;
3. configurar `docker-compose.yml` com PostgreSQL;
4. configurar o backend Node.js com TypeScript e Express;
5. criar migrations iniciais;
6. preparar logger e tratamento de erros;
7. preparar validação de entradas;
8. criar a base de autenticação;
9. criar as bases de escolas, usuários e `school_id`;
10. registrar instruções de execução no README.

Nenhum módulo financeiro, pagamento real, upload real de documentos ou dado de produção deve ser iniciado antes da conclusão e validação desta fase.

## 14. Controle de mudanças

Qualquer alteração de escopo, tecnologia, ordem de fases ou regra de segurança deve ser:

1. documentada;
2. vinculada a uma issue, sprint ou ADR;
3. revisada pelo responsável arquitetural;
4. refletida nos critérios de aceite;
5. testada antes de ser considerada aprovada.

Este documento é a referência de negócio e arquitetura para construir um MVP funcional sem perder a segurança, o isolamento multi-escola e a capacidade de evolução do produto.
