# ADR-002: Cadastro completado pelo responsável via link pessoal

- **Status:** Proposta para aprovação do arquiteto (implementada no MVP)
- **Data:** 2026-10-04
- **Relacionadas:** `docs/problema-e-proposta-de-valor.md`, `docs/visao-negocio-e-arquitetura-do-mvp.md` (seção 8), ADR-001

## Contexto

A Escola Alfa Reis opera em papel e WhatsApp. O fluxo original do MVP previa que a Secretaria cadastrasse aluno e responsável antes do acesso ao portal. Numa escola sem base digital, isso concentra toda a digitação na Secretaria e repete a dor atual (dor D1 do documento de proposta de valor).

Os responsáveis já usam o WhatsApp, mas têm conexão limitada e baixa familiaridade com sistemas. Exigir criação de conta com e-mail e senha reduziria a adesão.

## Decisão

1. **Cadastro mínimo pela escola.** A Secretaria registra apenas nome e nascimento do aluno, e nome e telefone de um responsável. Também pode importar uma lista colada de planilha.
2. **Link pessoal.** A escola gera um link por responsável e o envia pelo WhatsApp, por "click to chat" (`wa.me`). Não há integração com a API do WhatsApp, respeitando a regra do MVP de não ativar integrações reais.
3. **Segundo fator simples.** Como mensagens de WhatsApp podem ser encaminhadas, o acesso exige também a data de nascimento de um aluno vinculado. Após 5 erros o link é bloqueado.
4. **Proteção do token.** O banco guarda apenas o hash SHA-256 do token. Os links expiram (15 dias por padrão), e um novo link revoga os anteriores.
5. **Sessão separada.** O portal usa um JWT com audiência própria (`alfa:portal`) e validade curta (2 h), que nunca é aceito nas rotas da equipe.
6. **Proposta, não alteração direta.** O responsável envia dados propostos. A Secretaria vê só os campos alterados e, ao aprovar, o sistema grava os dados e cria a matrícula do novo ano.

## Consequências

- A Secretaria deixa de digitar a ficha completa e passa a conferir.
- No primeiro ciclo, a renovação também digitaliza a base da escola.
- A data de nascimento é um fator fraco se conhecida por terceiros. Evoluções previstas: código de uso único por SMS/WhatsApp quando houver integração aprovada, ou CPF do responsável.
- A identidade do responsável no portal depende do telefone cadastrado pela escola. A Secretaria deve conferir o número antes de enviar o link.
