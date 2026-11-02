#!/usr/bin/env zsh
# Uso:  ./run.sh smoke
#       ./run.sh load <vus>      (ex.: 50, 200, 500)
# Variáveis: BASE_URL (obrigatória) e MASTER_KEY ou API_KEY.
set -eu
cd "${0:A:h}"

: "${BASE_URL:?defina BASE_URL (ex.: http://<elb>.us-east-1.elb.amazonaws.com)}"
if [[ -z "${MASTER_KEY:-}" && -z "${API_KEY:-}" ]]; then
  print -u2 'defina MASTER_KEY ou API_KEY'
  exit 1
fi

case "${1:-}" in
  smoke)
    k6 run smoke.js
    ;;
  load)
    vus="${2:?informe os usuários: ./run.sh load 50}"
    if (( vus >= 200 )) && [[ "${YES:-}" != 1 ]]; then
      read -r "ok?${vus} usuários contra ${BASE_URL} pode degradar o ambiente. Continuar? [s/N] "
      [[ "$ok" == [sS] ]] || { print 'cancelado'; exit 1; }
    fi
    mkdir -p results
    out="results/load-${vus}vu-$(date +%Y%m%d-%H%M%S).json"
    k6 run -e VUS="$vus" --summary-export "$out" load.js
    print "resumo salvo em k6/$out"
    ;;
  *)
    print -u2 'uso: ./run.sh smoke | ./run.sh load <vus>'
    exit 2
    ;;
esac
