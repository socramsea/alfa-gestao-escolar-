# MVP 1 — matrícula sem papel da unidade nova

Status: **definido** em 2026-10-04 ([ADR-004](decisoes/ADR-004-mvp-em-duas-etapas.md); importação de planilha no [ADR-005](decisoes/ADR-005-importacao-de-planilha.md)). Aceite: **pendente**, na reunião de 06/10, com o sistema no ar.

## O que é

Uma família que ainda não conhece a escola chega pelo site e termina com a criança matriculada numa turma, sem papel. A secretaria só confere e aprova. Tudo com dados fictícios, no piloto da Escola Alfa Reis.

O caminho tem cinco partes, nesta ordem:

1. **A escola se organiza:** período letivo, série e turma.
2. **A família conhece a escola:** site, pré-matrícula e visita.
3. **A secretaria convida:** gera o link da matrícula e envia pelo WhatsApp.
4. **A família preenche:** confirma a data de nascimento e completa a ficha pelo celular.
5. **A secretaria aprova:** o sistema cria aluno, responsáveis, vínculos e matrícula na turma.

E a escola não começa do zero: **importa a planilha que já tem**, e o sistema organiza alunos, responsáveis, vínculos e turmas.

## O que fica de fora

Fica para o MVP 2 ou depois, conforme o [roteiro](ROTEIRO.md):

- renovação dos alunos atuais;
- perfil próprio da secretaria. No piloto, ela usa o acesso de administrador;
- editar ou cancelar registros já gravados. A exceção é a data de nascimento do convite, que pode ser corrigida;
- pedagógico, financeiro, documentos e envio automático de WhatsApp.

## Critérios de aceite

| # | Critério | Situação |
|---|---|---|
| 1 | Ambiente reproduzível e banco criado por migrations | Atendido |
| 2 | Login, e cada escola só vê os próprios dados | Atendido |
| 3 | A escola configura período, série e turma | Atendido |
| 4 | A escola publica o site com turmas, uniforme e horários de visita | Construído, falta validar no ar |
| 5 | A família envia a pré-matrícula pelo celular e recebe o protocolo | Construído, falta validar no ar |
| 6 | A secretaria acompanha o interessado e registra a visita | Construído, falta validar no ar |
| 7 | A secretaria gera o link da matrícula e o envia pelo WhatsApp | Construído, falta validar no ar |
| 8 | A família entra com a data de nascimento e completa a ficha pelo celular | Construído, falta validar no ar |
| 9 | A secretaria confere e pede correção ou aprova | Construído, falta validar no ar |
| 10 | A aprovação cria aluno, responsáveis, vínculos e matrícula, e a criança aparece em **Matrículas** | Construído, falta validar no ar |
| 11 | A secretaria importa a planilha da escola, confere a prévia, e o sistema cria alunos, responsáveis, vínculos e matrículas sem duplicar | Construído, falta validar no ar |
| 12 | Cada ação registra data, usuário e histórico | Atendido |
| 13 | Os testes automatizados passam, inclusive o teste completo com Docker | Parcial: falta o teste com Docker |
| 14 | Nenhum dado real é usado | Atendido até aqui |
| 15 | O sistema está no ar, com HTTPS, e os participantes entram com as próprias contas | Falta (entrega 8): na reunião, pelo túnel a partir do computador do responsável |
| 16 | O responsável pelo projeto percorre o caminho no ar e aprova | Falta |

## Antes do passo a passo

Ainda não há servidor. A reunião roda no piloto do computador do responsável, acessível pela internet por um túnel com HTTPS: siga [`deploy/NO-AR-COMPUTADOR.md`](../deploy/NO-AR-COMPUTADOR.md). Ele inclui, nesta ordem:

1. Atualizar a pasta do projeto com `git pull`.
2. Rodar o teste completo com Docker (`GATE_BROWSER=1 npm run test:gate`, em `backend/`). Ele usa um banco temporário e não mexe no piloto.
3. Atualizar o piloto com `bash deploy/piloto/atualizar.sh`. O script faz o backup antes e aplica as migrations 008 a 012 sem apagar os cadastros.
4. Criar a escola da reunião e as contas dos participantes.
5. Abrir o túnel com `bash deploy/piloto/tunel.sh`.

Quando houver servidor, o caminho é o [`deploy/NO-AR.md`](../deploy/NO-AR.md).

## Passo a passo de demonstração

- **Onde:** abra o endereço da reunião, mostrado por `bash deploy/piloto/tunel.sh` ([`deploy/NO-AR-COMPUTADOR.md`](../deploy/NO-AR-COMPUTADOR.md)), e entre com o acesso da escola da reunião. Use esse endereço também no seu computador: os links da matrícula e do site saem com o endereço aberto no navegador.
- **Dados:** use só dados fictícios.
- **Família:** faça a parte dela numa janela anônima ou no celular.
- **Registro:** marque cada passo que funcionou e anote tudo o que estranhar, mesmo que pareça pequeno.

### 1. A escola se organiza

- [ ] Em **Estrutura escolar**, confira se existe um período letivo, uma série e uma turma. Se não houver, cadastre: período `2027`, série `G4 · Infantil 4` e turma `T1` com essa série.

### 2. A família conhece a escola

