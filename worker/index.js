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
    if (url.pathname === '/api/get-reviews') {
      return handleGetReviews(request, env);
    }
    if (url.pathname === '/api/check-welcome-coupon') {
      return handleCheckWelcomeCoupon(request, env);
    }
    if (url.pathname === '/api/telegram-webhook') {
      return handleTelegramWebhook(request, env);
    }
    if (url.pathname === '/api/calculadora') {
      return handleCalculadora(request, env);
    }

    // La raíz del dominio ("/") no se resuelve sola a index.html porque
    // html_handling está en "none" (para que los links internos con .html
    // explícito no sufran redirecciones). La resolvemos a mano acá.
    if (url.pathname === '/') {
      const indexUrl = new URL(request.url);
      indexUrl.pathname = '/index.html';
      return marcarSitioPrueba(await env.ASSETS.fetch(new Request(indexUrl, request)), env);
    }

    // Todo lo demás: archivos estáticos del sitio (HTML, CSS, JS, imágenes).
    return marcarSitioPrueba(await env.ASSETS.fetch(request), env);
  }
};

/* ---------- Sitio de prueba (prueba.apexnutricionve.com) ----------
   Solo si el Worker tiene SITIO_PRUEBA (wrangler.prueba.jsonc): cada página
   muestra una franja de aviso y el botón "Comprar" del carrito queda
   desactivado, para que nadie mande un pedido real por WhatsApp desde la
   prueba. En el sitio real (sin SITIO_PRUEBA) las páginas salen intactas. */
const PRUEBA_FRANJA =
  '<div role="note" style="background:#FBF3DD;color:#14120F;border-bottom:1px solid #E4DFD5;padding:10px 16px;font:600 13px/1.4 Inter,sans-serif;text-align:center">' +
  'Sitio de prueba: no hagas pedidos aquí. Para comprar, entra a <a href="https://apexnutricionve.com" style="color:#14120F;text-decoration:underline">apexnutricionve.com</a>.</div>';

