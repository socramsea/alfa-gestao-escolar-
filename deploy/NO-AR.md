# Colocar o sistema no ar

Guia da entrega 8 do [roteiro](../docs/ROTEIRO.md): o Alfa Gestão Escolar num servidor, com HTTPS, para a reunião de 06/10 às 18h. A primeira vez leva de 40 a 60 minutos; a maior parte é a montagem automática das imagens.

**Só dados fictícios.** Este servidor é de demonstração. A planilha real de uma escola só entra depois dos critérios de produção ([ADR-005](../docs/decisoes/ADR-005-importacao-de-planilha.md)).

## 1. Criar o servidor na DigitalOcean

No painel, clique em **Create → Droplets** e escolha:

| Opção | Escolha |
|---|---|
| Região | **New York** (a DigitalOcean não tem datacenter no Brasil) |
| Imagem | **Ubuntu 24.04 (LTS) x64** |
| Plano | **Basic → Regular → 2 GB / 1 CPU** |
| Autenticação | Senha forte ou chave SSH |
| Nome | `alfa-gestao` |

Anote o **IP** do servidor, que aparece no painel depois de criado.

## 2. Domínio (pode ficar para depois)

- **.com.br:** compre no [Registro.br](https://registro.br).
  1. Em **DNS**, use os servidores do próprio Registro.br.
  2. Em **Editar zona**, crie um registro do tipo **A**, com o nome em branco (o próprio domínio) e o valor igual ao **IP do servidor**.
- **Outra empresa:** crie um registro **A** do domínio (`@`) apontando para o IP do servidor.
- A propagação costuma levar minutos, mas pode levar algumas horas.

**Sem domínio pronto, siga mesmo assim.** O script usa um endereço gratuito com HTTPS formado pelo IP, por exemplo `164-90-1-2.sslip.io`. Quando o domínio ficar pronto, basta rodar o script de novo informando o domínio.

## 3. Chave de leitura do GitHub

O repositório é privado. Crie uma chave só de leitura:

1. No GitHub, clique na sua foto e vá em **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Preencha:
   - **Nome:** `servidor alfa`.
   - **Expiração:** 30 dias.
   - **Repository access:** *Only select repositories* → `socramsea/alfa-gestao-escolar-`.
   - **Permissions → Repository permissions → Contents:** *Read-only*.
3. Copie a chave. Ela aparece uma vez só. **Não envie para ninguém, nem para o Claude.**

## 4. Entrar no servidor

Há dois jeitos:
- no painel da DigitalOcean, abra o Droplet e clique em **Access → Launch Droplet Console**;
- ou, no terminal do seu computador, rode `ssh root@IP_DO_SERVIDOR`.

## 5. Baixar o sistema e instalar

```bash
apt-get update && apt-get install -y git
git clone https://github.com/socramsea/alfa-gestao-escolar-.git /opt/alfa-gestao-escolar
```

Quando pedir **Username**, use o seu usuário do GitHub. Quando pedir **Password**, cole a chave do passo 3.

```bash
cd /opt/alfa-gestao-escolar
bash deploy/servidor/instalar.sh alfagestao.com.br
```

Sem domínio, rode só `bash deploy/servidor/instalar.sh`.

O script vai perguntar:
- o **nome da escola** (fictícia, por exemplo `Escola Alfa Reis — Demonstração`);
- o **e-mail** e a **senha** do administrador, com 12 caracteres ou mais;
- a **origem pública**: aperte **Enter** para aceitar a sugestão.

No fim deve aparecer **PRONTO: https://…**. Abra esse endereço e entre com o e-mail e a senha.

## 6. Preparar a escola para a demonstração

```bash
python3 deploy/servidor/dados-demo.py --email EMAIL_DO_ADMINISTRADOR
```

Cria:
- o período 2027;
- as séries Infantil 4 e 5;
- as turmas `T1` e `T2`, que são as da [planilha de exemplo](../docs/exemplos/planilha-alunos-ficticia.xlsx);
- o site da escola publicado em `/escola/...`;
- horários de visita nos próximos dias úteis.

Pode rodar de novo sem duplicar.

## 7. Contas dos participantes

Escolha um dos jeitos:

- **Uma conta compartilhada:** todos entram com o administrador do passo 5.
- **Uma escola por participante:** rode uma vez para cada pessoa:

  ```bash
  bash deploy/servidor/criar-escola-demo.sh "Escola Demonstração Ana" ana@exemplo.test
  ```

  - O e-mail é só o login e pode ser fictício.
  - O script pede a senha e já prepara a escola com os dados do passo 6.
  - Cada participante vê só a própria escola, o que mostra na prática que os dados de uma escola não aparecem para outra.

O login aceita 10 entradas por minuto, com folga para mais 10 de uma vez. Numa sala grande, quem passar disso tenta de novo depois de um minuto.

## 8. Ensaiar

Siga o [passo a passo de demonstração do MVP 1](../docs/MVP-1.md#passo-a-passo-de-demonstração), usando o endereço do servidor no lugar de `http://127.0.0.1:8088`. Inclua a importação da planilha de exemplo.

**Plano B para a reunião:** tenha o piloto local do seu computador atualizado ([`deploy/PILOTO-LOCAL.md`](PILOTO-LOCAL.md)) e capturas de tela de cada passo.

## 9. Atualizar depois de mudanças

```bash
cd /opt/alfa-gestao-escolar
git pull
bash deploy/servidor/instalar.sh alfagestao.com.br
```

Antes de atualizar, o script guarda um backup do banco em `/var/backups/alfa-gestao/`.

## Se algo der errado

| Mensagem ou sintoma | O que fazer |
|---|---|
| "o domínio … aponta para …" | O DNS ainda não propagou. Espere ou rode sem domínio. |
| Montagem das imagens interrompida | Confira se o Droplet tem 2 GB; o script já cria memória extra (swap). |
| "ainda não responde pela internet" | Veja `journalctl -u caddy --no-pager \| tail -40`. Se você criou um *Cloud Firewall* na DigitalOcean, libere as portas 80 e 443. |
| Ver o estado dos serviços | `docker compose --env-file deploy/.env -f deploy/compose.yml ps` |
| Ver os erros da API | `docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 50 api` |

Envie a saída para o Claude, **nunca** o conteúdo de `deploy/.env`, que tem as senhas.

## Segurança

- `deploy/.env` guarda as senhas do banco e do sistema, com acesso só do root. Não copie nem envie.
- Revogue a chave do GitHub quando não precisar mais dela.
- O servidor fica nos Estados Unidos. Antes de dados reais, revisar a LGPD e os critérios de produção.
