// Teste de carga nos endpoints publicados no ingress. Você escolhe os usuários:
//   VUS=50 | 200 | 500   (ou qualquer número)
// Rampa de subida, patamar e descida. Ver k6/README.md.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { FLAG_POOL, P, call, setupData, teardownData } from './lib/common.js';

const VUS = parseInt(__ENV.VUS || '50', 10);
const RAMP = __ENV.RAMP || '1m';
const HOLD = __ENV.HOLD || '3m';
const DOWN = __ENV.DOWN || '30s';
const THINK_S = parseFloat(__ENV.THINK_S || '0.5');

// 4xx/5xx contam como falha em http_req_failed.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }));

export const options = {
  scenarios: {
    usuarios: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: HOLD, target: VUS },
        { duration: DOWN, target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  // Metas iniciais, para ajustar depois da primeira rodada de 50 VUs.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{endpoint:evaluate}': ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{endpoint:flag_get}': ['p(95)<500'],
    'http_req_duration{endpoint:rule_get}': ['p(95)<500'],
    'http_req_duration{endpoint:auth_validate}': ['p(95)<300'],
    'http_req_duration{endpoint:flag_put}': ['p(95)<800'],
  },
};

export function setup() {
  return setupData();
}

const rnd = (n) => Math.floor(Math.random() * n);

// Mix: 70% /evaluate (caminho quente), 10% flag, 10% regra, 5% validate, 5% escrita.
export default function (data) {
  const flag = data.flags[rnd(FLAG_POOL)];
  const key = data.apiKey;
  const r = Math.random();
  let res;
  let tag;

  if (r < 0.70) {
    tag = 'evaluate';
    res = call('GET', `${P.evaluate}?user_id=user-${rnd(100000)}&flag_name=${flag}`, null, tag);
  } else if (r < 0.80) {
    tag = 'flag_get';
    res = call('GET', `${P.flags}/${flag}`, key, tag);
  } else if (r < 0.90) {
    tag = 'rule_get';
    res = call('GET', `${P.rules}/${flag}`, key, tag);
  } else if (r < 0.95) {
    tag = 'auth_validate';
    res = call('GET', P.authValidate, key, tag);
  } else {
    tag = 'flag_put';
    res = call('PUT', `${P.flags}/${flag}`, key, tag, { description: `k6 ${Date.now()}` });
  }

  check(res, { [`${tag} 200`]: (x) => x.status === 200 });
  sleep(THINK_S * (0.5 + Math.random()));
}

export function teardown(data) {
  teardownData(data);
}
