# ADR-008 — Frequência, mensagens, documentos e comunicações no roteiro

Status: **PROPOSTA**, por pedido do responsável pelo projeto em 2026-10-06. Ainda não muda o roteiro: as entregas só ganham número quando esta proposta for aceita.

## Contexto

O responsável pediu que quatro módulos entrem no roteiro, nesta ordem:

1. **Frequência:** presença e falta dos alunos por turma e por dia.
2. **Mensagens:** envio de WhatsApp às famílias pela Z-API.
3. **Documentos e assinatura:** documentos do aluno e do contrato, com assinatura eletrônica pela TapSign.
4. **Comunicações:** comunicados da escola às famílias.

Hoje o roteiro termina o MVP 2 na entrega 13 (aceite) e deixa para depois "o restante do pedagógico, financeiro e produção" ([ADR-007](ADR-007-notas-e-avaliacoes-na-entrega-9.md)).

Três regras da [visão do produto](../visao-negocio-e-arquitetura-do-mvp.md) pesam sobre a posição:
- **Integrações reais não são ativadas no MVP inicial.** A Z-API e a TapSign são integrações reais.
- **Upload real de documentos só depois de armazenamento privado e controle de acesso prontos.**
- **Nenhum dado real antes dos critérios de produção e da aprovação formal da escola.** Mandar WhatsApp a uma família real é usar dado real.

## Proposta

**Os quatro módulos formam uma etapa nova, depois do aceite do MVP 2 (entrega 13) e antes do financeiro, na ordem pedida.** O nome sugerido é "MVP 3 — rotina escolar e famílias".

| Ordem | Módulo | Depende de | Pronto quando |
|---|---|---|---|
| 1 | Frequência | Turmas, matrículas e o perfil de professor (entrega 11) | Chamada por turma e dia, faltas por aluno, só inserção com correção como em notas, evento `falta_registrada` no canal interno |
| 2 | Mensagens (Z-API) | Servidor próprio com HTTPS, contrato com o fornecedor, consentimento das famílias, consumidor de `outbox_events` | Envio a partir dos eventos (`nota_lancada`, `falta_registrada`) e de modelos aprovados pela escola. Registro de entrega e falha, com nova tentativa. Saída com números de teste até a aprovação de produção |
| 3 | Documentos e assinatura (TapSign) | Armazenamento privado com controle de acesso, Mensagens para enviar o link de assinatura, contrato com o fornecedor | Documentos por aluno com versão, autor e retenção. Contrato enviado para assinatura, com o retorno do fornecedor registrado |
| 4 | Comunicações | Mensagens, perfis e a decisão 1 do roteiro (acesso do responsável) | Comunicado por escola, turma ou aluno, com destinatários, leitura registrada e envio por Mensagens |

**Por que nesta posição:**
- **Antes, dentro do MVP 2**, os quatro módulos atrasariam a renovação, que é o MVP original da visão. Também trariam integrações reais para dentro do MVP, contra a regra da visão.
- **A frequência vem depois dos perfis.** A chamada é diária e feita pelo professor, e lançar pela secretaria, como nas notas, não serve para o dia a dia.
- **Mensagens vem logo depois da frequência.** Ela é o canal dos módulos seguintes e o primeiro consumidor dos eventos que notas e frequência já gravam.
- **Mensagens e assinatura precisam de servidor próprio.** Os retornos dos fornecedores (webhooks) não funcionam pelo túnel temporário. Por isso a VPS ([`deploy/NO-AR.md`](../../deploy/NO-AR.md)) é pré-requisito.
- **Documentos vem antes de comunicações.** O link de assinatura é a primeira mensagem com prazo e resposta, e o comunicado reaproveita o envio e o registro de leitura.

**Alternativa, se a escola precisar da frequência antes:** a frequência pode entrar logo depois da entrega 11 (perfis), ainda no MVP 2, sem integrações. Os outros três continuam depois do aceite do MVP 2.

## O que fica para decidir ao aceitar

Cada item vira um ADR próprio antes da entrega correspondente:

1. **Fornecedor de WhatsApp.**
   - A confirmar: a Z-API conecta um número por QR code, fora da API oficial do WhatsApp Business.
   - Avaliar o risco de bloqueio do número e os termos de uso.
   - Comparar com a API oficial (Cloud API), direto ou por um provedor.
2. **Fornecedor de assinatura.**
   - Confirmar o nome: a ZapSign é uma plataforma brasileira conhecida de assinatura eletrônica.
   - Confirmar o tipo de assinatura aceito para o contrato da escola.
3. **LGPD com fornecedores:** contrato de operador de dados, quais dados saem para cada fornecedor e por quanto tempo ficam lá.
4. **Consentimento e descadastro:** como a família aceita receber mensagens e como deixa de receber.
5. **Credenciais:** onde ficam os tokens dos fornecedores e se cada escola tem a sua conta ou a plataforma tem uma só.
6. **Armazenamento de documentos:** no banco, como as fotos do site, ou em armazenamento de objetos privado; retenção e exclusão.
7. **Frequência:** chamada por dia ou por aula; limite de faltas e alerta; justificativa de falta.
8. **Consumidor do canal interno:** um processo separado da API, com papel próprio no banco, que lê `outbox_events` de todas as escolas sem quebrar o isolamento das telas.

## Consequências

- Ao aceitar, o roteiro ganha a etapa nova com as entregas numeradas depois do aceite do MVP 2, e o financeiro passa para depois dela.
- Enquanto for proposta, nada muda nas entregas 9 a 13.
- O próximo ADR livre passa a ser o 009.
