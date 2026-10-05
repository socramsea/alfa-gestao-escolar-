# ADR-006 — IP real do visitante nos limites do nginx

Status: **ACEITO**, por pedido do responsável pelo projeto em 2026-10-05, como parte da entrega 8.

## Contexto

O nginx do pacote limita por endereço de origem:
- o login;
- a pré-matrícula do site;
- o acesso da família à matrícula online.

Ele também repassa esse endereço à API, que aplica os próprios limites.

A porta do nginx só é publicada em `127.0.0.1`. O acesso pela internet sempre passa por um proxy no próprio computador:
- o Caddy, no servidor ([`deploy/NO-AR.md`](../../deploy/NO-AR.md));
- ou o túnel da Cloudflare, no computador do responsável ([`deploy/NO-AR-COMPUTADOR.md`](../../deploy/NO-AR-COMPUTADOR.md)).

Por isso, o nginx enxergava todos os visitantes com um endereço só, o gateway da rede do Docker. Um único cliente que errasse ou insistisse no login esgotava o limite de todos. O [`deploy/README.md`](../../deploy/README.md) já registrava o risco e a regra: só confiar no IP informado por proxies explicitamente confiáveis.

## Decisão

1. **O nginx usa o IP real do visitante, informado no `X-Forwarded-For`.** Os limites e o `X-Real-IP` repassado à API passam a contar por visitante. Os valores dos limites não mudam.
2. **Só os endereços privados e o loopback podem informar o IP:** `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12` e `192.168.0.0/16`.
   - Com a porta publicada só em `127.0.0.1`, esses endereços são o próprio computador, que chega pelo gateway do Docker, e os outros serviços do mesmo projeto.
   - Um visitante da internet nunca chega ao nginx com um desses endereços.
3. **Vale o último endereço não confiável da lista (`real_ip_recursive on`).**
   - O Caddy, sem `trusted_proxies`, substitui o `X-Forwarded-For` pelo IP de quem conectou.
   - A Cloudflare acrescenta o IP de quem conectou ao fim da lista.
   - Em ambos os casos, o que o visitante puser no cabeçalho fica antes e é ignorado.
4. **Quem chega sem passar por um desses proxies continua contado pelo próprio endereço.** O `X-Forwarded-For` dele é ignorado.

## Consequências

- Na reunião, quem estiver no mesmo Wi-Fi ainda divide um endereço público, e portanto o mesmo limite. Por isso, o piloto mantém o teto maior da API ([`deploy/compose.piloto.yml`](../../deploy/compose.piloto.yml)).
- **A regra depende de a porta do nginx continuar publicada só em `127.0.0.1`.** Publicá-la em outra interface permitiria forjar o IP. Mudar isso exige revisar este ADR.
- **Proxies com outro comportamento exigem revisar este ADR antes de entrar.** É o caso de um proxy que repasse o `X-Forwarded-For` do visitante sem acrescentar o IP de quem conectou, como o Caddy com `trusted_proxies` amplo.
- O log de acesso do nginx passa a mostrar o IP do visitante, que é dado pessoal. Isso vale para os critérios de produção e a revisão da LGPD.
