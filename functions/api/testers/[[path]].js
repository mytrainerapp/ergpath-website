const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply = (status, body) => Response.json(body, {status, headers});
const failure = (status, error) => reply(status, {error});
export const consentVersion = 'testing-invitations-18plus-v1';

async function boundedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks = []; let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new Error('large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handle(request, env, send = fetch, now = Date.now()) {
  const url = new URL(request.url);
  if (url.search) return failure(400, 'query_not_allowed');
  if (url.pathname === '/api/testers/config' && request.method === 'GET') {
    if (!env.TESTER_DB || !env.TESTER_TURNSTILE_SECRET || !env.TESTER_SITEKEY) return failure(503,'temporarily_unavailable');
    return reply(200, {sitekey:env.TESTER_SITEKEY});
  }
  if (url.pathname !== '/api/testers/join') return failure(404,'route_not_found');
  if (request.method !== 'POST') return failure(405,'method_not_allowed');
  if (request.headers.get('Origin') !== url.origin) return failure(403,'origin_not_allowed');
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return failure(415,'json_required');
  if (!env.TESTER_DB || !env.TESTER_TURNSTILE_SECRET) return failure(503,'temporarily_unavailable');
  let input;
  try { input = await boundedJson(request); } catch { return failure(400,'invalid_request'); }
  if (!input || typeof input !== 'object') return failure(400,'invalid_request');
  if (input.consent !== true) return failure(400,'consent_required');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  // Do not collapse Gmail aliases or dots: different addresses remain distinct.
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) || email.split('@')[0].length > 64)
    return failure(400,'invalid_email');
  if (input.company) return reply(200,{ok:true});
  if (typeof input.token !== 'string' || !input.token || input.token.length > 2048) return failure(400,'verification_required');
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return failure(503,'temporarily_unavailable');
  try {
    const bucket = Math.floor(now / 600000);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TESTER_TURNSTILE_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`tester-rate:${bucket}:${ip}`));
    const rateKey = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    await env.TESTER_DB.prepare('DELETE FROM tester_rate WHERE expires_at < ?').bind(now).run();
    const limit = await env.TESTER_DB.prepare('INSERT INTO tester_rate (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(rateKey,now+1200000).first();
    if (limit.attempts > 5) return failure(429,'too_many_requests');
    let verified;
    try {
      const response = await send('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({secret:env.TESTER_TURNSTILE_SECRET,response:input.token}),
        signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) return failure(503,'verification_unavailable');
      verified = await response.json();
    } catch { return failure(503,'verification_unavailable'); }
    if (verified.success !== true || verified.hostname !== url.hostname || verified.action !== 'testers') return failure(400,'verification_required');
    await env.TESTER_DB.prepare('INSERT INTO tester_signups (email, created_at, consent_version, adult_declared) VALUES (?, ?, ?, 1) ON CONFLICT(email) DO NOTHING')
      .bind(email,new Date(now).toISOString(),consentVersion).run();
    // Same response for new entries and duplicates; no membership lookup endpoint.
    return reply(200,{ok:true});
  } catch { return failure(503,'temporarily_unavailable'); }
}
export function onRequest({request, env}) { return handle(request,env); }
