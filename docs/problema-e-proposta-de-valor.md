# Problema e Proposta de Valor

- **Produto:** Alfa Gestão Escolar
- **Status:** Rascunho para validação com a Escola Alfa Reis
- **Documentos relacionados:** `docs/visao-negocio-e-arquitetura-do-mvp.md`, `docs/decisoes/ADR-001-isolamento-multi-escola.md`

## 1. Situação atual da escola

A operação da Escola Alfa Reis é hoje inteiramente analógica:

- cadastros, matrículas e renovações são feitos em papel;
- a comunicação com responsáveis acontece pelo WhatsApp, de forma informal e espalhada em conversas individuais e grupos;
- informações recebidas pelo WhatsApp são transcritas manualmente para o papel;
- não existe sistema integrando os setores;
- a conectividade é limitada (rede da escola e internet dos responsáveis).

O resultado é um processo caótico: dados duplicados ou divergentes, retrabalho da Secretaria, perda de informação, ausência de histórico e nenhuma visão consolidada para a Direção.

## 2. Dores principais

| # | Dor | Quem sofre |
|---|-----|-----------|
| D1 | A Secretaria digita e confere os mesmos dados repetidas vezes, a cada ano | Secretaria |
| D2 | Pedidos e confirmações se perdem entre WhatsApp e papel | Secretaria, Responsável |
| D3 | O responsável não sabe em que etapa está sua solicitação e pergunta repetidamente | Responsável, Secretaria |
| D4 | Não há registro confiável de quem fez, aprovou ou alterou o quê | Direção |
| D5 | A Direção não tem números: quantos renovaram, quantos faltam, quem está pendente | Direção |
| D6 | Dados pessoais de menores circulam em papel e conversas sem controle de acesso | Todos (risco LGPD) |

## 3. Princípio: não entregar "mais do mesmo"

Digitalizar o formulário de papel não é suficiente. Se o sistema apenas transferir para a tela o mesmo trabalho manual, a Secretaria continuará digitando, o responsável continuará perguntando pelo WhatsApp e a escola não perceberá ganho.

O valor está em **mudar quem faz o trabalho e eliminar etapas**, não em trocar o papel pela tela.

## 4. Proposta de valor

### 4.1 O responsável preenche, a Secretaria valida

Em vez de a Secretaria cadastrar todos os alunos e responsáveis, o responsável recebe um link e preenche ou confirma os dados. A Secretaria passa a apenas conferir e aprovar.

- Resolve: D1, D2.
- No primeiro ano, este mesmo fluxo serve para digitalizar a base que hoje está em papel.
- Nos anos seguintes, a renovação já vem pré-preenchida; o responsável só confirma ou corrige.

### 4.2 WhatsApp como porta de entrada, não como sistema

O WhatsApp é onde os responsáveis já estão. O sistema não compete com ele: usa-o como canal para entregar o link do portal. A conversa leva ao sistema, e o registro oficial fica no sistema.

- Resolve: D2.
- No MVP, o envio do link é manual (sem integração com a API do WhatsApp), respeitando a regra de não ativar integrações reais nesta fase.

### 4.3 Status visível para o responsável

O responsável acompanha a situação da solicitação (enviada, em análise, aprovada, pendente de correção) sem precisar perguntar.

- Resolve: D3.

### 4.4 Painel da Direção

Um painel simples com o andamento da renovação: total de alunos, renovações confirmadas, pendentes, rejeitadas e quem ainda não respondeu.

- Resolve: D5.
- É o ganho mais visível para quem decide a implantação: pela primeira vez a Direção enxerga a escola em números.

### 4.5 Histórico e protocolo

Cada confirmação gera registro com data, hora, usuário e status, substituindo a assinatura em papel por um comprovante rastreável.

- Resolve: D4, D6.

### 4.6 Feito para conexão fraca

- interface leve, pensada primeiro para celular;
- acesso pelo navegador, sem instalar aplicativo;
- funcionamento aceitável em redes móveis lentas;
- evolução futura como PWA.

## 5. Impacto no escopo do MVP

O fluxo mínimo descrito na visão do MVP prevê que a Secretaria cadastre aluno e responsável antes de o responsável acessar o portal. Para uma escola sem nenhuma base digital, isso concentra todo o esforço de digitalização na Secretaria e repete a dor D1.

**Proposta:** permitir que o cadastro inicial seja feito pelo próprio responsável, a partir de um link gerado pela escola, com validação posterior da Secretaria. O cadastro feito pela Secretaria continua disponível.

Conforme a seção 14 da visão do MVP, esta alteração deve ser registrada em ADR, revisada pelo responsável arquitetural e refletida nos critérios de aceite antes de ser implementada.

## 6. Indicadores de sucesso (a validar com a escola)

- percentual de renovações concluídas pelo portal;
- tempo médio entre o envio do link e a aprovação;
- redução de dados digitados pela Secretaria;
- redução de perguntas de status recebidas pelo WhatsApp;
- percentual de alunos com cadastro digital completo ao fim do primeiro ciclo.

## 7. Perguntas em aberto

1. Quantos alunos e famílias a escola atende hoje?
2. Qual o período de renovação e quanto tempo ele leva atualmente?
3. Os responsáveis acessam principalmente pelo celular? Com que qualidade de internet?
4. Quem na escola tomará a decisão de implantação e o que essa pessoa precisa ver no Demo?
5. Quais documentos em papel precisam continuar existindo por exigência legal?
