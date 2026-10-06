# Integrações: Z-API (WhatsApp) e ZapSign (assinatura)

Decisões em [ADR-008](../decisoes/ADR-008-frequencia-mensagens-documentos-comunicacoes.md). Nenhuma das duas está implementada.

Elas entram no MVP 3, depois do aceite do MVP 2, na ordem: Mensagens, depois Documentos e assinatura. Até a aprovação de produção, os envios vão só para números de teste da equipe.

## Checklist do piloto: responsabilidade da escola

- [ ] A escola assina os DPAs da Z-API e da ZapSign antes da primeira mensagem real.
- [ ] O jurídico confirma a validade da assinatura eletrônica para o contrato de matrícula (Decreto 10.543/2020, MP 2.200-2/01).

## Pré-requisitos técnicos

- [ ] **Para Mensagens:** servidor próprio (VPS) com domínio e HTTPS: [`deploy/NO-AR.md`](../../deploy/NO-AR.md). Os webhooks não funcionam pelo túnel temporário.
- [ ] **Para Mensagens:** consentimento da família no checkbox da pré-matrícula e na cláusula do contrato de matrícula: "A família autoriza receber comunicações educacionais por WhatsApp no número informado." O número é o informado na pré-matrícula.
- [ ] **Para Documentos:** antes de implementar o upload, montar o volume `/data/uploads/` com permissão de escrita e incluí-lo no script de backup. Isso não bloqueia as entregas 9 a 14.

## Z-API: mensagens por WhatsApp

**Para que serve:** avisos transacionais à família (nota lançada, falta registrada e documento para assinar). Nunca marketing em massa.

**Como funciona:**

1. O fato acontece, por exemplo uma nota lançada, e grava um evento em `outbox_events` na mesma transação. Isso já existe para `nota_lancada`.
2. Um processo interno da aplicação consulta os eventos pendentes a cada 5 segundos, sem fila externa.
3. O despachante de mensagens monta o texto e envia pela Z-API.
   - Ele confere o consentimento da família e o limite de 5 mensagens por pessoa por dia antes de enviar.
4. O resultado de cada envio, com sucesso ou falha e as tentativas, é gravado numa tabela de envios. Como o sistema só insere, o evento original não é alterado.

**Regras:**

| Regra | Valor |
|---|---|
| Conteúdo | Só transacional: nota, falta e documento |
| Limite | 5 mensagens por pessoa por dia |
| Respostas | A família pode responder ao número. Quem lê as respostas fica para a entrega |
| Credenciais | Instância e tokens da Z-API em variáveis de ambiente no servidor (`.env`), nunca no código. Rotação semestral |
| Arquivos | O armazenamento da Z-API não guarda nada de forma principal: os arquivos lá expiram em 30 dias |

**Risco aceito:** a conexão não é oficial. A Z-API conecta o número por QR code, fora da API oficial do WhatsApp Business, e o número pode ser banido. As mitigações são:
- **Uso transacional e limite diário.**
- **Troca de número em até 1 dia:** se o número for banido, outro é conectado na Z-API.
- **Despachante isolado:** a migração para a API oficial da Meta troca só o despachante, sem mexer nos módulos que geram os eventos.

## ZapSign: documentos e assinatura

**Para que serve:** a família assina o contrato de matrícula e outros documentos pelo celular, sem cadastro. A escola guarda o documento assinado.

**Plano para o piloto:** 1 escola, cerca de 500 alunos e cerca de 20 matrículas por mês.

| Plano | Preço | Inclui |
|---|---|---|
| Equipe | R$ 49,90 por mês, no pagamento anual | 20 documentos por mês, API e envio por WhatsApp ilimitado. Suficiente para o piloto |
| 80 documentos | R$ 99,90 por mês | Se passar de 20 documentos por mês |
| Fora do plano Equipe | R$ 0,50 por envio | Envio do link por WhatsApp |

Os valores foram informados pelo responsável em 2026-10-06. Confira em [zapsign.com.br](https://zapsign.com.br) na contratação.

**Recursos usados:**
- API REST: criar o documento, enviar e acompanhar;
- modelos e formulários;
- envio do link de assinatura por WhatsApp pela própria ZapSign;
- assinatura na tela, com o dedo no celular, sem cadastro;
- webhook de status.

**Como funciona:**

1. A secretaria gera o documento a partir de um modelo, com os dados da matrícula.
2. A API da ZapSign cria o documento com os signatários, e a ZapSign envia o link por WhatsApp.
3. A família abre o link e assina na tela.
4. O webhook da ZapSign avisa o servidor da mudança de status. O servidor confere o segredo do webhook antes de aceitar.
5. O sistema baixa o PDF assinado, guarda no volume `/data/uploads/` e registra o documento no cadastro do aluno, com versão e autor.

**Armazenamento:**
- O volume `/data/uploads/` fica no disco do servidor, privado. Ele fica fora da pasta servida pelo nginx; os arquivos são acessados só pela API, com login e RLS.
- A API hoje roda com o sistema de arquivos só de leitura, então esse volume é montado como gravável à parte.
- O backup passa a incluir o volume, além do `pg_dump`.
- No futuro, o armazenamento pode ir para MinIO ou S3.
- O token da API ZapSign fica em variável de ambiente, com rotação semestral.
