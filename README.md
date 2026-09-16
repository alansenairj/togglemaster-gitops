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
bootstrap/                  root-app.yaml (App of Apps) + 7 Applications
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
   ClusterSecretStore e os 5 microsserviços

## Ingress

| Serviço | Path |
| --- | --- |
| auth | `/auth(/\|$)(.*)` |
| flag | `/flags(/\|$)(.*)` |
| targeting | `/rules(/\|$)(.*)` |
| evaluation | `/evaluate(/\|$)(.*)` |
| analytics | `/analytics(/\|$)(.*)` |
