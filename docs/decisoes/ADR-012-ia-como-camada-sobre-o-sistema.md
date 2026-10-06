# ADR-012 — IA como camada sobre o sistema

Status: **PROPOSTA**, a pedido do responsável pelo projeto em 2026-10-06, para levar à reunião. Depende da decisão dele.

## Contexto

O responsável quer levar à reunião o que de novo dá para fazer com IA nas escolas. Ele recebeu um plano de produto com IA em cinco frentes:
- chamada por voz do professor;
- boletim narrativo;
- alerta preditivo de evasão;
- agente de WhatsApp que conversa com as famílias;
- implantação em 4 horas.

O plano também trocava a base do sistema por Fastify, Prisma, Next.js, Redis, Fly.io, R2 e Twilio.

**Diretrizes do CNE:** o Conselho Nacional de Educação aprovou, em 1º de setembro de 2026, as diretrizes para o uso de IA na educação.
- O texto aguarda homologação do MEC. Depois dela, as escolas têm 12 meses para se adaptar.
- **Proibido:**
  - vigilância emocional;
  - pontuação social;
  - perfil psicológico para fins disciplinares;
  - decisão só automática sobre aprovação, retenção ou desligamento;
  - IA corrigindo ou dando nota a redação e a questão dissertativa.
- **Alto risco, com supervisão contínua:** correção automatizada de avaliações, monitoramento biométrico e seleção para benefícios.
- **Baixo risco:** apoio, como organização de materiais e acessibilidade.
- A decisão pedagógica fica com o professor.
- Esses pontos vêm das notícias sobre a aprovação, porque o texto oficial ainda não foi consultado. O número citado no plano, "Parecer CNE/CEB 2/2026", não foi confirmado.

**O sistema atual já tem o que uma camada de IA precisa:**
- isolamento por escola forçado no banco ([ADR-001](ADR-001-isolamento-multi-escola.md));
- histórico só de inserção, com autor e horário;
- a proposta de um assistente que só lê, com as permissões de quem pergunta ([ADR-011](ADR-011-diario-da-turma-e-assistente.md)).

## Proposta

### 1. A base do sistema continua

**A IA entra como camada sobre o sistema atual.** Ela não é motivo para trocar a base. O modelo de banco do plano é mais fraco que o atual:

| No plano | Problema | No sistema atual |
|---|---|---|
| Isolamento entre escolas sem `FORCE` | O dono da tabela passa por cima da regra. Com Prisma, é comum a aplicação conectar como dona | RLS `ENABLE` e `FORCE` em todas as tabelas, conferido quando a API sobe |
| Responsáveis numa lista dentro do aluno (`guardian_ids`) | O vínculo não tem parentesco, responsável legal nem registro de quem o criou | Tabela própria de vínculo, com parentesco, responsável legal e registro do autor |
| Campo `updated_at` alterado a cada mudança | O registro é alterado por cima e o histórico se perde | A aplicação só pode ler e inserir. Uma correção é um registro novo, com motivo |
| Turma direto no aluno (`class_id`) | Perde as matrículas dos anos anteriores | Uma matrícula por aluno em cada ano letivo |

O plano também contraria decisões já aceitas:
- **Fila com Redis:** o [ADR-008](ADR-008-frequencia-mensagens-documentos-comunicacoes.md) decidiu por um processo interno, sem fila externa.
- **Twilio:** o ADR-008 decidiu pela Z-API.
- **Nota na Educação Infantil:** a LDB, art. 31, não prevê nota nessa etapa.
- **Roteiro único:** o plano não segue o [ADR-003](ADR-003-linha-oficial-e-roteiro-unico.md).

### 2. Regras para qualquer função de IA

1. **A IA sugere, a pessoa decide.**
   - Nada do que a IA produz é gravado sem uma pessoa conferir e confirmar.
   - O registro guarda quem confirmou e marca que o texto partiu de uma sugestão da IA.
2. **Só leitura, com as permissões de quem pediu.**
   - A IA consulta o sistema pelas ferramentas da API, com o login de quem pediu, nunca direto no banco.
   - Ela nunca grava, altera ou envia nada sozinha ([ADR-011](ADR-011-diario-da-turma-e-assistente.md)).
3. **Tudo fica registrado.** Ficam no histórico, só com inserção:
   - o pedido;
   - as consultas feitas;
   - o rascunho da IA;
   - a versão aprovada.
