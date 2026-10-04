# ADR-003: Unidades, site público e captação de novos alunos

- **Status:** Proposta para aprovação do arquiteto (implementada)
- **Data:** 2026-10-04
- **Relacionadas:** ADR-001, ADR-002, `docs/problema-e-proposta-de-valor.md`

## Contexto

A Alfa Reis vai abrir uma nova unidade, que será a referência digital da escola: tudo o que funcionar nela será replicado na unidade atual, que ainda opera em papel. A nova unidade precisa captar alunos desde o início, com um site que explique como a escola funciona (rotina, turmas, uniforme com fotos, dúvidas) e um canal de pré-matrícula, agendamento de visita e matrícula online.

## Decisão

1. **Unidade dentro da escola, não uma nova escola.** `units` pertence à escola (tenant). Turmas, alunos e períodos de matrícula podem ser de uma unidade. A equipe e os relatórios enxergam todas as unidades da escola. Assim, replicar o processo na unidade atual não exige migração: é o mesmo sistema. Os dados existentes migram para a "Unidade Sede".
2. **Site público servido pela própria plataforma** em `/escola/<código>`. O conteúdo é editável pela escola (sem programador) e guardado como JSON validado. Só aparece depois de publicado.
3. **Fotos do site no banco**, limitadas a 2 MB e a JPG, PNG ou WebP. O tipo é conferido pela assinatura do arquivo, e as imagens são servidas com `Content-Security-Policy: default-src 'none'`. Essa área é só para imagens públicas; documentos de alunos continuam proibidos até existir armazenamento privado.
4. **Pré-matrícula pública** com consentimento (LGPD), campo-isca contra robôs, limite de envios por conexão e protocolo legível (`PM-XXXXXX`). Agendar visita trava o horário para respeitar a capacidade.
5. **Matrícula de aluno novo reaproveita o fluxo de renovação.** Um período de matrícula é uma campanha do tipo `admission`. Ao converter o interessado, o sistema cria a criança como candidata (`applicant`), o responsável e a solicitação, e gera o link do portal (ADR-002). A aprovação cria a matrícula, ativa o aluno e marca o atendimento como concluído; a rejeição o encerra com o motivo.

## Consequências

- Captação, visita, matrícula, histórico e funil ficam num único lugar, com a origem de cada família.
- Candidatos não contam como alunos ativos nem entram em renovações.
- Guardar imagens no banco é simples para o MVP, mas aumenta o backup. Ao crescer, migrar para armazenamento de objetos (ex.: S3) mantendo a mesma API.
- Domínio próprio da escola (ex.: `alfareis.com.br`) pode apontar para `/escola/alfa-reis` quando o sistema for publicado.
