const ALLOWED_ORIGIN = '*';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(ALLOWED_ORIGIN) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/stripe-webhook') {
      return handleStripeWebhook(request, env);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    if (body.action === 'create_checkout_session') {
      return createCheckoutSession(body, env);
    }

    return proxyGroqChat(body, env);
  }
};

async function createCheckoutSession(body, env) {
  // Debug: log what env vars are present
  const hasSecret = !!env.STRIPE_SECRET_KEY;
  const hasPrice = !!env.STRIPE_PRICE_ID;

  if (!hasSecret || !hasPrice) {
    return jsonResponse({
      error: 'Stripe is not configured',
      debug: { hasSecret, hasPrice }
    }, 500);
  }

  if (!body.uid || !body.email) {
    return jsonResponse({ error: 'Missing user details' }, 400);
  }

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('customer_email', body.email);
  form.set('line_items[0][price]', env.STRIPE_PRICE_ID);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', body.success_url || 'https://example.com?checkout=success');
  form.set('cancel_url', body.cancel_url || 'https://example.com');
  form.set('client_reference_id', body.uid);
  form.set('metadata[firebaseUid]', body.uid);

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const data = await stripeRes.json();

  if (!stripeRes.ok) {
    return jsonResponse({ error: data.error?.message || 'Stripe checkout failed' }, stripeRes.status);
  }

  return jsonResponse({ url: data.url });
}

async function handleStripeWebhook(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature') || '';

  if (!(await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET))) {
    return jsonResponse({ error: 'Invalid webhook signature' }, 400);
  }

  const event = JSON.parse(rawBody);

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object;
    const uid = session?.metadata?.firebaseUid || session?.client_reference_id;

    if (uid) {
      await markUserPro(uid, env);
    }
  }

  return jsonResponse({ received: true });
}

async function proxyGroqChat(body, env) {
  if (!body.messages || !Array.isArray(body.messages)) {
    return jsonResponse({ error: 'Missing messages field' }, 400);
  }

  const maxTokens = Number.isInteger(body.max_tokens)
    ? Math.min(Math.max(body.max_tokens, 300), 2500)
    : 1200;

  try {
    const payload = {
      model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: maxTokens,
      messages: body.messages,
    };

    if (body.response_format) payload.response_format = body.response_format;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await groqRes.json();

    return new Response(JSON.stringify(data), {
      status: groqRes.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(ALLOWED_ORIGIN),
      },
    });
  } catch (err) {
    return jsonResponse({ error: 'Upstream error', detail: err.message }, 502);
  }
}

async function markUserPro(uid, env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=isPro&updateMask.fieldPaths=proUpdatedAt`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        isPro: { booleanValue: true },
        proUpdatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firestore update failed: ${errorText}`);
  }
}

async function getGoogleAccessToken(env) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error('Firebase service account is not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const unsignedJwt = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;
  const signature = await signJwt(unsignedJwt, env.FIREBASE_PRIVATE_KEY);
  const jwt = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    throw new Error(tokenData.error_description || 'Could not get Google access token');
  }

  return tokenData.access_token;
}

async function signJwt(unsignedJwt, privateKeyPem) {
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(unsignedJwt),
  );

  return arrayBufferToBase64Url(signature);
}

async function importPrivateKey(privateKeyPem) {
  const pem = privateKeyPem.replace(/\\n/g, '\n');
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function verifyStripeSignature(payload, signatureHeader, webhookSecret) {
  if (!webhookSecret || !signatureHeader) return false;

  const timestamp = signatureHeader.match(/t=([^,]+)/)?.[1];
  const signature = signatureHeader.match(/v1=([^,]+)/)?.[1];

  if (!timestamp || !signature) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = arrayBufferToHex(digest);

  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;

  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);

  return out === 0;
}

function base64UrlEncode(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(ALLOWED_ORIGIN),
    },
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
  };
}