- [ ] Em **Captação**, aba **Site da escola**:
  - confira o endereço do site. A escola criada para a reunião já vem com o endereço e o site publicado, por exemplo `escola-alfa-reis-demonstracao`. Se não houver, defina `escola-piloto`;
  - preencha ou ajuste o título, uma turma oferecida e uma peça de uniforme;
  - clique em **Salvar e publicar**.
- [ ] Na aba **Visitas**, confira os horários já abertos. Para abrir mais, deixe um dia da semana marcado, horário `09:00`, uma semana e uma família por horário, e clique em **Abrir horários**.
- [ ] **Como família**, abra o endereço da reunião seguido de `/escola/` e do endereço do site, por exemplo `…/escola/escola-alfa-reis-demonstracao`:
  - confira as turmas e o uniforme;
  - escolha **Agendar visita** e um horário;
  - preencha seu nome, o WhatsApp, o nome da criança e a **data de nascimento**;
  - marque a autorização e clique em **Enviar e agendar visita**.
- [ ] Anote o protocolo mostrado, no formato `PM-XXXXXX`.

### 3. A secretaria acompanha e convida

- [ ] Em **Captação**, aba **Interessados**, abra o protocolo. A situação deve ser **Visita agendada**.
- [ ] Clique em **Compareceu**. A situação passa a **Visitou**.
- [ ] Clique em **Iniciar matrícula online**. Se o site não recebeu a data de nascimento, o sistema pede.
- [ ] O sistema cria a ficha e já mostra a mensagem com o link. Clique em **Copiar mensagem** ou, com WhatsApp neste computador, em **Enviar pelo WhatsApp**. O link só aparece agora; gerar outro depois cancela este.

### 4. A família preenche

- [ ] **Como família**, abra o link da mensagem.
- [ ] Digite **uma data errada** e clique em **Entrar**. O acesso deve ser recusado.
- [ ] Digite a data certa e clique em **Entrar**.
- [ ] Complete a ficha:
  - o nome da criança;
  - um responsável com parentesco, telefone e CPF fictício válido, por exemplo `529.982.247-25`, marcado como responsável legal e financeiro;
  - o endereço.
- [ ] Marque a declaração e clique em **Enviar para a escola**. Deve aparecer **Recebemos a ficha!**.

### 5. A secretaria confere e aprova

- [ ] Em **Captação**, aba **Matrícula online**, filtre **Para analisar** e abra a ficha.
- [ ] Teste a correção: escreva uma mensagem e clique em **Pedir correção**.
- [ ] **Como família**, abra o link de novo. A mensagem deve aparecer. Reenvie a ficha.
- [ ] De volta à ficha, escolha a turma e a série e clique em **Aprovar e matricular**.
- [ ] Em **Matrículas**, confira se a criança aparece na turma.
- [ ] Em **Alunos e responsáveis**, confira o aluno, o responsável e o vínculo.
- [ ] Em **Captação**, aba **Interessados**, a situação do protocolo deve ser **Matriculado**.
- [ ] **Como família**, abra o link. Deve aparecer **Matrícula confirmada**.

### 6. A escola traz a lista que já tem

A planilha de exemplo, [`docs/exemplos/planilha-alunos-ficticia.xlsx`](exemplos/planilha-alunos-ficticia.xlsx), tem 12 linhas fictícias:
- irmãos com a mesma mãe;
- um pai em outra linha do mesmo aluno;
- alunos nas turmas `T1` e `T2`.

- [ ] Em **Estrutura escolar**, confira se o período tem a turma `T1`, com a série Infantil 4, e a turma `T2`, com a série Infantil 5. Cadastre o que faltar.
- [ ] Em **Alunos e responsáveis**, aba **Importar planilha**, arraste a planilha de exemplo para a área indicada.
- [ ] Confira se o sistema reconheceu as colunas. Escolha o período letivo e clique em **Conferir antes de importar**.
- [ ] Na prévia, confira:
  - o Pedro aparece como "mesmo aluno da linha 3";
  - a Carla aparece como "mesmo responsável da linha 2";
  - cada aluno tem a sua turma.
- [ ] Clique em **Importar 12 linha(s)**. Confira os alunos, os responsáveis e, em **Matrículas**, as turmas.
- [ ] Importe a mesma planilha de novo. A prévia deve mostrar tudo como **Já cadastrado**, sem duplicar nada.
- [ ] Na reunião, a escola pode montar uma planilha **com dados inventados**, no formato dela, e importar. Use o **Baixar modelo** da tela se quiser partir de um modelo. A planilha real da escola só entra depois dos critérios de produção.

### 7. Dois casos que já deram problema

- [ ] **Data errada no convite:**
  - crie uma ficha nova pela aba **Matrícula online**, com uma data de nascimento errada, e gere o link;
  - tente entrar com a data certa até bloquear;
  - na ficha, use **Corrigir data de nascimento**;
  - a família entra com a data certa pelo mesmo link.
- [ ] **Irmãos:**
  - matricule um segundo filho com o mesmo responsável, mesmo nome, telefone e CPF;
  - em **Alunos e responsáveis**, o responsável deve aparecer uma vez só, ligado aos dois alunos.

### 8. Aceite

- [ ] Recarregue a página, saia e entre de novo. Confira se tudo continua lá.
- [ ] Envie ao Claude o que estranhou. Cada problema vira uma correção antes do aceite.
- [ ] Com tudo funcionando, o responsável pelo projeto declara o MVP 1 aceito. Isso é registrado neste documento e no roteiro.
