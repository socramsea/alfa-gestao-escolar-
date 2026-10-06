# ADR-008 — Frequência, mensagens, documentos e comunicações no roteiro

Status: **ACEITO** pelo responsável pelo projeto em 2026-10-06. Proposto e aceito no mesmo dia, com as decisões abaixo.

## Contexto

O responsável pediu que quatro módulos entrem no roteiro, nesta ordem:

1. **Frequência:** presença e falta dos alunos por turma e por dia.
2. **Mensagens:** envio de WhatsApp às famílias pela Z-API.
3. **Documentos e assinatura:** documentos do aluno e do contrato, com assinatura eletrônica pela [ZapSign](https://zapsign.com.br).
4. **Comunicações:** comunicados da escola às famílias.

Três regras da [visão do produto](../visao-negocio-e-arquitetura-do-mvp.md) pesam sobre a posição:
- integrações reais não são ativadas no MVP inicial, e a Z-API e a ZapSign são integrações reais;
- upload real de documentos só depois de armazenamento privado e controle de acesso prontos;
- nenhum dado real antes dos critérios de produção e da aprovação formal da escola.

Os detalhes das duas integrações estão em [`docs/architecture/integracoes-zapi-zapsign.md`](../architecture/integracoes-zapi-zapsign.md).

## Decisão

### 1. Posição e ordem

A ordem é: frequência, mensagens, documentos e assinatura, comunicações.

| Módulo | Onde entra | Por quê |
|---|---|---|
| Frequência | **No MVP 2, como entrega 12**, logo depois dos perfis (entrega 11) | Não usa fornecedor externo. A chamada é diária e feita pelo professor, por isso depende da conta de professor |
| Mensagens (Z-API) | **Depois do aceite do MVP 2, no MVP 3** | Integração real. Precisa de servidor próprio com HTTPS |
| Documentos e assinatura (ZapSign) | Depois de Mensagens | Integração real. Precisa de armazenamento privado e do servidor próprio. O link de assinatura vai pela própria ZapSign, que envia por WhatsApp |
| Comunicações | Depois de Documentos | Usa o envio e o registro de Mensagens |

- **Por que a frequência é a entrega 12, e não 11.5:** números decimais ficam para correções da mesma entrega, como a 6.1. A correção de registros passa a ser a 13 e o aceite do MVP 2 a 14.
- **Os três módulos de depois do MVP 2 ainda não têm número.** Cada um ganha o seu ao entrar no roteiro, antes de começar.
- **O servidor próprio (VPS) é pré-requisito de Mensagens.** Os retornos dos fornecedores (webhooks) não funcionam pelo túnel temporário.

### 2. Fornecedor de assinatura: ZapSign

O fornecedor é a ZapSign, não a "TapSign" da versão anterior deste ADR.

- **Plano para o piloto:** 1 escola, cerca de 500 alunos e cerca de 20 matrículas por mês.
  - Plano Equipe: R$ 49,90 por mês, no pagamento anual, com 20 documentos por mês, API e envio por WhatsApp ilimitado.
  - Se passar de 20 documentos por mês, o plano de 80 documentos sai a R$ 99,90 por mês.
- **Recursos usados:**
  - API REST: criar o documento, enviar e acompanhar;
  - envio do link de assinatura por WhatsApp, incluído no plano Equipe (fora dele, R$ 0,50 por envio);
  - webhook de status;
  - assinatura na tela, com o dedo no celular, sem cadastro;
  - modelos e formulários.

Os valores foram informados pelo responsável em 2026-10-06 e devem ser conferidos no site na contratação.

### 3. Fornecedor de WhatsApp: Z-API, com risco aceito

**Risco aceito: conexão não oficial.** A Z-API conecta um número de WhatsApp por QR code, fora da API oficial do WhatsApp Business, e o número pode ser banido.

**Mitigação: uso transacional, limite diário e envio isolado para uma futura migração.**
- **Só notificação transacional:** nota, falta e documento. Nada de marketing em massa.
- **No máximo 5 mensagens por pessoa por dia.**
- **A família pode responder ao número:** a conversa vai nos dois sentidos, o que distingue o número de um disparador de spam.
- **Plano de troca:** se o número for banido, outro número entra em até 1 dia, reconectado na Z-API.
- **Migração futura para a API oficial da Meta:** troca só o despachante de mensagens, que fica isolado do resto do sistema.

### 4. Implantação

| Ponto | Decisão |
|---|---|
| LGPD com fornecedores | Cada fornecedor assina um contrato de tratamento de dados (DPA). A Z-API e a ZapSign têm o seu; a escola solicita e assina os dois antes do primeiro envio real |
| Consentimento da família | Checkbox na pré-matrícula e cláusula no contrato de matrícula: "A família autoriza receber comunicações educacionais por WhatsApp no número informado." O número é o informado na pré-matrícula. |
| Credenciais | Tokens dos fornecedores em variáveis de ambiente (`.env`) no servidor, nunca no código. Rotação semestral |
| Armazenamento de documentos | Disco do servidor, no volume Docker `/data/uploads/`. No futuro, MinIO ou S3. O armazenamento da Z-API não é o principal, porque os arquivos lá expiram em 30 dias |
| Frequência | O padrão é presente; o professor marca só a falta. A justificativa pode vir depois, em até 5 dias úteis. Frequência abaixo de 75% gera alerta para a coordenação |
| Processamento dos eventos | Um processo interno da aplicação (`setInterval` de 5 segundos) consulta os eventos pendentes da tabela de saída (`outbox_events`) e os processa. Sem fila externa (RabbitMQ, Redis) no MVP |

## Consequências

- O roteiro ganha a frequência como entrega 12 no MVP 2. A correção de registros passa a 13, e o aceite do MVP 2 a 14.
- Mensagens, documentos e comunicações formam o MVP 3, depois do aceite do MVP 2, nessa ordem. Ainda não têm número de entrega.
- **Pré-requisito da entrega de Documentos:** antes de implementar o upload, montar o volume `/data/uploads/` com permissão de escrita e incluí-lo no script de backup. Isso não bloqueia as entregas 9 a 14.
- **Responsabilidade da escola, no checklist do piloto:** a escola assina os DPAs da Z-API e da ZapSign antes da primeira mensagem real. O jurídico da escola confirma a validade da assinatura eletrônica para o contrato de matrícula.
- **Pré-requisitos antes da entrega de Mensagens:**
  - servidor próprio com domínio e HTTPS;
  - os dois DPAs assinados;
  - consentimento registrado.
  
  Até a aprovação de produção, os envios vão só para números de teste da equipe.
- **Pontos de desenho que ficam para as entregas, sem mudar estas decisões:**
  - **Envios em tabela própria:** como o sistema só insere, o resultado de cada envio vai para uma tabela nova, com tentativas e status, e `outbox_events` não é alterada.
  - **Leitura dos eventos de todas as escolas:** o processo que lê os eventos precisa de um papel no banco ou de uma função própria, sem quebrar o isolamento das telas.
  - **Um processo por vez:** uma trava no banco garante que só um processo trate os eventos.
  - **Limite de 5 por dia:** conferido por telefone antes de cada envio.
  - **Arquivos no disco:** a API hoje roda com sistema de arquivos só de leitura. O volume `/data/uploads/` precisa ser montado como gravável, fora da pasta servida pelo nginx. O backup passa a incluir esse volume, além do `pg_dump`.
  - **Webhooks:** autenticados por segredo do fornecedor.
  - **Respostas das famílias:** quem lê as respostas que chegam ao número fica para a entrega de Mensagens.
  - **Revogação do consentimento:** como a família deixa de receber fica para a entrega de Mensagens. A LGPD exige que a revogação seja possível.
- **A escola confirma com o jurídico** que a assinatura eletrônica na tela vale para o contrato de matrícula.
- O próximo ADR livre continua sendo o 009.
