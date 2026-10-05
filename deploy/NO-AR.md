# Colocar o sistema no ar

Guia da entrega 8 do [roteiro](../docs/ROTEIRO.md): o Alfa Gestão Escolar num servidor, com HTTPS, para a reunião de 06/10 às 18h. A primeira vez leva de 40 a 60 minutos; a maior parte é a montagem automática das imagens.

**Ainda sem servidor?** Faça a reunião a partir do seu computador: [`NO-AR-COMPUTADOR.md`](NO-AR-COMPUTADOR.md).

**Só dados fictícios.** Este servidor é de demonstração. A planilha real de uma escola só entra depois dos critérios de produção ([ADR-005](../docs/decisoes/ADR-005-importacao-de-planilha.md)).

## 1. Contratar a VPS na Hostinger

1. No site da Hostinger, escolha **VPS** e um plano com **pelo menos 2 GB de memória**. Confira se há opção de pagamento mensal.
2. Depois da compra, no painel (**hPanel**), vá em **VPS** e faça a configuração inicial:

| Opção | Escolha |
|---|---|
| Localização | **Brasil** (São Paulo) |
| Sistema | **Sistema operacional simples → Ubuntu 24.04**. Não escolha modelos com painel ou aplicativo, como Docker, Coolify ou CloudPanel: eles ocupam as portas que o sistema usa. |
| Senha do root | Uma senha forte. Guarde só com você. |
| Nome | `alfa-gestao` |

3. Anote o **IP (IPv4)** da VPS, que aparece na página de visão geral da VPS.
4. Se você ativar o **Firewall** da VPS no hPanel, crie regras liberando as portas **22, 80 e 443 (TCP)**. Sem firewall no hPanel, não precisa fazer nada; o script já protege o servidor.

Em outra empresa, serve qualquer VPS com **Ubuntu 24.04**, acesso root e IPv4 público.

## 2. Domínio (pode ficar para depois)

- **Comprado na Hostinger** (o mais simples, porque o DNS fica no mesmo painel):
  1. No hPanel, vá em **Domínios → seu domínio → DNS / Nameservers**.
  2. Se já existir um registro **A** com nome `@`, **edite** esse registro para o **IP da VPS**. Não crie um segundo.
  3. Se existir um registro **AAAA** com nome `@`, **apague**. Ele aponta para a página de estacionamento e impede o certificado HTTPS.
- **Comprado no [Registro.br](https://registro.br)** (.com.br):
  1. Em **DNS**, use os servidores do próprio Registro.br.
  2. Em **Editar zona**, crie um registro **A** com o nome em branco e o valor igual ao IP da VPS.
- A propagação costuma levar minutos, mas pode levar algumas horas. O script confere o DNS antes de instalar e avisa se ainda não estiver certo.

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
- no hPanel, abra a VPS e use o **Terminal do navegador** (*Browser terminal*);
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
| Montagem das imagens interrompida | Confira se a VPS tem pelo menos 2 GB; o script já cria memória extra (swap). |
| "ainda não responde pela internet" | Veja `journalctl -u caddy --no-pager \| tail -40`. Se o **Firewall** da VPS estiver ativo no hPanel, libere as portas 80 e 443. |
| "tem registro AAAA (IPv6)" | Apague o registro AAAA do domínio no painel de DNS e rode o script de novo depois de alguns minutos. |
| Ver o estado dos serviços | `docker compose --env-file deploy/.env -f deploy/compose.yml ps` |
| Ver os erros da API | `docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 50 api` |

Envie a saída para o Claude, **nunca** o conteúdo de `deploy/.env`, que tem as senhas.

## Segurança

- `deploy/.env` guarda as senhas do banco e do sistema, com acesso só do root. Não copie nem envie.
- Revogue a chave do GitHub quando não precisar mais dela.
- O servidor fica no Brasil. Mesmo assim, antes de dados reais, cumprir os critérios de produção e revisar a LGPD.
