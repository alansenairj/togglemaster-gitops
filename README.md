# togglemaster-gitops

Estado desejado do cluster ToggleMaster (EKS) e casa dos workflows reutilizáveis de CI/CD.

## Papel duplo

Este repositório é, ao mesmo tempo:

1. **Fonte de verdade do GitOps** — o ArgoCD observa a `main` e reconcilia o cluster.
2. **Casa dos workflows reutilizáveis** — em polyrepo, `uses: ./` não resolve entre
   repositórios, então os 5 repos de serviço referenciam os workflows daqui com `@main`.

É público de propósito: workflow reutilizável em repositório privado exigiria liberar acesso
repositório a repositório. Nenhum secret entra aqui — as credenciais das aplicações vêm do
AWS Secrets Manager via External Secrets Operator.

## Workflows reutilizáveis

| Arquivo | Chamado por | Jobs |
| --- | --- | --- |
| `.github/workflows/ci-go.yml` | auth-service, evaluation-service | test, lint, sec |
| `.github/workflows/ci-python.yml` | flag-service, targeting-service, analytics-service | test, lint, sec |
| `.github/workflows/cd-container.yml` | os 5 | build-scan-push, gitops-writeback |

O reuso é **por fase, não por linguagem**: tudo antes do `docker build` depende da linguagem;
tudo depois é idêntico. Por isso `cd-container.yml` não tem nenhum condicional de linguagem.

## Fluxo

```
push no repo do serviço
  -> CI (test, lint, SAST, SCA)
  -> docker build + trivy image
  -> push no ECR com tag imutável v1.0.0-<sha>
  -> write-back da tag em apps/<serviço>/values.yaml   (este repo)
  -> ArgoCD sincroniza
  -> pod novo no EKS
```

Nenhum `kubectl apply` em nenhum workflow. Quem aplica é o ArgoCD.

## Estrutura

```
.github/workflows/   workflows reutilizáveis
charts/              chart Helm genérico          (a criar)
apps/                values.yaml por serviço      (a criar)
platform/            External Secrets Operator    (a criar)
bootstrap/           App of Apps do ArgoCD        (a criar)
```
