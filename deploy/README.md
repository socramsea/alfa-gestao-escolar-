# MVP de estrutura escolar — execução e deploy

O MVP implementa login e criação/consulta de etapas, períodos, grupos/séries,
turnos e turmas, com dados reais persistidos, isolamento por escola, auditoria
transacional e idempotência. Administradores operam somente sua própria escola.
Turmas podem associar um ou vários grupos/séries da mesma etapa.

O cadastro mínimo de alunos, responsáveis e vínculos está descrito em
[Entrega 2](../docs/architecture/entrega-2-pessoas-vinculos.md), acessível pela área
Alunos e responsáveis. Cadastro de responsável não cria conta de acesso.

Matrículas com turma obrigatória estão em [Entrega 3](../docs/architecture/entrega-3-matriculas.md). O cadastro de profissionais e a atribuição às turmas estão em
[Entrega 4](../docs/architecture/entrega-4-profissionais-atribuicoes.md); o cadastro de profissional também não cria conta de acesso.

Financeiro, pedagógico, renovação, portal familiar, edição/exclusão e
gestão comercial de módulos não estão implementados neste recorte. Não usar
esta versão para operar uma escola inteira. Use dados fictícios no piloto.

**Validação local atual:** estrutura e pessoas passaram no smoke com os controles exigidos, navegador, reinício e restauração. Evidências em [Entrega 2](../docs/architecture/entrega-2-pessoas-vinculos.md). O bloqueio histórico Docker/NNP não se reproduziu nesta execução. Preserve os controles e execute novamente o smoke no host de destino; o resultado local não certifica publicação remota.

## Requisitos

- Docker Engine e Compose v2 no computador/servidor.
- Para testes fora do Docker: Node 22.22 ou superior na linha 22, Python 3 e
  Chrome com sandbox funcional ou Chromium instalado pelo Playwright.
- A aplicação usa a porta de loopback 8080 por padrão. O banco deste pacote
  não publica porta e usa volume próprio, separado do Docker local em 5433.
- Para acesso remoto: domínio, proxy HTTPS e configuração de origem pública.
  Esses itens dependem do servidor de destino; não foram provisionados pela criação dos arquivos.

## Primeira execução

No terminal, na raiz do projeto:

```bash
python3 deploy/configure.py
```

Informe escola fictícia, e-mail de teste e senha. O script gera as credenciais
do banco e JWT, grava `deploy/.env` com permissão 0600 e não exibe senhas.
Não sobrescreve configuração existente. Não publique nem envie esse arquivo.

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml --profile setup build
```

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --wait postgres
```

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml --profile setup run --rm setup
```

O setup aplica migrations futuras, provisiona as duas roles restritas e cria
a escola/administrador iniciais. Reexecução preserva usuário e senha existentes;
não é um mecanismo de recuperação ou troca de senha. Usa credenciais administrativas
somente no container temporário, que é removido ao terminar.

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --wait api frontend
```

Abra **http://localhost:8080** e entre com o e-mail e a senha definidos no script.
Cadastre, nesta ordem: etapa → período → grupo/série → turno → turma.
Recarregue a página e confirme que a turma permanece. Nenhum indicador fictício
é apresentado como registro real na área de estrutura.

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml ps
```

API e banco devem estar saudáveis. `GET /api/ready` verifica comunicação com o banco;
`GET /api/health` indica apenas que o processo HTTP está respondendo.

## Implantação em servidor

Use os mesmos arquivos e lockfiles da versão testada. Gere a configuração no
servidor; defina `PUBLIC_ORIGIN=https://seu-dominio` em `deploy/.env` antes de subir
a API. As quatro senhas técnicas geradas usam hexadecimal, adequado às URLs.

Configure o proxy HTTPS do servidor para encaminhar a origem inteira a
`http://127.0.0.1:8080`. API e frontend usam a mesma origem e o Nginx do pacote
encaminha `/api/` internamente. Não exponha diretamente a porta da API ou do banco.
Sem HTTPS fora de localhost, recursos de segurança do navegador e proteção do
token/senha não estão garantidos. DNS, certificado e firewall precisam de verificação
no destino antes de acesso público.

