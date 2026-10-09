// Validate path and query separately: percent encoding is permitted only in query values.
export function allowedLocalRequest(input: unknown, method: unknown): boolean {
  if(typeof input !== 'string' || input.length>4096 || !['GET','POST'].includes(String(method))) return false;
  const [path, query, extra] = input.split('?');
  if(extra!==undefined || !/^\/v1\/[a-zA-Z0-9_/-]+$/.test(path) || path.includes('//')) return false;
  if(query!==undefined) {
    if(method!=='GET' || !/^(?:[a-z_]+=[a-zA-Z0-9_%+.-]*(?:&[a-z_]+=[a-zA-Z0-9_%+.-]*)*)$/.test(query)) return false;
    try { if(/[\u0000-\u001f\u007f]/.test(decodeURIComponent(query))) return false; } catch { return false; }
  }
  const id='[a-zA-Z0-9_-]+';
  return method==='GET'
    ? new RegExp(`^/v1/(?:attachments|me|health|workspaces|people|notifications|collaboration(?:/notifications)?|ideas(?:/${id})?|tags|activity|projects(?:/${id}(?:/(?:retrospectives|comments|agreement))?)?|experiments(?:/${id})?)$`).test(path)
    : new RegExp(`^/v1/(?:attachments/(?:link|${id}/preview)|profile/(?:avatar|name)|notifications/read|collaboration/notifications/read|projects/${id}/agreement|commands|batches/${id}/(?:preview|undo))$`).test(path);
}
