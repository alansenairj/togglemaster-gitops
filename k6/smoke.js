// Validação antes de qualquer carga: 1 VU, 1 iteração, cada endpoint uma vez.
// Se isto falhar, a carga mediria o defeito, não o desempenho.
//   k6 run -e BASE_URL=... -e MASTER_KEY=... k6/smoke.js
import { check } from 'k6';
import { BASE_URL, P, call, setupData, teardownData } from './lib/common.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1'] },
};

export function setup() {
  return setupData();
}

export default function (data) {
  const key = data.apiKey;
  const f = data.flags[0];

  const checks = [
    ['auth /health', call('GET', P.authHealth, null, 'auth_health'), 200],
    ['flag /health', call('GET', P.flagHealth, null, 'flag_health'), 200],
    ['targeting /health', call('GET', P.ruleHealth, null, 'rule_health'), 200],
    ['evaluation /health', call('GET', P.evalHealth, null, 'eval_health'), 200],
    ['auth /validate com chave válida', call('GET', P.authValidate, key, 'auth_validate'), 200],
    ['auth /validate sem chave -> 401', call('GET', P.authValidate, null, 'auth_validate'), 401],
    ['flag GET lista', call('GET', P.flags, key, 'flag_list'), 200],
    ['flag GET por nome', call('GET', `${P.flags}/${f}`, key, 'flag_get'), 200],
    ['flag GET sem chave -> 401', call('GET', P.flags, null, 'flag_list'), 401],
    ['flag GET inexistente -> 404', call('GET', `${P.flags}/k6-nao-existe`, key, 'flag_get'), 404],
    ['flag PUT', call('PUT', `${P.flags}/${f}`, key, 'flag_put', { description: 'k6 smoke' }), 200],
    ['targeting GET por flag', call('GET', `${P.rules}/${f}`, key, 'rule_get'), 200],
    ['targeting PUT', call('PUT', `${P.rules}/${f}`, key, 'rule_put', { rules: { type: 'PERCENTAGE', value: 60 } }), 200],
  ];
  for (const [nome, res, esperado] of checks) {
    check(res, { [`${nome} (${esperado})`]: (r) => r.status === esperado });
  }

  // O /evaluate usa a SERVICE_API_KEY do próprio pod, não a chave criada acima.
  // 502 aqui quase sempre é essa chave não existir no auth-service.
  const ev = call('GET', `${P.evaluate}?user_id=k6-user&flag_name=${f}`, null, 'evaluate');
  if (ev.status === 502) {
    console.error('evaluate 502: o evaluation-service não consegue falar com flag/targeting (verifique se a SERVICE_API_KEY dele é válida no auth-service e olhe os logs do pod)');
  }
  check(ev, {
    'evaluate (200)': (r) => r.status === 200,
    'evaluate devolve result booleano': (r) => r.status === 200 && typeof r.json('result') === 'boolean',
  });

  // analytics escala a zero por SQS (KEDA): 503 com 0 réplicas é esperado,
  // por isso só informa e não reprova.
  const an = call('GET', P.analyticsHealth, null, 'analytics_health');
  console.log(`analytics /health -> ${an.status} (503 = 0 réplicas, esperado fora de carga)`);

  console.log(`smoke contra ${BASE_URL}`);
}

export function teardown(data) {
  teardownData(data);
}