O Nginx limita login por endereço observado: 10 requisições/minuto com rajada
de 10. Se houver proxy externo, ele pode representar todos os clientes como um
IP só. Configure IP real apenas para proxies explicitamente confiáveis ou aplique
a limitação por cliente no proxy externo; nunca confie livremente em X-Forwarded-For.

A API recebe somente credenciais `alfa_app`, `alfa_auth` e JWT; não recebe a senha
administrativa do banco. API e frontend rodam com filesystem somente leitura,
capabilities removidas e `no-new-privileges`. Não remover controles para corrigir
falhas de host: investigar e validar um host compatível.

O token fica em sessionStorage e expira em uma hora no pacote de deploy.
Logout apaga a cópia local, sem revogar individualmente um token já emitido.
Identidade e escola são revalidadas no backend a cada operação.

## Verificação reproduzível

Na raiz do projeto, depois de construir as imagens:

```bash
python3 deploy/smoke.py
```

O smoke cria projeto Compose com nome aleatório, PostgreSQL em tmpfs, porta
efêmera e credenciais fictícias. Verifica setup repetido, headers, ausência de
credenciais administrativas na API, fluxo no navegador, persistência após
reinício da API e backup/restauração em banco descartável. Ao terminar, remove
somente seu projeto temporário. Não modifica o banco oficial nem seus volumes.

O navegador usa `google-chrome` do host quando disponível. Alternativamente,
instale Chromium pelo Playwright no frontend ou informe `E2E_BROWSER_EXECUTABLE`.
Não desabilite o sandbox do navegador. Credenciais E2E passam pelo ambiente;
trace e vídeo ficam desligados para não capturar senhas.

O teste local alternativo `GATE_BROWSER=1 npm run test:gate` no backend usa
API/preview no host e PostgreSQL temporário. Ele valida a funcionalidade da
interface; não equivale à execução dos containers de produção.

No backend, execute `npm run test:gate` para reconstrução isolada e testes de
API/banco. No frontend, execute `npm test` e `npm run build`.
Os testes E2E são acionados pelo smoke com credenciais efêmeras, não com contas reais.

## Backup, atualização e recuperação

O teste automatizado de restauração usa dados fictícios; não substitui backup
do servidor, retenção definida, cópia externa protegida e restauração periódica.
Para criar um backup manual no servidor, em diretório protegido:

```bash
install -d -m 700 deploy/backups
```

```bash
umask 077
```

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml exec -T postgres pg_dump -U postgres -Fc alfa_gestao > deploy/backups/alfa.dump
```

Escolha um nome novo para cada backup; o redirecionamento substitui arquivo com
o mesmo nome. O dump contém dados e hashes e deve ter acesso restrito. O dump
do banco não inclui credenciais das roles do cluster; mantenha os segredos
necessários à recuperação em armazenamento separado e protegido.

Antes de atualizar, faça backup e valide a versão candidata em ambiente de
teste. A nova API exige migrations 004 a 011. No banco antigo, use janela de manutenção:
pare a API, aplique o setup da nova versão e só então inicie a API nova.
Rollback de migrations de segurança é bloqueado; falha de atualização exige
investigação ou restauração previamente testada. Não execute `down -v` em banco
persistente para solucionar problemas.

## Limites de operação

- Nenhuma publicação remota é feita automaticamente por estes arquivos.
- Não há painel global de criação de escolas, recuperação de senha ou revogação de sessão.
- Configuração do MVP é aditiva: sem alteração retroativa, exclusão ou desabilitação de etapas.
- A auditoria de estrutura está em `structure_events`, separada dos eventos históricos em `audit_logs`.
- O módulo de estrutura está fixo neste piloto; permissões comerciais para habilitar outros módulos continuam fora do recorte.
- Tags base são atualizáveis; registre os digests das imagens aprovadas no ambiente de produção e revalide rebuilds futuros.
