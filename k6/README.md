# k6 — teste de carga

Teste de carga manual nos endpoints publicados no ingress. Você escolhe o número de usuários (50, 200, 500 ou outro). Não roda na pipeline: a decisão de automatizar vem depois das primeiras rodadas.

## Pré-requisitos

- `k6` instalado.
- `kubectl` com acesso ao cluster `togglemaster-dev`.

## Variáveis

| Variável | Obrigatória | Padrão | Função |
| --- | --- | --- | --- |
| `BASE_URL` | sim | — | URL do ELB do ingress |
| `MASTER_KEY` | sim, ou `API_KEY` | — | Cria a chave de API do teste |
| `API_KEY` | alternativa | — | Chave já existente (pula a criação) |
| `VUS` | não | 50 | Usuários simultâneos (o `run.sh` define pelo argumento) |
| `RAMP` / `HOLD` / `DOWN` | não | 1m / 3m / 30s | Subida, patamar, descida |
| `THINK_S` | não | 0.5 | Pausa média entre ações de um usuário |
| `FLAG_POOL` | não | 20 | Quantidade de flags criadas para o teste |

## Procedimento

1. Obtenha a URL do ELB:

   ```zsh
   export BASE_URL="http://$(kubectl -n flag-service get ingress flag-service-ingress -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
   ```

2. Obtenha a chave master (não imprima, não grave em arquivo):

   ```zsh
   export MASTER_KEY="$(kubectl -n auth-service get secret auth-service-secret -o jsonpath='{.data.MASTER_KEY}' | base64 -d)"
   ```

3. Rode o smoke. Ele valida cada endpoint uma vez. Se falhar, não rode a carga.

   ```zsh
   ./k6/run.sh smoke
   ```

4. Rode a carga, do menor para o maior:

   ```zsh
   ./k6/run.sh load 50
   ./k6/run.sh load 200
   ./k6/run.sh load 500
   ```

   Com 200 ou mais usuários, o script pede confirmação. `YES=1` pula a pergunta.

5. Leia o resumo no terminal. O JSON fica em `k6/results/` (ignorado pelo Git).

## Endpoints

Caminhos pelo ingress. O nginx reescreve `/<prefixo>/(.*)` para `/$2`, então o `/flags` do serviço é `/flags/flags` no ELB.

| Serviço | Endpoint no ELB | No mix de carga |
| --- | --- | --- |
| evaluation | `GET /evaluate/evaluate?user_id=&flag_name=` | 70% |
| flag | `GET /flags/flags/<nome>` | 10% |
| targeting | `GET /rules/rules/<flag>` | 10% |
| auth | `GET /auth/validate` | 5% |
| flag | `PUT /flags/flags/<nome>` | 5% |

O smoke cobre também `/health` dos 5 serviços, `GET /flags/flags`, `PUT /rules/rules/<flag>` e os casos 401 e 404.

O `setup` cria `FLAG_POOL` flags com regra de 50% e o `teardown` as remove. A chave de API criada fica: o auth-service não tem endpoint de remoção.

## O que observar durante o teste

- Dashboard `ToggleMaster — Saúde, Logs e Capacidade` no Grafana: req/s, 5xx, p95, burn rate e restarts.
- Autoscaling: `kubectl get hpa -A -w`. Só o `evaluation-service` tem HPA (CPU 70%, 1 a 5 réplicas).
- `auth`, `flag` e `targeting` têm 1 réplica fixa. `flag` e `targeting` chamam o `auth` em cada requisição, então o `auth` tende a limitar a vazão. Isto é uma hipótese a confirmar com os números, não um fato medido.

## Limites conhecidos

- O `/evaluate` usa a `SERVICE_API_KEY` do próprio pod, que o auth-service só aceita porque o `/validate` aceita a `MASTER_KEY` (PR #5 do auth-service). Se voltar a responder 502, o smoke avisa: confira se a `SERVICE_API_KEY` do evaluation é igual à `MASTER_KEY` do auth e se a imagem do auth tem essa mudança.
- O `/evaluate` guarda cada flag no Redis por 30 s. Por isso o teste usa um pool de flags: com uma só, quase tudo seria cache hit.
- O `analytics-service` escala a zero por fila SQS (KEDA). Fora da carga, `/analytics/health` responde 503 e o smoke só informa.
- Os limites de latência em `load.js` são iniciais. Ajuste depois da rodada de 50 usuários.
