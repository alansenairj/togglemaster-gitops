#!/usr/bin/env bash
# Preenche os placeholders de infraestrutura em apps/*/values.yaml e
# bootstrap/apps/external-secrets.yaml com os outputs do Terraform.
#
# Nao usa sed: cada substituicao roda via yq sobre a arvore YAML parseada
# (.. | select(tag == "!!str")), trocando so o conteudo do valor de string —
# nunca a estrutura ou a indentacao do arquivo.
#
# Rodar uma vez apos o `terraform apply` e commitar o resultado. Dali em
# diante o unico campo que muda sozinho e image.tag, escrito pelo job
# gitops-writeback do CI a cada push na main.
#
#   TFDIR=/caminho/para/terraform ./scripts/sync-infra-values.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${TFDIR:?defina TFDIR apontando para o diretorio terraform/ do repo do Criss}"

tfout()      { terraform -chdir="$TFDIR" output -raw "$1"; }
tfout_json() { terraform -chdir="$TFDIR" output -json "$1"; }

export ECR_REGISTRY DYNAMODB_TABLE SQS_URL REDIS_URL EVAL_ROLE ANALYTICS_ROLE ESO_ROLE

ECR_REGISTRY="$(tfout_json ecr_repository_urls | jq -r 'to_entries[0].value' | cut -d/ -f1)"
SQS_URL="$(tfout sqs_queue_url)"
DYNAMODB_TABLE="$(tfout dynamodb_table_name)"
REDIS_URL="$(tfout redis_url)"
EVAL_ROLE="$(tfout evaluation_role_arn)"
ANALYTICS_ROLE="$(tfout analytics_role_arn)"
ESO_ROLE="$(tfout eso_role_arn)"

echo "ECR_REGISTRY:    $ECR_REGISTRY"
echo "SQS_URL:         $SQS_URL"
echo "DYNAMODB_TABLE:  $DYNAMODB_TABLE"
echo "REDIS_URL:       $REDIS_URL"
echo "EVAL_ROLE:       $EVAL_ROLE"
echo "ANALYTICS_ROLE:  $ANALYTICS_ROLE"
echo "ESO_ROLE:        $ESO_ROLE"

replace_placeholders() {
  local file="$1"
  yq eval -i '
    (.. | select(tag == "!!str")) |= sub("<ECR_REGISTRY>", env(ECR_REGISTRY)) |
    (.. | select(tag == "!!str")) |= sub("<SQS_QUEUE_URL>", env(SQS_URL)) |
    (.. | select(tag == "!!str")) |= sub("<DYNAMODB_TABLE_NAME>", env(DYNAMODB_TABLE)) |
    (.. | select(tag == "!!str")) |= sub("<REDIS_URL>", env(REDIS_URL)) |
    (.. | select(tag == "!!str")) |= sub("<EVALUATION_ROLE_ARN>", env(EVAL_ROLE)) |
    (.. | select(tag == "!!str")) |= sub("<ANALYTICS_ROLE_ARN>", env(ANALYTICS_ROLE)) |
    (.. | select(tag == "!!str")) |= sub("<ESO_ROLE_ARN>", env(ESO_ROLE))
  ' "$file"
}

for f in apps/*/values.yaml bootstrap/apps/external-secrets.yaml; do
  replace_placeholders "$f"
done

echo
echo "Placeholders restantes (deve ser zero):"
grep -rn '<ECR_REGISTRY>\|<SQS_QUEUE_URL>\|<DYNAMODB_TABLE_NAME>\|<REDIS_URL>\|<EVALUATION_ROLE_ARN>\|<ANALYTICS_ROLE_ARN>\|<ESO_ROLE_ARN>' \
  apps bootstrap 2>/dev/null || echo "nenhum"
