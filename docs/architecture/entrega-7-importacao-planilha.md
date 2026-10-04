# Entrega 7 — importação de planilha de alunos e responsáveis

Status: implementação concluída; suíte completa aprovada em PostgreSQL 16 isolado, sem Docker, em 2026-10-04 (ver "Validação"). Gate oficial com Docker e smoke de deploy ainda não executados.

## Por que esta entrega

Toda escola já tem a lista dos alunos numa planilha. Para começar a usar o sistema, ela não pode redigitar essa lista. Na reunião de 06/10, a escola deve poder arrastar a planilha dela e ver o sistema organizar alunos, responsáveis, vínculos e turmas ([ADR-005](../decisoes/ADR-005-importacao-de-planilha.md)).

## Como funciona

Em **Alunos e responsáveis**, aba **Importar planilha**:

1. **Escolher a planilha.** A secretaria arrasta o arquivo, escolhe pelo botão ou cola as linhas copiadas do Excel ou do Google Planilhas.
   - Aceita Excel (.xlsx) ou CSV, com a primeira linha de títulos.
   - A tela oferece um modelo para baixar.
   - O arquivo é lido no navegador e não é enviado nem guardado.
2. **Que coluna é o quê.** O sistema sugere pelos títulos ("Aluno", "Data Nasc.", "Mãe", "Celular", "Turma"…), e a secretaria ajusta.
   - Obrigatórios: nome e data de nascimento do aluno.
   - Opcionais: CPF do aluno, nome, telefone, e-mail e CPF do responsável, parentesco, turma e série.
   - Com turma, é preciso escolher o período letivo.
3. **Conferir.** A prévia mostra cada linha como **Novo**, **Já cadastrado** ou **Erro**, com o que vai acontecer ou o motivo do erro.
4. **Importar.** Grava tudo ou nada. Se houver erros, a secretaria corrige a planilha e envia de novo, ou importa só as linhas sem erro.

## Regras

- **Aluno:** mesmo CPF é o mesmo aluno; sem CPF divergente, mesmo nome e data de nascimento também. Por isso, reimportar a planilha não duplica.
- **Uma linha por responsável:** a mãe numa linha e o pai em outra, para o mesmo aluno, ligam os dois ao aluno.
- **Responsável:** a regra é a da matrícula online, agora em `backend/src/modules/people/identity.js`:
  - mesmo CPF é a mesma pessoa;
  - sem CPF divergente, mesmo nome e telefone também, ignorando acentos, maiúsculas e o código do país;
  - outro nome no mesmo telefone é outra pessoa.
  - O responsável precisa de telefone ou CPF.
- **Vínculo:** é criado com o parentesco da planilha, ou "Responsável" se não houver.
  - A secretaria marca se os responsáveis da planilha são responsáveis legais.
  - O papel de responsável financeiro fica como não informado.
- **Turma:** procurada pelo código no período escolhido, sem diferenciar maiúsculas e acentos.
  - Turma com uma série dispensa a coluna de série.
  - Turma multisseriada exige a série, pelo código ou pelo nome.
  - Aluno já matriculado no período não ganha outra matrícula.
- **Limites:** até 500 linhas por importação, e uma importação por vez em cada escola.
- **Datas:** dd/mm/aaaa, datas do Excel e aaaa-mm-dd. Uma data inválida aparece como erro na linha.
- **CPF:** o CPF que o Excel guardou como número tem o zero à esquerda recuperado.

## API e banco

| Rota | O que faz |
|---|---|
| `POST /api/people/imports/preview` | Executa a importação completa e desfaz a transação. Devolve a situação de cada linha e o resumo. Não grava nada. |
| `POST /api/people/imports` | Grava tudo ou nada, com a chave de reenvio (`Idempotency-Key`). Com qualquer erro, devolve 400 e o motivo de cada linha. |

Migration `012_people_imports.js`:
- cria `people_imports`, com escola, autor, chave de reenvio e resultado;
- o resultado guarda linhas, situações e ids criados, sem nomes, datas ou contatos;
- a tabela tem RLS ENABLE/FORCE, e o runtime só faz SELECT/INSERT nela;
- a API recusa iniciar sem RLS na tabela.

A leitura de .xlsx usa `read-excel-file` (MIT), carregada só quando a importação é usada.

## Fora deste recorte

Fica de fora:
- a planilha real de uma escola, antes dos critérios de produção;
- atualizar cadastros existentes pela planilha;
- importar várias abas ou arquivos .xls antigos (salve como .xlsx);
- importar profissionais ou turmas;
- desfazer uma importação.

## Validação executada em 2026-10-04

PostgreSQL 16 isolado, sem Docker, banco recriado do zero.

- **Backend:** 139 testes aprovados, sendo 7 novos em `backend/tests/people/import.test.js`. Cobrem:
  - prévia sem gravar;
  - importação com irmãos, pai em outra linha e turmas;
  - reimportação sem duplicar;
  - reenvio idempotente;
  - erros por linha sem gravar nada;
  - reaproveitamento de responsável já cadastrado;
  - isolamento entre escolas, perfis e limites;
  - RLS e ausência de UPDATE/DELETE.
- **Frontend:** 27 testes, sendo 4 novos do leitor de planilha: CSV, colagem, aspas, datas, títulos e CPF numérico.
- **Navegador:** 8 specs aprovados. O novo `frontend/e2e/import.spec.js`:
  - envia a planilha fictícia de exemplo em Excel e confere a prévia;
  - importa um CSV com dois irmãos e uma linha com erro, deixando a linha com erro de fora;
  - confere alunos, responsável e matrículas nas telas.

`deploy/smoke.py` foi atualizado com as novas contagens.
