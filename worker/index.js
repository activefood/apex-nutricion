// Cloudflare Worker: sirve el sitio estático (vía ASSETS) y maneja las rutas /api/* con la
// misma lógica que las funciones de Netlify (netlify/functions/*.js) — reenvían a Google Apps
// Script para guardar pedidos y reseñas, y procesan el webhook de Telegram.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/submit-order') {
      return handleSubmitOrder(request, env);
    }
    if (url.pathname === '/api/submit-review') {
      return handleSubmitReview(request, env);
    }
    if (url.pathname === '/api/telegram-webhook') {
      return handleTelegramWebhook(request, env);
    }

    // Todo lo demás: archivos estáticos del sitio (HTML, CSS, JS, imágenes).
    return env.ASSETS.fetch(request);
  }
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/* ---------- /api/submit-order ---------- */
async function handleSubmitOrder(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    console.error('[submit-order] Falta APPS_SCRIPT_URL en variables de entorno');
    return json({ ok: false, error: 'Server misconfiguration: APPS_SCRIPT_URL missing' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'Invalid order payload (bad JSON)' }, 400);
  }

  if (!payload || !payload.customerName || !payload.location || !Array.isArray(payload.items) || payload.items.length === 0) {
    return json({ ok: false, error: 'Invalid order payload' }, 400);
  }

  return forwardAndRelay(appsScriptUrl, { source: 'website-order', payload }, '[submit-order]');
}

/* ---------- /api/submit-review ---------- */
async function handleSubmitReview(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    console.error('[submit-review] Falta APPS_SCRIPT_URL en variables de entorno');
    return json({ ok: false, error: 'Server misconfiguration: APPS_SCRIPT_URL missing' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'Invalid review payload (bad JSON)' }, 400);
  }

  const rating = Number(payload && payload.rating);
  const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!payload || !payload.product || !rating || rating < 1 || rating > 5 || !name) {
    return json({ ok: false, error: 'Invalid review payload' }, 400);
  }

  return forwardAndRelay(appsScriptUrl, { source: 'website-review', payload }, '[submit-review]');
}

async function forwardAndRelay(appsScriptUrl, body, logTag) {
  try {
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (err) {
      console.error(logTag + ' Apps Script returned non-JSON: ' + text.slice(0, 300));
      return json({ ok: false, error: 'Google Apps Script returned an unexpected response' }, 502);
    }

    if (!response.ok || result.ok === false) {
      console.error(logTag + ' Apps Script error: ' + JSON.stringify(result));
      return json({ ok: false, error: result.error || ('Google Apps Script returned HTTP ' + response.status) }, 502);
    }

    return json(result, 200);
  } catch (err) {
    console.error(logTag + ' Fetch to Apps Script failed: ' + String(err));
    return json({ ok: false, error: 'Could not reach Google Apps Script' }, 502);
  }
}

/* ---------- /api/telegram-webhook ---------- */
async function handleTelegramWebhook(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token');
    if (receivedSecret !== expectedSecret) {
      console.error('[telegram-webhook] Invalid or missing secret token');
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!appsScriptUrl || !botToken) {
    console.error('[telegram-webhook] Falta APPS_SCRIPT_URL o TELEGRAM_BOT_TOKEN en variables de entorno');
    return new Response('ok', { status: 200 });
  }

  let update;
  try {
    update = await request.json();
  } catch (err) {
    console.error('[telegram-webhook] Invalid JSON from Telegram: ' + String(err));
    return new Response('ok', { status: 200 });
  }

  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, appsScriptUrl, botToken);
    } else if (update.message && update.message.reply_to_message) {
      await handleReplyMessage(update.message, appsScriptUrl, botToken);
    }
  } catch (err) {
    console.error('[telegram-webhook] Error handling update: ' + String(err));
  }

  return new Response('ok', { status: 200 });
}

async function handleCallbackQuery(callbackQuery, appsScriptUrl, botToken) {
  const data = callbackQuery.data || '';
  const chatId = callbackQuery.message.chat.id;
  const parts = data.split(':');
  const action = parts[0];
  const orderId = parts[1];

  await answerCallbackQuery(botToken, callbackQuery.id);

  if (action === 'priceother') {
    await sendTelegramMessage(botToken, chatId, 'Escribe el delivery para ' + orderId + ' (un monto como 8, o una nota como "Coordinar por WhatsApp"):', {
      force_reply: true
    });
    return;
  }

  const body = { source: 'netlify-telegram', action: action, orderId: orderId };
  if (parts[2] !== undefined) body.value = parts[2];

  const result = await forwardToAppsScript(appsScriptUrl, body);
  if (!result || result.ok === false) {
    await sendTelegramMessage(botToken, chatId, '⚠️ Error procesando la acción: ' + (result && result.error), null);
  }
}

async function handleReplyMessage(message, appsScriptUrl, botToken) {
  const originalText = message.reply_to_message.text || '';
  const match = originalText.match(/para (O-\d+)/);
  if (!match) return;

  const orderId = match[1];
  const value = (message.text || '').trim();
  const chatId = message.chat.id;

  const result = await forwardToAppsScript(appsScriptUrl, {
    source: 'netlify-telegram',
    action: 'delivery_price',
    orderId: orderId,
    value: value
  });

  if (!result || result.ok === false) {
    await sendTelegramMessage(botToken, chatId, 'No se pudo registrar el monto: ' + (result && result.error), null);
  }
}

async function forwardToAppsScript(appsScriptUrl, body) {
  try {
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    return JSON.parse(text);
  } catch (err) {
    console.error('[telegram-webhook] forwardToAppsScript failed: ' + String(err));
    return { ok: false, error: 'Could not reach Google Apps Script' };
  }
}

async function sendTelegramMessage(botToken, chatId, text, replyMarkup) {
  const params = new URLSearchParams();
  params.set('chat_id', String(chatId));
  params.set('text', text);
  if (replyMarkup) params.set('reply_markup', JSON.stringify(replyMarkup));

  await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
}

async function answerCallbackQuery(botToken, callbackQueryId, text) {
  const params = new URLSearchParams();
  params.set('callback_query_id', callbackQueryId);
  if (text) params.set('text', text);

  await fetch('https://api.telegram.org/bot' + botToken + '/answerCallbackQuery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
}
