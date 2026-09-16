# platform/

Recursos de plataforma que os 5 microsservicos dependem, mas que nao sao
codigo de aplicacao: o External Secrets Operator e o ClusterSecretStore que o
liga ao AWS Secrets Manager.

| Arquivo | O que e |
| --- | --- |
| `cluster-secret-store.yaml` | ClusterSecretStore, autentica via IRSA (ServiceAccount `external-secrets`) |

O ESO em si (o Helm chart) nao mora aqui — a Application em
`bootstrap/apps/external-secrets.yaml` referencia o chart oficial
(`https://charts.external-secrets.io`) direto, e e la que a ServiceAccount
recebe a anotacao `eks.amazonaws.com/role-arn` com o output `eso_role_arn` do
Terraform.

Fluxo: `Terraform → Secrets Manager → ESO (IRSA) → Secret K8s → envFrom` — ver
`externalsecret.yaml` no chart base.
