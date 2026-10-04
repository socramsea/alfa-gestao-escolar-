# Interface Alfa Gestão Escolar

Execute `npm run dev` neste diretório e a API com `npm start` em `../backend`.
O Vite encaminha `/api` para `http://127.0.0.1:4000`. O preview também possui
proxy para testes do build. Em produção, use o pacote Nginx/Compose descrito
em [deploy/README.md](../deploy/README.md), nunca o servidor Vite.

O login usa POST `/api/auth/login` e confirma a identidade com GET `/api/auth/me`.
O token fica no sessionStorage da aba; a senha não é persistida. Ao recarregar,
voltar o foco ou a cada minuto com sessão ativa, a identidade é revalidada.
Falhas de validação bloqueiam a interface; 401 remove a sessão. Sair remove o
token local, sem revogar um JWT já emitido no servidor. O token continua
sujeito à expiração e à revalidação de identidade do backend.

A secretaria permite `school_admin` e `platform_admin`, conforme os endpoints
existentes. Responsável e renovação permanecem bloqueados até definição dos
perfis autorizados. A rota `/secretaria` agora exibe o MVP de estrutura com
cadastros persistidos de etapas, períodos, grupos/séries, turnos e turmas.
As páginas demonstrativas antigas não estão conectadas às rotas ativas.
Não existe gravação de matrícula nesta entrega.

Verificações: `npm test`, `npm run build` e `npm run test:e2e` (ambiente isolado).
Os testes de `tests/` usam HTTP simulado. O cenário E2E usa navegador com sandbox,
API e banco reais e cria somente dados fictícios. Execute pelo `deploy/smoke.py`
em Docker compatível. Para verificar o fluxo local sem certificar o deploy,
construa o frontend e execute `GATE_BROWSER=1 npm run test:gate` no backend.
