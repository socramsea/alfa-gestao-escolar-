# Teste local do MVP de estrutura escolar

Endereço: http://127.0.0.1:8088 (neste computador).
Escola fictícia: Escola Piloto Local.
E-mail: admin@piloto.test.
Senha: consultar o arquivo local protegido `.env.piloto-acesso`. Não compartilhar esse arquivo.

Use somente dados fictícios. O projeto Compose `alfa-piloto-local` usa o volume próprio `alfa-piloto-local_mvpdata`. Não altera o banco existente em 5433. Os containers não iniciam automaticamente com o computador.

## Roteiro manual

1. Faça login.
2. Em Etapas, cadastre Infantil.
3. Em Períodos, cadastre 2027, de 2027-02-01 a 2027-12-20.
4. Em Grupos e séries, cadastre G1, nome Grupo 1, etapa Infantil.
5. Em Turnos, cadastre MANHA, nome Manhã.
6. Em Turmas, cadastre T1, etapa Infantil, período 2027, turno Manhã e Grupo 1.
7. Recarregue a página, volte a Turmas e confirme que T1 continua listada.
8. Saia e entre novamente; confirme a persistência dos cadastros.

Os cadastros de estrutura começam vazios em um piloto novo. O MVP não oferece edição/exclusão. Matrículas obrigam turma; financeiro e pedagógico estão fora deste piloto.

## Parar e retomar

No terminal, na raiz `/home/sea/alfa-gestao-escolar`:

```bash
docker compose --env-file deploy/.env.piloto -p alfa-piloto-local -f deploy/compose.yml -f deploy/compose.piloto.yml stop
```

Para retomar os mesmos dados:

```bash
docker compose --env-file deploy/.env.piloto -p alfa-piloto-local -f deploy/compose.yml -f deploy/compose.piloto.yml up -d --no-build --wait postgres api frontend
```

Não remover o volume se quiser preservar os cadastros de teste.

## Testar alunos, responsáveis e vínculos

1. Entre com o mesmo acesso e clique em **Alunos e responsáveis**.
2. Na aba **Alunos**, cadastre `Aluno Exemplo`, nascimento `15/03/2020`.
3. Na aba **Responsáveis**, cadastre `Responsável Exemplo`; telefone/e-mail podem ficar vazios.
4. Na aba **Vínculos**, selecione as duas pessoas, informe a relação e marque responsável legal somente se aplicável ao exemplo.
5. Salve, recarregue e volte a Vínculos para conferir a persistência.

Pessoas com nomes iguais são permitidas. Use nascimento/contato e a identificação mostrada para selecionar o registro correto. O vínculo não cria matrícula ou conta de portal. Novas tabelas inicialmente vazias; T1 e os cadastros anteriores foram preservados.

## Matrículas

A tela **Matrículas** usa alunos e estrutura já cadastrados. Escolha aluno, período, turma e grupo/série para confirmar. A regra deste piloto aceita uma matrícula por aluno/período; turma é obrigatória. Não há controle de vagas, cancelamento, transferência ou renovação. O fluxo foi executado no piloto por navegador automatizado em 2026-10-04 (aluno `Aluno Fictício Piloto`, matrícula em 2027/T1); o responsável confirmou na tela que a matrícula aparece na lista.

## Profissionais e atribuições

1. Clique em **Profissionais** no topo.
2. Na aba **Profissionais**, cadastre `Professora Exemplo`; telefone e e-mail podem ficar vazios.
3. Na aba **Atribuições**, selecione a profissional, a turma `T1 · 2027`, o papel e a data de início dentro do período letivo. A data de fim é opcional.
4. Salve e confira a linha na lista, com a situação `Em aberto`.
5. Em **Encerrar atribuição**, selecione a atribuição, informe o último dia e confirme; a situação passa a `Encerrada`.

O cadastro não cria conta de acesso. A mesma profissional não pode ter duas atribuições na mesma turma com datas que se cruzam. Não há edição nem exclusão; disciplinas e horários ficam para entregas posteriores. O fluxo foi executado no piloto por navegador automatizado em 2026-10-04 (`Professora Fictícia Piloto`, turma T1, encerrada em 30/06/2027); falta a conferência visual pelo responsável.

## Site da escola e captação

1. Clique em **Captação** no topo e abra a aba **Site da escola**.
2. Defina o endereço, por exemplo `escola-piloto`. Ele não pode ser alterado depois.
3. Preencha o título, uma peça de uniforme e uma turma. Clique em **Salvar e publicar**.
4. Na aba **Visitas**, deixe só um dia marcado, horário `09:00`, uma semana e uma família por horário. Clique em **Abrir horários**.
5. Abra `http://127.0.0.1:8088/escola/escola-piloto` no celular ou numa janela anônima. Preencha a pré-matrícula com dados fictícios, escolha o horário e envie. Anote o protocolo.
6. Volte à aba **Interessados**, abra o protocolo e clique em **Compareceu**. A situação passa a **Visitou**.
7. Recarregue a página e confira que tudo continua lá.

A pré-matrícula não cria aluno nem matrícula. Fotos são opcionais: sem foto, o site mostra uma ilustração.

## Matrícula online

1. Em **Captação**, abra a aba **Matrícula online** e clique em **Regras da escola**. Marque o que a escola exige, escreva um regulamento fictício e salve.
2. Clique em **Nova ficha**: criança fictícia, nascimento, responsável e WhatsApp. Depois clique em **Gerar link para a família** e copie a mensagem.
3. Abra o link no celular ou numa janela anônima. Confirme a data de nascimento, complete a ficha, aceite e envie.
4. Volte à aba **Matrícula online**, filtre **Para analisar**, abra a ficha, escolha turma e série/grupo e clique em **Aprovar e matricular**.
5. Confira em **Matrículas** que a criança aparece na turma. No link da família, a situação passa a "Matrícula confirmada".

Também é possível começar pelo interessado: no detalhe da Captação, use **Iniciar matrícula online**.
