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

A tela **Matrículas** usa alunos e estrutura já cadastrados. Escolha aluno, período, turma e grupo/série para confirmar. A regra deste piloto aceita uma matrícula por aluno/período; turma é obrigatória. Não há controle de vagas, cancelamento, transferência ou renovação. O fluxo foi conferido no navegador do piloto em 2026-10-03.
