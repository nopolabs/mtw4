interface Env {
  PARCHMENT_BASE_URL: string;
  PARCHMENT_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
}

export async function onRequest(context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}): Promise<Response> {
  const { request, env, params } = context;
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path ?? '');
  const targetUrl = `${env.PARCHMENT_BASE_URL}/parchment/${path}`;
  const isIssue = path === 'issue' && request.method === 'POST';

  if (isIssue) {
    // Buffer body to read Turnstile token, then forward the same bytes.
    const bodyText = await request.text();
    const formData = new URLSearchParams(bodyText);
    const token = formData.get('cf-turnstile-response') ?? '';

    const verifyRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: request.headers.get('CF-Connecting-IP') ?? '',
        }),
      }
    );
    const result = await verifyRes.json() as { success: boolean };
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'verification failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Forward full body — parchment ignores the cf-turnstile-response field.
    return fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${env.PARCHMENT_API_KEY}`,
      },
      body: bodyText,
    });
  }

  // All other paths: transparent proxy.
  return fetch(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
}
