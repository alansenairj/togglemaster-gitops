// Configuração, helpers HTTP e setup/teardown compartilhados por smoke.js e load.js.
// Tudo vem de variável de ambiente (nada de URL ou chave no código).
import http from 'k6/http';
import { fail } from 'k6';

export const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const MASTER_KEY = __ENV.MASTER_KEY || '';
const API_KEY = __ENV.API_KEY || '';
export const FLAG_POOL = parseInt(__ENV.FLAG_POOL || '20', 10);

// Caminhos pelo ingress. O nginx reescreve /<prefixo>/(.*) para /$2, então o
// endpoint /flags do serviço fica em /flags/flags no ELB.
export const P = {
  authHealth: '/auth/health',
  authValidate: '/auth/validate',
  authKeys: '/auth/admin/keys',
  flagHealth: '/flags/health',
  flags: '/flags/flags',
  ruleHealth: '/rules/health',
  rules: '/rules/rules',
  evalHealth: '/evaluate/health',
  evaluate: '/evaluate/evaluate',
  analyticsHealth: '/analytics/health',
};

// Cada requisição leva a tag `endpoint`, usada nos thresholds e no relatório.
export function call(method, path, key, tag, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const payload = body === undefined ? null : JSON.stringify(body);
  return http.request(method, `${BASE_URL}${path}`, payload, {
    headers,
    tags: { endpoint: tag },
  });
}

function must(res, expected, what) {
  if (res.status !== expected) {
    fail(`setup: ${what} retornou ${res.status} (esperado ${expected}): ${String(res.body).slice(0, 200)}`);
  }
  return res;
}

// Cria (ou reaproveita) a chave de API e um pool de flags com regra de 50%.
// Pool > 1 de propósito: o /evaluate guarda cada flag no Redis por 30s, então
// com uma só flag quase tudo seria cache hit e flag/targeting/auth nunca
// seriam exercitados.
export function setupData() {
  if (!BASE_URL) fail('BASE_URL é obrigatório (ex.: http://<elb>.us-east-1.elb.amazonaws.com)');

  const runId = `${Date.now()}`;
  let apiKey = API_KEY;
  if (!apiKey) {
    if (!MASTER_KEY) fail('informe API_KEY ou MASTER_KEY');
    const r = must(call('POST', P.authKeys, MASTER_KEY, 'setup', { name: `k6-${runId}` }), 201, 'criar chave');
    apiKey = r.json('key');
  }

  const flags = [];
  for (let i = 0; i < FLAG_POOL; i++) {
    const name = `k6-${runId}-${i}`;
    must(call('POST', P.flags, apiKey, 'setup', { name, description: 'k6', is_enabled: true }), 201, `criar flag ${name}`);
    must(call('POST', P.rules, apiKey, 'setup', { flag_name: name, is_enabled: true, rules: { type: 'PERCENTAGE', value: 50 } }), 201, `criar regra ${name}`);
    flags.push(name);
  }
  return { apiKey, flags, runId };
}

// Remove só o que o teste criou. A chave de API fica: o auth-service não tem
// endpoint de remoção.
export function teardownData(data) {
  for (const name of data.flags) {
    call('DELETE', `${P.rules}/${name}`, data.apiKey, 'teardown');
    call('DELETE', `${P.flags}/${name}`, data.apiKey, 'teardown');
  }
}
