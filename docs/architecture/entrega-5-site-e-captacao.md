# Entrega 5 — site da escola, pré-matrícula e captação

Status: implementação do recorte concluída; suíte completa aprovada em PostgreSQL isolado sem Docker em 2026-10-04 (ver "Validação"); gate oficial com Docker, smoke de deploy e atualização do piloto local ainda não executados.

## Por que esta entrega

A escola vai abrir uma nova unidade e quer que ela já nasça sem papel: será a referência, e o que funcionar nela será levado à unidade atual. A unidade precisa captar alunos desde o início. O responsável pelo projeto descreveu em 2026-10-04:

- um site da escola onde os pais entendam como ela funciona, inclusive o uniforme, com fotos;
- um canal de pré-matrícula no próprio site, para marcar visita, conversar e, depois, matricular.

A [arquitetura](arquitetura-sistema-escolar.md) prevê o módulo "Comunicação e portal" com publicação de informações autorizadas. Esta entrega cria a parte pública desse módulo e a captação que vem antes da matrícula. A matrícula online pela família fica para a entrega seguinte.

## Decisões

Aprovadas pelo responsável em 2026-10-04: usar o `monolito-js` como base oficial e construir o site e a pré-matrícula como próxima entrega.

Propostas na implementação e aprovadas pelo responsável na mesclagem do [PR #1](https://github.com/socramsea/alfa-gestao-escolar-/pull/1), em 2026-10-04:

1. **Pré-matrícula não cria aluno.** O interessado fica em `admission_leads`, separado de `students` e `guardians`. Só vira aluno quando a matrícula for feita (entrega seguinte ou cadastro manual atual).
2. **Endereço público por código.** Cada escola escolhe uma vez um código (`/escola/<codigo>`), único na plataforma e imutável.
3. **Conteúdo versionado.** Cada salvamento do site cria uma versão nova com autor e data; a última versão vale. Publicar e despublicar também são versões. Nenhuma versão é apagada.
4. **Fotos públicas no banco.** JPG, PNG ou WebP de até 2 MB, conferidos pela assinatura do arquivo. Uma foto só é servida se a versão publicada a referencia. Documentos de alunos continuam proibidos aqui.
5. **Visita com vagas por horário.** A escola abre horários com limite de famílias. O site só mostra horários com vaga, de 2 horas a 45 dias à frente. A reserva respeita o limite mesmo com envios simultâneos.
6. **Situação do interessado derivada do histórico.** Novo, em contato, visita agendada, visitou, matriculado ou desistiu. Mudanças são registros novos; nada é sobrescrito.
7. **Só a administração opera a captação e o site**, com `school_admin` e `platform_admin`, como nas entregas anteriores. Nenhum perfil novo.

## Fronteira pública

O visitante do site não tem identidade nem escola no token. Para não abrir o runtime a consultas sem tenant, a parte pública passa somente por três funções do schema `site_public`, executadas por `alfa_app`:

| Função | O que faz |
|---|---|
| `site_public.site(slug)` | Devolve nome da escola, conteúdo da versão publicada e horários com vaga. Nada se o site não estiver publicado ou a escola não permitir acesso. |
| `site_public.image(slug, id)` | Devolve a foto apenas se a versão publicada a referencia. |
| `site_public.submit_lead(slug, chave, hash, dados, horario)` | Registra a pré-matrícula e, se houver, reserva o horário, com idempotência pela chave. |

As funções são `SECURITY DEFINER`, pertencem à role `alfa_site_owner` (NOLOGIN, sem privilégios especiais, mesmo padrão de `alfa_auth_owner`), fixam `search_path` e ativam `row_security`. O owner só lê o necessário e só insere em `admission_leads` e `visit_bookings`. `alfa_auth` e `PUBLIC` não executam essas funções. A inicialização da API recusa subir se essa fronteira estiver diferente.

A API pública fica em `/api/public/sites/:slug`, sem token, com validação estrita, campo-isca contra robôs, consentimento obrigatório (LGPD), limite de envios por IP na API e no nginx, e sem cache.

## Modelo

Migration aditiva `008_public_site_and_admissions.js`, sem alterar tabelas existentes.

- **`school_site_addresses`**: código público da escola, um por escola.
- **`school_site_versions`**: conteúdo (JSON validado) e se está publicado.
- **`site_images`**: fotos públicas do site.
- **`admission_leads`**: pré-matrícula. Protocolo `PM-XXXXXX`, origem, interesse, contato do responsável, nome e nascimento da criança, turma de interesse, mensagem e data do consentimento.
- **`admission_lead_updates`**: situação e anotações ao longo do atendimento.
- **`visit_slots`** e **`visit_slot_closures`**: horários de visita e fechamento de horário.
- **`visit_bookings`** e **`visit_booking_outcomes`**: reservas e o que aconteceu (compareceu, não compareceu, cancelada).
- **`admission_events`**: auditoria das escritas da equipe por ator, chave, hash e referência.

Todas as tabelas têm `school_id`, FKs compostas, RLS ENABLE/FORCE e runtime só com SELECT/INSERT.

API da equipe em `/api/admissions` (paginada e com chave de idempotência nos POSTs): `site`, `site/address`, `site/versions`, `site/images`, `leads`, `lead-updates`, `visit-slots`, `visit-slot-closures`, `visit-bookings` e `visit-outcomes`.

Telas:

- `/escola/<codigo>`: site público, pensado primeiro para celular. Mostra como a escola funciona, turmas, rotina, uniforme com fotos, dúvidas e o formulário de pré-matrícula com escolha de horário.
- `/secretaria/captacao`: abas Interessados, Visitas e Site da escola.

## Regras

- O código público tem de 3 a 60 caracteres, só letras minúsculas, números e hífens.
- O site só aparece publicado, e a escola precisa estar ativa ou em teste.
- Uma pré-matrícula pública exige nome do responsável, WhatsApp, nome da criança e consentimento. Nascimento, turma de interesse e mensagem são opcionais.
- Reenvio com a mesma chave devolve o mesmo protocolo. A mesma chave com dados diferentes resulta em 409.
- O horário precisa ser da mesma escola, aberto, futuro e com vaga; senão, 409 sem gravar nada.
- Cada interessado tem no máximo uma visita ativa; reagendar cancela a anterior. Registrar "compareceu" marca o interessado como "visitou".
- Um horário com reservas ativas não pode ser fechado.
- Referências de outra escola são recusadas com 404, sem escrita e sem evento.

## Fora deste recorte

Matrícula online pela família e conversão do interessado em aluno (entrega seguinte), portal do responsável, renovação, unidades, mensalidade e taxa, envio automático de WhatsApp ou e-mail, domínio próprio, edição de interessado já registrado e exclusão de fotos.

## Critérios técnicos a preservar

Migration aditiva após a 007; FKs compostas por escola; RLS ENABLE/FORCE; menor privilégio; fronteira pública somente por funções definer verificadas na inicialização; validação estrita; auditoria na mesma transação; idempotência; nenhum UPDATE ou DELETE no runtime.

## Validação executada em 2026-10-04

Ambiente sem Docker: PostgreSQL 16 isolado em porta própria, com o banco e as roles recriados a cada rodada. As etapas seguem as do gate: migrations 001–008, provisionamento de senhas, seeds, API, suíte completa e verificação de sintaxe.

- **Backend:** 115 testes aprovados, 16 deles em `backend/tests/admissions/admissions.test.js`. Cobrem:
  - código público único e imutável, versões, publicação e despublicação;
  - conteúdo estrito e fotos conferidas pela assinatura, servidas só quando referenciadas na versão publicada;
  - pré-matrícula com consentimento, campo-isca, validação e idempotência (inclusive a mesma chave em outra escola);
  - capacidade do horário sob três envios simultâneos;
  - situação derivada do histórico, reagendamento e comparecimento;
  - fechamento de horário com reserva pendente;
  - isolamento e IDOR, perfis, escola suspensa (painel e site), RLS sem contexto, `alfa_auth` sem leitura e runtime sem UPDATE/DELETE;
  - fronteira pública: só `alfa_app` executa, owner NOLOGIN, e a inicialização recusa função, grant ou RLS alterados;
  - rollback da auditoria, paginação e limite de envios por origem.
- **Frontend:** 20 testes do cliente HTTP aprovados, 5 novos em `frontend/tests/admissions.test.js`.
- **Navegador:** os 6 specs aprovados com build de produção, API e banco isolados. O novo `frontend/e2e/admissions.spec.js` faz o caminho completo: a escola define o endereço, publica o site e abre um horário; a família, num celular, envia a pré-matrícula escolhendo o horário e recebe o protocolo; a secretaria encontra o interessado, registra o comparecimento e confere a persistência após recarregar. Neste ambiente o Chromium rodou como root e precisou de `chromiumSandbox: false` numa configuração local, que não foi versionada.

`deploy/smoke.py` passou a conferir o site publicado e o interessado após reinício, e as contagens das novas tabelas após backup e restauração. O nginx ganhou um limite por IP para a pré-matrícula, repassa o IP real à API e permite prévias `blob:` de foto na área da escola.

## Pendente no ambiente com Docker

1. `GATE_BROWSER=1 npm run test:gate`;
2. `python3 deploy/smoke.py`;
3. atualização do piloto local, com backup antes, comparação das tabelas existentes e conferência visual pelo responsável.
