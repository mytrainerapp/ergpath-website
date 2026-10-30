// Same-origin gateway for the deletion page only. No database, cookies or logs.
const assets = new Set(['/delete-account','/delete-account/style.css','/delete-account/app.js','/delete-account/client.js','/delete-account/config']);
const prefix = '/delete-account/api';
const safeHeaders = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const error = (status, code) => Response.json({error:code},{status,headers:safeHeaders});

export async function relay(request, send = fetch) {
  const url = new URL(request.url);
  const path = url.pathname;
  let upstreamPath, methods;
  if (assets.has(path)) { upstreamPath=path; methods=['GET','HEAD']; }
  else if(path === '/delete-account/') {
    if(!['GET','HEAD'].includes(request.method))return error(405,'method_not_allowed');
    return new Response(null,{status:308,headers:{...safeHeaders,Location:'/delete-account'}});
  } else if(path.startsWith(prefix+'/')) {
    upstreamPath=path.slice(prefix.length);
    if(upstreamPath==='/v1/backups/capabilities')methods=['GET'];
    else if(upstreamPath==='/v1/backups/account')methods=['DELETE'];
    else if(/^\/v1\/deletion-status\/[a-f0-9]{64}$/.test(upstreamPath))methods=['GET'];
    else return error(404,'route_not_found');
  } else return error(404,'route_not_found');
  if(!methods.includes(request.method))return new Response(null,{status:405,headers:{...safeHeaders,Allow:methods.join(', ')}});
  if(url.search)return error(400,'query_not_allowed');
  const origin=request.headers.get('Origin');
  if(origin && origin!==url.origin)return error(403,'origin_not_allowed');
  const headers=new Headers();
  if(path.startsWith(prefix+'/')) {
    for(const name of ['Authorization','X-Ergpath-Deletion-Receipt'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
  }
  let response;
  try { response=await send(new Request('https://api.ergpath.com'+upstreamPath,{method:request.method,headers,redirect:'manual',signal:AbortSignal.timeout(25000)})); }
  catch { return error(502,'deletion_service_unavailable'); }
  // Do not follow redirects with authentication or reflect unexpected cookies/CORS headers.
  if(response.status>=300 && response.status<400)return error(502,'unexpected_upstream_redirect');
  const returned=new Headers(safeHeaders);
  for(const name of ['Content-Type','Content-Security-Policy','X-Frame-Options','Permissions-Policy','Allow','Retry-After']) {
    if(response.headers.has(name))returned.set(name,response.headers.get(name));
  }
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers:returned});
}
export function onRequest({request}) { return relay(request); }