async function marcarSitioPrueba(response, env) {
  if (!env.SITIO_PRUEBA) return response;
  const type = response.headers.get('Content-Type') || '';
  if (!type.includes('text/html') || response.status !== 200) return response;
  const html = (await response.text())
    .replace('<body>', '<body>' + PRUEBA_FRANJA)
    .replace('id="checkout-whatsapp">Comprar</button>', 'id="checkout-whatsapp" disabled>Pedidos desactivados (prueba)</button>');
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(html, { status: response.status, headers: headers });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/* ---------- /api/calculadora ----------
   Guarda las respuestas de la calculadora (calculadora.html) en la base D1
   "CALC_DB", solo si el usuario marcó la casilla de consentimiento. No se
   guarda nombre, correo ni teléfono: solo un identificador anónimo de la
   visita y, si APEX se lo dio, un código de atleta (ej. ATL-03).
   Si el Worker no tiene la base (el sitio principal hoy), responde 503 y la
   calculadora sigue funcionando igual. La tabla se crea sola la primera vez. */
const CALC_TIPOS = ['plan', 'kit', 'pack'];
const CALC_MAX_BYTES = 16000;
let calcTableReady = false;

async function handleCalculadora(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!env.CALC_DB) return json({ ok: false, error: 'Storage not configured' }, 503);

  const text = await request.text();
  if (text.length > CALC_MAX_BYTES) return json({ ok: false, error: 'Payload too large' }, 413);
  let p;
  try { p = JSON.parse(text); } catch (err) { return json({ ok: false, error: 'Bad JSON' }, 400); }

  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (!p || p.consent !== true) return json({ ok: false, error: 'Consent required' }, 400);
  if (typeof p.sesion !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(p.sesion)) return json({ ok: false, error: 'Invalid sesion' }, 400);
  if (CALC_TIPOS.indexOf(p.tipo) === -1) return json({ ok: false, error: 'Invalid tipo' }, 400);
  if (!isObj(p.respuestas) || !isObj(p.resultado)) return json({ ok: false, error: 'Invalid payload' }, 400);
  const codigo = typeof p.codigo === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(p.codigo) ? p.codigo.toUpperCase() : null;
  const version = typeof p.version === 'string' ? p.version.slice(0, 40) : null;

  try {
    if (!calcTableReady) {
      await env.CALC_DB.prepare(
        'CREATE TABLE IF NOT EXISTS calculadora_respuestas (' +
        'n INTEGER PRIMARY KEY AUTOINCREMENT, creado TEXT NOT NULL, sesion TEXT NOT NULL, tipo TEXT NOT NULL, ' +
        'codigo_atleta TEXT, version TEXT, respuestas TEXT NOT NULL, resultado TEXT NOT NULL)'
      ).run();
      calcTableReady = true;
    }
    await env.CALC_DB.prepare(
      'INSERT INTO calculadora_respuestas (creado, sesion, tipo, codigo_atleta, version, respuestas, resultado) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(new Date().toISOString(), p.sesion, p.tipo, codigo, version, JSON.stringify(p.respuestas), JSON.stringify(p.resultado)).run();
  } catch (err) {
    console.error('[calculadora] No se pudo guardar: ' + err);
    return json({ ok: false, error: 'Storage error' }, 500);
  }
  return json({ ok: true });
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

/* ---------- /api/get-reviews ----------
   Consulta de solo lectura: devuelve las reseñas ya guardadas para un
   producto, para mostrarlas en la ficha (antes solo se podían escribir,
   nunca se mostraban las que ya existían). */
async function handleGetReviews(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    console.error('[get-reviews] Falta APPS_SCRIPT_URL en variables de entorno');
    return json({ ok: false, error: 'Server misconfiguration: APPS_SCRIPT_URL missing' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    payload = {};
  }

  const product = payload && typeof payload.product === 'string' ? payload.product.trim() : '';
  return forwardAndRelay(appsScriptUrl, { source: 'get-reviews', payload: { product: product } }, '[get-reviews]');
}

/* ---------- /api/check-welcome-coupon ----------
   Consulta de solo lectura: cruza nombre + teléfono contra pedidos
   anteriores en la hoja para decidir si el código de bienvenida (10% en la
   primera compra) es válido para esta persona. No escribe nada ni manda
   Telegram — es independiente del flujo de registrar un pedido. */
async function handleCheckWelcomeCoupon(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    console.error('[check-welcome-coupon] Falta APPS_SCRIPT_URL en variables de entorno');
    return json({ ok: false, error: 'Server misconfiguration: APPS_SCRIPT_URL missing' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'Invalid payload (bad JSON)' }, 400);
  }

  const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
  const phone = payload && typeof payload.phone === 'string' ? payload.phone.trim() : '';
  if (!name || !phone) {
    return json({ ok: false, error: 'Missing name or phone' }, 400);
  }

  return forwardAndRelay(appsScriptUrl, { source: 'check-welcome-coupon', payload: { name, phone } }, '[check-welcome-coupon]');
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
  const messageId = callbackQuery.message.message_id;
  const parts = data.split(':');
  const action = parts[0];
  const orderId = parts[1];

  await answerCallbackQuery(botToken, callbackQuery.id);

  // Le quita los botones a ESTE mensaje apenas se presiona uno, para que no se
  // pueda volver a tocar (ni ese ni el otro botón del mismo mensaje) y así
  // evitar reprocesar la orden y que se sigan mandando mensajes sobre algo
  // que ya fue resuelto. Si falla (mensaje muy viejo, etc.) no debe frenar el
  // resto de la acción, por eso va en su propio try/catch.
  try {
    await stripInlineKeyboard(botToken, chatId, messageId);
  } catch (err) {
    console.error('[telegram-webhook] stripInlineKeyboard failed: ' + String(err));
  }

  // 'priceother' también se maneja igual que las demás acciones: Apps Script
  // es quien decide qué texto/botones va en el mensaje único de la orden (y,
  // para este caso puntual, también manda el mensaje aparte con force_reply
  // pidiendo el monto, porque Telegram no permite pedir texto libre editando
  // un mensaje existente).
  const body = { source: 'netlify-telegram', action: action, orderId: orderId };
  if (parts[2] !== undefined) body.value = parts[2];

  const result = await forwardToAppsScript(appsScriptUrl, body);
  if (!result || result.ok === false) {
    await sendTelegramMessage(botToken, chatId, '⚠️ Error procesando la acción: ' + (result && result.error), null);
  }
}

async function handleReplyMessage(message, appsScriptUrl, botToken) {
  const originalText = message.reply_to_message.text || '';
  const match = originalText.match(/para (\S+)/);
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
    return;
  }

  // Limpieza: borra el mensaje "Escribe el delivery para..." ya que cumplió
  // su propósito. Así el chat no va acumulando prompts viejos y queda un
  // solo mensaje vivo por orden.
  try {
    await deleteTelegramMessage(botToken, chatId, message.reply_to_message.message_id);
  } catch (err) {
    console.error('[telegram-webhook] deleteTelegramMessage failed: ' + String(err));
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

async function deleteTelegramMessage(botToken, chatId, messageId) {
  const params = new URLSearchParams();
  params.set('chat_id', String(chatId));
  params.set('message_id', String(messageId));

  await fetch('https://api.telegram.org/bot' + botToken + '/deleteMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
}

async function stripInlineKeyboard(botToken, chatId, messageId) {
  const params = new URLSearchParams();
  params.set('chat_id', String(chatId));
  params.set('message_id', String(messageId));
  params.set('reply_markup', JSON.stringify({ inline_keyboard: [] }));

  await fetch('https://api.telegram.org/bot' + botToken + '/editMessageReplyMarkup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
}
