# Reunião no ar a partir do seu computador

Guia da entrega 8 do [roteiro](../docs/ROTEIRO.md) enquanto não há servidor. O sistema roda no piloto do seu computador (Pop!_OS) e fica acessível pela internet por um **túnel gratuito da Cloudflare**, com HTTPS e sem conta ou domínio. Quando houver uma VPS, o caminho é o [`NO-AR.md`](NO-AR.md).

**Só dados fictícios.** A planilha real de uma escola só entra depois dos critérios de produção ([ADR-005](../docs/decisoes/ADR-005-importacao-de-planilha.md)).

## Como funciona

- O sistema roda no Docker do seu computador, como já roda hoje em `http://127.0.0.1:8088`.
- O script do túnel gera um endereço do tipo `https://palavras-aleatorias.trycloudflare.com`. Quem tiver o endereço acessa o sistema, de qualquer lugar.
- O sistema só fica acessível enquanto:
  - o terminal do túnel estiver aberto;
  - o computador estiver ligado, conectado à internet e sem suspender.
- **O endereço muda cada vez que o túnel é aberto.** Abra uma vez, antes da reunião, e não feche até o fim.

## Na véspera: atualizar e ensaiar

Faça no terminal, na pasta do projeto.

### 1. Computador

- Deixe o computador na tomada.
- Em **Configurações → Energia**, desligue a suspensão automática enquanto estiver na tomada. O script do túnel também tenta impedir a suspensão.
- Confira se o Docker está rodando: `docker ps` deve listar sem erro.

### 2. Baixar a versão nova

```bash
cd ~/alfa-gestao-escolar
git checkout main
git pull
```

### 3. Teste completo (recomendado)

```bash
cd ~/alfa-gestao-escolar/frontend && npm ci
cd ~/alfa-gestao-escolar/backend && npm ci
GATE_BROWSER=1 npm run test:gate
```

- Cria um banco temporário, roda todos os testes e apaga o que criou. Não mexe no piloto.
- Se reclamar que não achou o Chrome, rode sem o `GATE_BROWSER=1`.
- Se falhar, envie a saída para o Claude.

### 4. Atualizar o piloto

```bash
cd ~/alfa-gestao-escolar
bash deploy/piloto/atualizar.sh
```

- Faz backup do banco em `deploy/backups/` e aplica as mudanças sem apagar os cadastros.
- A primeira vez leva alguns minutos.
- Deve terminar com **PRONTO: piloto atualizado em http://127.0.0.1:8088**.

### 5. Escola da reunião

A escola que você já usa no piloto tem os cadastros dos testes anteriores. Para a reunião, crie uma escola nova e limpa:

```bash
bash deploy/servidor/criar-escola-demo.sh --piloto "Escola Alfa Reis — Demonstração" demo@alfa.test
```

- O e-mail é só o login e pode ser fictício.
- O script pede uma senha de demonstração, com 12 caracteres ou mais.
- Já prepara a escola:
  - o período 2027;
  - as séries Infantil 4 e 5;
  - as turmas `T1` e `T2`, as mesmas da [planilha de exemplo](../docs/exemplos/planilha-alunos-ficticia.xlsx);
  - o site da escola publicado;
  - horários de visita nos próximos dias úteis.

### 6. Contas dos participantes

Escolha um dos jeitos:

- **Uma conta compartilhada:** todos entram com o login do passo 5.
- **Uma escola por participante:** rode o mesmo comando uma vez para cada pessoa, trocando o nome e o e-mail:

  ```bash
  bash deploy/servidor/criar-escola-demo.sh --piloto "Escola Demonstração Ana" ana@exemplo.test
  ```

  Cada participante vê só a própria escola. Isso mostra na prática que os dados de uma escola não aparecem para outra.

### 7. Ensaio pela internet

```bash
bash deploy/piloto/tunel.sh
```

- Na primeira vez, instala o `cloudflared` e pede a senha do computador.
- Em menos de um minuto aparece **ENDEREÇO DA REUNIÃO: https://….trycloudflare.com**.
- Abra esse endereço no celular, **com o Wi-Fi desligado**, para ter certeza de que funciona de fora.
- Siga o [passo a passo de demonstração do MVP 1](../docs/MVP-1.md#passo-a-passo-de-demonstração) usando esse endereço, inclusive a importação da planilha de exemplo.
- No fim do ensaio, aperte **Ctrl+C** no terminal do túnel.

## No dia da reunião

1. **Uma hora antes:** com o computador na tomada e na internet, rode `bash deploy/piloto/tunel.sh`.
2. Abra o endereço mostrado no celular e entre no sistema, para conferir.
3. Envie o endereço aos participantes, junto com o login de cada um. O acesso dura 1 hora; peça que entrem no começo da reunião, não antes.
4. **Use esse mesmo endereço também no seu computador**, e não `127.0.0.1:8088`. Os links da matrícula online e do site da escola saem com o endereço aberto no navegador; abertos em `127.0.0.1`, eles não funcionam para os outros.
5. Não feche o terminal nem a tampa do notebook durante a reunião.
6. Depois da reunião, aperte **Ctrl+C**. O sistema deixa de estar acessível pela internet e continua no seu computador.

## Plano B

- Se a internet cair, apresente pelo próprio computador em `http://127.0.0.1:8088`. Tudo funciona, só não fica acessível para os outros.
- Tenha capturas de tela de cada passo do ensaio.

## Se algo der errado

| Mensagem ou sintoma | O que fazer |
|---|---|
| "não encontrei deploy/.env.piloto" | Rode os scripts dentro da pasta do piloto (`~/alfa-gestao-escolar`). |
| "o Docker não está rodando" | Rode `sudo systemctl start docker` e tente de novo. |
| "o piloto não responde" | Rode `bash deploy/piloto/atualizar.sh` antes do túnel. |
| "o cloudflared parou" ou "o túnel não informou o endereço" | Confira a internet e rode `bash deploy/piloto/tunel.sh` de novo. O endereço novo será outro. |
| Voltou para a tela de login, com "sessão expirada" | O acesso dura 1 hora. Entre de novo; o que já foi gravado continua lá. |
| O endereço abre no celular, mas não no seu computador | O computador guardou uma consulta antiga do endereço. Rode `resolvectl flush-caches` e recarregue a página. |
| O endereço parou de abrir | O túnel caiu, ou o computador suspendeu. Rode o túnel de novo e envie o endereço novo. |
| "Muitas tentativas", "Muitos envios" ou "O link foi bloqueado" | Com muita gente no mesmo Wi-Fi, o sistema limita as entradas e os envios por minuto. Espere um minuto e tente de novo. Se o link da família continuar bloqueado, foram cinco datas erradas: na ficha, use **Corrigir data de nascimento** ou gere um link novo. |
| Ver o estado dos serviços | `docker compose --env-file deploy/.env.piloto -p alfa-piloto-local -f deploy/compose.yml -f deploy/compose.piloto.yml ps` |
| Ver os erros da API | O mesmo comando, trocando `ps` por `logs --tail 50 api` |

Envie a saída para o Claude, **nunca** o conteúdo de `deploy/.env.piloto` nem de `.env.piloto-acesso`, que têm as senhas.

## Segurança

- Com o túnel aberto, qualquer pessoa com o endereço chega à tela de login. Só envie o endereço aos participantes e feche o túnel ao terminar.
- As senhas dos participantes devem ser de demonstração, nunca senhas que eles usam em outros lugares.
- O túnel passa pela Cloudflare. Por isso, e por estar num computador pessoal, este caminho serve só para demonstração com dados fictícios.
