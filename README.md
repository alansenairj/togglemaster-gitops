# togglemaster-gitops

Estado desejado do cluster ToggleMaster (EKS) e casa dos workflows reutilizáveis de CI/CD.
Contexto completo: [plano-geral.md](../pipeline/plano-geral.md) no repositório de trabalho.

## Estrutura

```
.github/workflows/   ci-go.yml, ci-python.yml, cd-container.yml (ver README do repo)
charts/base-microservice/   chart generico: namespace, deployment, service, ingress,
                             externalsecret, serviceaccount, hpa, keda
apps/<svc>/                 Chart.yaml (dependency do chart base) + values.yaml por servico
platform/                   ClusterSecretStore (ESO -> AWS Secrets Manager)
bootstrap/                  root-app.yaml (App of Apps) + 13 Applications (5 servicos,
                             ESO, platform, Prometheus, Loki, Tempo, Alloy, Grafana,
                             monitoring-config)
monitoring/dashboards/      dashboard do Grafana como ConfigMap (carregado pelo sidecar)
k6/                         teste de carga manual (ver k6/README.md)
scripts/sync-infra-values.sh  preenche os placeholders de infra apos o terraform apply
```

## Por que subchart, nao Kustomize

Os 5 manifestos da Fase 2 (`alansenairj/fase-2-manifestos-eks`) tem exatamente a mesma forma —
namespace, configmap, secret, deployment, service, ingress. `charts/base-microservice` e esse
padrao uma vez so; cada `apps/<svc>` declara ele como `dependency` (`file://../../charts/base-microservice`)
e so muda `values.yaml`.

**Consequencia direta:** como o chart base e subchart, o Helm exige que os values fiquem
aninhados sob a chave `base-microservice:` — nao no topo do arquivo. O job `gitops-writeback`
do CI escreve em `.["base-microservice"].image.{repository,tag}`, nao em `.image.*`.

## Placeholders de infraestrutura

`apps/*/values.yaml` e `bootstrap/apps/external-secrets.yaml` nascem com placeholders
(`<ECR_REGISTRY>`, `<SQS_QUEUE_URL>`, `<DYNAMODB_TABLE_NAME>`, `<REDIS_URL>`,
`<EVALUATION_ROLE_ARN>`, `<ANALYTICS_ROLE_ARN>`, `<ESO_ROLE_ARN>`) porque esses valores só
existem depois do `terraform apply`. Não são segredos — são nomes de recursos e ARNs.

```bash
TFDIR=/caminho/para/terraform ./scripts/sync-infra-values.sh
git add -A && git commit -m "chore(gitops): sync valores de infraestrutura" && git push
```

O script usa `yq` sobre a árvore YAML parseada, nunca `sed` — troca só o conteúdo de strings,
sem arriscar indentação ou estrutura.

## Secrets — o que muda da Fase 2

A Fase 2 tinha `secret.yaml` com `DATABASE_URL`/`MASTER_KEY`/`SERVICE_API_KEY` versionados em
claro (`alansenairj/fase-2-manifestos-eks/*/secret.yaml`, `vars-coletadas`). Esse repositório
não porta esse padrão: o chart gera `ExternalSecret`, não `Secret`. O fluxo é

```
Terraform (random_password) → AWS Secrets Manager → ESO (IRSA) → Secret K8s → envFrom
```

Nenhum valor de credencial passa pelo Git.

## Ordem de bootstrap

1. `terraform apply` no repo do Criss (EKS, RDS, Secrets Manager, roles IRSA, OIDC do GitHub)
2. `./scripts/sync-infra-values.sh` + commit
3. Instalar o ArgoCD no cluster (Helm, fora deste repo)
4. `kubectl apply -f bootstrap/root-app.yaml` — a partir daqui o ArgoCD assume: ESO, o
   ClusterSecretStore, os 5 microsserviços e a stack de observabilidade

## Ingress

Os 5 serviços ficam no mesmo ELB (`ingressClassName: nginx`). Cada path usa
`rewrite-target: /$2`: o prefixo é removido antes de chegar ao serviço.

| Serviço | Path no ELB | Exemplo (endpoint do serviço) |
| --- | --- | --- |
| auth | `/auth(/\|$)(.*)` | `/auth/validate` → `/validate` |
| flag | `/flags(/\|$)(.*)` | `/flags/flags` → `/flags` |
| targeting | `/rules(/\|$)(.*)` | `/rules/rules/<flag>` → `/rules/<flag>` |
| evaluation | `/evaluate(/\|$)(.*)` | `/evaluate/evaluate?user_id=&flag_name=` → `/evaluate` |
| analytics | `/analytics(/\|$)(.*)` | `/analytics/health` → `/health` |

Autoscaling: só o `evaluation-service` tem HPA (CPU 70%, 1 a 5 réplicas). `analytics-service`
escala por fila SQS (KEDA, 0 a 5) e fica em 0 réplicas sem mensagens. `auth`, `flag` e
`targeting` têm 1 réplica fixa.

## Observabilidade

Alloy recebe OTLP dos serviços e coleta os logs dos pods: traces vão para o Tempo, logs para
o Loki, e o spanmetrics vai para o Prometheus. O Grafana provisiona os 3 datasources e o
dashboard `togglemaster-overview` (`monitoring/dashboards/`). O ArgoCD aplica o ConfigMap;
editar o dashboard na interface não persiste (storage em `emptyDir`).

Armadilhas que já custaram tempo:

- **Não defina `allValue` com regex** nas variáveis do dashboard. Os datasources Loki e
  Prometheus escapam esse valor como texto literal (`.*` vira `\.\*`) e o painel fica em
  "No data". Sem `allValue`, "All" expande para a lista real de valores.
- **O datasource Prometheus declara `timeInterval: 60s`** (o scrape real). Sem isso o Grafana
  assume 15s, o `$__rate_interval` fica em 1m (uma amostra) e `rate()` volta vazio.
- **Variável salva na URL vence o padrão do dashboard.** Se renomear ou mudar uma variável,
  links antigos com `var-<nome>=` podem manter o valor velho.

## Teste de carga

`k6/` tem o smoke e a carga manual (50, 200, 500 usuários) contra os endpoints do ingress.
Procedimento em [k6/README.md](k6/README.md). Ainda não está na pipeline.
