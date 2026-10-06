# ADR-010 — Telas organizadas pelas tarefas da escola

Status: **ACEITO** pelo responsável pelo projeto em 2026-10-06, a partir das observações de professores e da secretaria sobre o piloto.

## Contexto

O sistema funciona, mas professores e secretaria disseram que ele não tem uma lógica clara. A revisão das telas mostrou a causa: **elas foram organizadas pelas tabelas do banco, e não pelas tarefas da escola.**

- **A primeira tela depois do login é a configuração da estrutura**, que se usa uma vez por ano.
- **Cadastrar uma criança com a mãe passa por três abas** (Alunos, Responsáveis e Vínculos) e depois por outro menu, o de Matrículas.
- **Não existe ficha do aluno nem ficha da turma.** Não há um lugar onde se veja tudo de um aluno ou de uma sala.
- **As telas mostram códigos internos** ("ID 4f8a…", coluna "Identificação") em 8 lugares.
- **As palavras são técnicas** ("Etapas", "Vínculos", "Captação", "Atribuições"). A mesma coisa tem nomes diferentes de uma tela para outra ("Série", "Grupo/série", "Grupos e séries").
- **A matrícula de um aluno novo está espalhada por quatro menus.**

Os professores pediram também que **cada sala exista no sistema como um espaço próprio**, separado por segmento (Sala A, Sala B, Sala 3…). Nesse espaço ficariam os alunos e tudo o que acontece com a turma.

## Decisão

1. **Os menus seguem as tarefas da escola:**

   | Menu | O que reúne |
   |---|---|
   | Início | O que fazer hoje: fichas para analisar, visitas do dia, turmas sem professor. Na primeira vez, um passo a passo de configuração |
   | Turmas | Cada sala é um espaço próprio, agrupado por segmento. A ficha da turma tem alunos, professores, avaliações e notas; frequência, ocorrências e plano de aula entram nela quando existirem ([ADR-011](ADR-011-diario-da-turma-e-assistente.md)) |
   | Alunos | Busca por nome. A ficha do aluno tem dados, responsáveis, turma, notas e histórico; ocorrências e documentos entram nela quando existirem |
   | Novas matrículas | O caminho inteiro numa tela: família interessada, visita, ficha online, aprovação |
   | Configurações | Estrutura escolar com passo a passo, professores e equipe, site da escola e importação de planilha |

2. **O cadastro de aluno e responsável é feito numa tela só.** O vínculo deixa de ser uma aba separada e fica dentro da ficha do aluno.
3. **Nenhum código interno aparece na tela.** Pessoas com o mesmo nome se distinguem pela data de nascimento, pela turma ou pelo contato.
4. **A linguagem é de escola, com uma palavra só para cada coisa:**

   | Antes | Depois |
   |---|---|
   | Etapa | Segmento |
   | Período letivo | Ano letivo |
   | Grupos e séries, Grupo/série | Série |
   | Vínculos | Responsáveis do aluno |
   | Captação | Novas matrículas |
   | Interessados | Famílias interessadas |
   | Profissionais | Professores e equipe |
   | Atribuições | Professores da turma |

5. **Há uma busca no topo de todas as telas**, por aluno, responsável e turma.
6. **Antes de programar, a nova organização é validada com professores e secretaria** num protótipo clicável, com dados fictícios.

## Consequências

- **Uma entrega nova:** a reorganização entra como **entrega 10**, antes da renovação. Assim a renovação já nasce no padrão novo. A renovação passa a 11, perfis a 12, frequência a 13, correção de registros a 14 e o aceite do MVP 2 a 15.
- **O banco e as regras não mudam.** O backend ganha só consultas de leitura: ficha do aluno, ficha da turma, busca e painel do Início.
- **Os testes de navegador serão reescritos para a navegação nova.** Eles dependem dos títulos e dos nomes dos campos.
- **O esqueleto da renovação** (branch `feat/mvp2-renovacao`) é renumerado para a entrega 11 quando for retomado.
- **O próximo ADR livre passa a ser o 012.**
