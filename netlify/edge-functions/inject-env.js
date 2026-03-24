/**
 * Netlify Edge Function: inject-env
 * Replaces __SUPABASE_URL__ and __SUPABASE_KEY__ placeholders in HTML responses
 * with values from Netlify environment variables.
 */
export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // Only process HTML responses
  if (!contentType.includes('text/html')) {
    return response;
  }

  let html = await response.text();

  const supabaseUrl = Netlify.env.get('SUPABASE_URL') || '';
  const supabaseKey = Netlify.env.get('SUPABASE_KEY') || '';

  html = html.replace('__SUPABASE_URL__', supabaseUrl);
  html = html.replace('__SUPABASE_KEY__', supabaseKey);

  return new Response(html, {
    status: response.status,
    headers: response.headers,
  });
}