4. **O mínimo de dados de criança (LGPD, art. 14).**
   - O áudio não é guardado; fica só o texto confirmado.
   - O modelo recebe só os dados de que a tarefa precisa.
5. **O modelo pode ser trocado.**
   - Ele pode rodar num computador da empresa, com Ollama, ou num fornecedor.
   - Um fornecedor entra no checklist de DPA do [ADR-008](ADR-008-frequencia-mensagens-documentos-comunicacoes.md).
   - Se o fornecedor estiver no exterior, valem também as regras de transferência internacional da LGPD.
6. **O que a IA nunca faz:**
   - ler emoção pela voz, pelo rosto ou pelo texto;
   - dar nota de risco a um aluno;
   - reconhecer rosto ou usar outra biometria;
   - dar nota ou conceito;
   - decidir aprovação ou retenção;
   - cruzar dados pedagógicos com inadimplência.

### 3. O que entra e quando

| Ideia | Onde entra |
|---|---|
| Chamada por voz e ocorrência ditada | Como opção no Diário da turma (entrega 13), se o ADR-011 for aceito. Marcar pelo toque na tela continua sendo o caminho principal |
| Alertas por regra, no lugar da previsão de evasão | Na entrega 13, junto com a frequência. O alerta abaixo de 75% já está decidido no ADR-008. Não é IA |
| Plano de aula com a BNCC | Depois do aceite do MVP 2, na ordem que o responsável escolher, cada ideia numa entrega própria |
| Material adaptado para alunos com deficiência | Depois do aceite do MVP 2, na mesma regra |
| Assistente de busca | Depois do aceite do MVP 2, na mesma regra |
| Atendimento no site para famílias interessadas | Depois do aceite do MVP 2, na mesma regra |
| Relatório descritivo da Educação Infantil | Depois do aceite do MVP 2, na mesma regra. Depende também da decisão pendente de deixar a Educação Infantil sem notas |
| Comunicado em linguagem simples | Depois do aceite do MVP 2. A IA só redige o texto. O envio pelo sistema vem com o módulo de Comunicados, no MVP 3 |
| Leitura de documentos da matrícula | Com o módulo de Documentos, no MVP 3 |
| Importação inteligente de planilha | Como melhoria da importação (entrega 7), quando chegar a segunda escola |

### 4. O que fica de fora

- **Previsão de evasão com aprendizado de máquina (XGBoost):**
  - uma escola tem poucos dados para um modelo confiável;
  - um percentual de risco calculado com dados sintéticos parece preciso sem ser;
  - montar um perfil do aluno esbarra no CNE e na LGPD.
- **Agente de WhatsApp que responde dados do aluno:**
  - o número de telefone não prova quem está do outro lado;
  - a conexão da Z-API foi aceita só para avisos ([ADR-008](ADR-008-frequencia-mensagens-documentos-comunicacoes.md));
  - reavaliar depois do módulo de Mensagens, com verificação de identidade.
- **Troca da base do sistema:** ver a seção 1.
- **Afirmar "100% de conformidade" com o CNE** antes da homologação do texto.

### 5. Para a reunião

A apresentação usa duas coisas, as duas com dados fictícios:
- o documento "IA na escola: possibilidades", com as ideias, as regras e um quadro de valor e esforço;
- o protótipo clicável das telas ([ADR-010](ADR-010-telas-organizadas-por-tarefa.md)).

Nada de IA é programado antes do aceite deste ADR.

## O que o responsável decide

1. Aceita as regras da seção 2 para toda função de IA?
2. A chamada por voz e a ocorrência ditada entram como opção no Diário da turma (entrega 13)?
3. Quais ideias vêm primeiro depois do MVP 2? A sugestão é começar pelas que não usam dado de aluno: plano de aula com a BNCC, material adaptado e comunicado em linguagem simples.

## Consequências, se aceito

- **Roteiro:**
  - a entrega 13 ganha a voz como opção;
  - as ideias escolhidas entram no roteiro depois do aceite do MVP 2, na ordem decidida.
- **Antes da primeira função de IA com dados reais:**
  - o DPA com o fornecedor do modelo;
  - o teste entre modelo local e fornecedor, previsto no [ADR-011](ADR-011-diario-da-turma-e-assistente.md).
- **Revisão:** este ADR é revisto quando o MEC homologar o texto do CNE.
- **Numeração:** o próximo ADR livre passa a ser o 013.
