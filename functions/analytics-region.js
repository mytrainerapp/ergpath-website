// Website-only Pages Function. No account bindings, persistence or application logs.
const EU = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);

export function onRequestGet({request}) {
  const country = request.cf?.country;
  const region = EU.has(country) ? 'eu' :
    (typeof country === 'string' && /^[A-Z]{2}$/.test(country) && !['XX','T1'].includes(country) ? 'non-eu' : 'unknown');
  return Response.json({region}, {headers:{
    'Cache-Control':'private, no-store, max-age=0',
    'CDN-Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  }});
}
