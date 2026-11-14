// Cloudflare Worker: sirve el sitio estático (vía ASSETS) y maneja las rutas /api/* con la
// misma lógica que las funciones de Netlify (netlify/functions/*.js) — reenvían a Google Apps
// Script para guardar pedidos y reseñas, y procesan el webhook de Telegram.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/submit-order') {
      const blocked = await guardPublicApi(request, env.ORDER_LIMITER, 'submit-order');
      return blocked || handleSubmitOrder(request, env);
    }
    if (url.pathname === '/api/submit-review') {
      const blocked = await guardPublicApi(request, env.API_LIMITER, 'submit-review');
      return blocked || handleSubmitReview(request, env);
    }
    if (url.pathname === '/api/get-reviews') {
      const blocked = await guardPublicApi(request, env.API_LIMITER, 'get-reviews');
      return blocked || handleGetReviews(request, env);
    }
    if (url.pathname === '/api/check-welcome-coupon') {
      const blocked = await guardPublicApi(request, env.API_LIMITER, 'check-welcome-coupon');
      return blocked || handleCheckWelcomeCoupon(request, env);
    }
    if (url.pathname === '/api/telegram-webhook') {
      return handleTelegramWebhook(request, env);
    }
    if (url.pathname.indexOf('/api/panel/') === 0) {
      return handlePanel(request, env, url, ctx);
    }
    if (url.pathname === '/panel' || url.pathname === '/panel/') {
      return Response.redirect(new URL('/panel.html', url).toString(), 302);
    }
    if (url.pathname === '/panel.html' || url.pathname.indexOf('/panel/') === 0) {
      // El panel no se indexa (el contenido de los pedidos igual solo sale por /api/panel, con código).
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      return new Response(asset.body, { status: asset.status, headers: headers });
    }
    if (url.pathname === '/api/calculadora') {
      const blocked = await guardPublicApi(request, env.API_LIMITER, 'calculadora');
      return blocked || handleCalculadora(request, env);
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
  },

  // Tareas programadas (solo con Supabase): el recordatorio de pedidos pendientes (lunes y viernes) y, cada hora,
  // el envío a GA4 de las ventas confirmadas que no se hayan mandado (red de seguridad).
  async scheduled(event, env, ctx) {
    if (!usaSupabase(env)) return;
    if (RECORDATORIO_CRONS.indexOf(event.cron) !== -1) ctx.waitUntil(enviarRecordatorioPedidos(env, false));
    else ctx.waitUntil(sincronizarVentasGa4(env));
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
   Si el Worker no tiene la base, responde 503 y la
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

/* ---------- Protección contra pedidos falsos / abuso ----------
   Cada llamada a Apps Script cuesta cuota de Google y cada pedido escribe
   en la hoja y manda un Telegram, así que /api/* público necesita freno.
   Capas: (1) el envío tiene que venir de nuestro propio sitio, (2) límite
   por IP con el rate limiter de Cloudflare, (3) el pedido se valida con
   topes razonables antes de reenviarlo. Un cliente real nunca queda sin
   poder comprar: el checkout manda el pedido en segundo plano (sendBeacon)
   y abre WhatsApp aparte, así que aunque este filtro rechace algo, el
   mensaje de WhatsApp le llega igual al negocio. */

const MAX_BODY_CHARS = 32000;
const MAX_ORDER_ITEMS = 40;
const MAX_ITEM_QUANTITY = 99;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// Un navegador siempre manda Origin en un POST. Si viene y no es nuestro
// propio host (prod, www, workers.dev o localhost), alguien está llamando
// la API desde otra página. Sin Origin (curl, apps) no se bloquea acá: eso
// lo frena el límite por IP y la validación.
function isForeignOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch (err) {
    return true;
  }
}

// Devuelve una Response si hay que cortar la petición, o null si pasa.
// Si el limitador no está configurado (pruebas locales) o falla, deja pasar:
// es peor perder un pedido real que dejar pasar uno falso.
async function guardPublicApi(request, limiter, route) {
  if (request.method !== 'POST') return null; // los handlers ya devuelven 405
  if (isForeignOrigin(request)) {
    console.error('[' + route + '] Origin ajeno rechazado: ' + request.headers.get('Origin'));
    return json({ ok: false, error: 'Forbidden' }, 403);
  }
  if (!limiter) return null;
  try {
    const result = await limiter.limit({ key: route + ':' + clientIp(request) });
    if (!result.success) {
      console.error('[' + route + '] Límite de peticiones excedido para ' + clientIp(request));
      const res = json({ ok: false, error: 'Too many requests' }, 429);
      res.headers.set('Retry-After', '60');
      return res;
    }
  } catch (err) {
    console.error('[' + route + '] El limitador falló, se deja pasar: ' + String(err));
  }
  return null;
}

async function readJsonBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return { tooLarge: true };
  return { payload: JSON.parse(raw) };
}

function isText(value, min, max) {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max;
}

function isOptionalText(value, max) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= max);
}

function isNumberBetween(value, min, max) {
  return typeof value === 'number' && isFinite(value) && value >= min && value <= max;
}

// Devuelve el motivo del rechazo, o null si el pedido es plausible. Los
// topes son holgados (direcciones largas, pedidos de 24 unidades ya
// ocurrieron): el objetivo es cortar basura y pedidos absurdos, no
// ajustar al centavo.
function validateOrder(order) {
  if (!order || typeof order !== 'object') return 'payload no es un objeto';
  if (!isText(order.customerName, 2, 100)) return 'customerName inválido';
  const phoneDigits = typeof order.phone === 'string' ? order.phone.replace(/\D/g, '') : '';
  if (phoneDigits.length < 7 || phoneDigits.length > 15 || order.phone.length > 30) return 'phone inválido';
  if (!isText(order.location, 1, 1500)) return 'location inválido';
  if (!isOptionalText(order.deliveryType, 30)) return 'deliveryType inválido';
  if (!isOptionalText(order.state, 60)) return 'state inválido';
  if (!isOptionalText(order.ci, 30)) return 'ci inválido';
  if (!isOptionalText(order.mrwAddress, 1500)) return 'mrwAddress inválido';
  if (!isOptionalText(order.gaClientId, 60)) return 'gaClientId inválido';
  if (!isOptionalText(order.gaSessionId, 30)) return 'gaSessionId inválido';
  if (order.total !== undefined && !isNumberBetween(order.total, 0, 10000)) return 'total inválido';

  if (!Array.isArray(order.items) || order.items.length === 0 || order.items.length > MAX_ORDER_ITEMS) {
    return 'items inválidos';
  }
  for (const item of order.items) {
    if (!item || typeof item !== 'object') return 'item inválido';
    if (!isText(item.product, 1, 200)) return 'item.product inválido';
    if (!isOptionalText(item.brand, 60)) return 'item.brand inválido';
    if (!isNumberBetween(item.unitPrice, 0, 1000)) return 'item.unitPrice inválido';
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
      return 'item.quantity inválido';
    }
  }
  return null;
}

/* ---------- /api/submit-order ---------- */
async function handleSubmitOrder(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  if (!appsScriptUrl && !usaSupabase(env)) {
    console.error('[submit-order] Falta APPS_SCRIPT_URL en variables de entorno');
    return json({ ok: false, error: 'Server misconfiguration: APPS_SCRIPT_URL missing' }, 500);
  }

  let payload;
  try {
    const body = await readJsonBody(request);
    if (body.tooLarge) return json({ ok: false, error: 'Payload too large' }, 413);
    payload = body.payload;
  } catch (err) {
    return json({ ok: false, error: 'Invalid order payload (bad JSON)' }, 400);
  }

  const invalid = validateOrder(payload);
  if (invalid) {
    console.error('[submit-order] Pedido rechazado: ' + invalid);
    return json({ ok: false, error: 'Invalid order payload' }, 400);
  }

  if (usaSupabase(env)) return crearPedidoSupabase(env, payload);
  return forwardAndRelay(appsScriptUrl, { source: 'website-order', payload }, '[submit-order]');
}

/* ---------- /api/submit-review ---------- */
async function handleSubmitReview(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  if (!appsScriptUrl && !usaSupabase(env)) {
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

  if (usaSupabase(env)) return resenaSupabase(env, payload);
  return forwardAndRelay(appsScriptUrl, { source: 'website-review', payload }, '[submit-review]');
}

/* ---------- /api/get-reviews ----------
   Consulta de solo lectura: devuelve las reseñas ya guardadas para un
   producto, para mostrarlas en la ficha (antes solo se podían escribir,
   nunca se mostraban las que ya existían). */
async function handleGetReviews(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  if (!appsScriptUrl && !usaSupabase(env)) {
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
  if (usaSupabase(env)) return listarResenasSupabase(env, product);
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
  if (!appsScriptUrl && !usaSupabase(env)) {
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

  if (usaSupabase(env)) return cuponSupabase(env, name, phone);
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

/* ---------- Supabase: el lugar donde viven los pedidos (reemplaza a Apps Script y a la hoja) ----------
   Variables: SUPABASE_URL y SUPABASE_KEY (llave pública, van en wrangler.jsonc), SUPABASE_RPC_TOKEN (secreto: el código
   que abre las funciones tienda_* de la base), PEDIDOS_BACKEND = "supabase" para encenderlo (cualquier otro valor usa el
   Apps Script de siempre), y para GA4: GA4_API_SECRET (secreto), GA4_MEASUREMENT_ID, GA4_DEBUG ("1" = solo validar).
   La base asigna el número de pedido (OC), guarda el pedido como Pending y, al confirmarlo en el panel, pasa a venta. */
function usaSupabase(env) {
  return env.PEDIDOS_BACKEND === 'supabase' && !!env.SUPABASE_URL && !!env.SUPABASE_KEY && !!env.SUPABASE_RPC_TOKEN;
}

async function supabaseRpc(env, fn, args) {
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, 12000);
  try {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'apikey': env.SUPABASE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ p_token: env.SUPABASE_RPC_TOKEN }, args || {})),
      signal: ctl.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 200));
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

async function crearPedidoSupabase(env, o) {
  try {
    const r = await supabaseRpc(env, 'tienda_crear_pedido', { p_pedido: {
      cliente: o.customerName, telefono: o.phone, zona: o.location, estado_geo: o.state || '', ci: o.ci || '', agencia_mrw: o.mrwAddress || '',
      ga_client_id: o.gaClientId || '', ga_session_id: o.gaSessionId || '',
      items: o.items.map(function (i) { return { product: i.product, brand: i.brand || '', unitPrice: i.unitPrice, quantity: i.quantity }; })
    } });
    if (!r || r.ok !== true) {
      console.error('[submit-order] Supabase rechazó el pedido: ' + JSON.stringify(r));
      return json({ ok: false, error: (r && r.error) || 'Could not save order' }, 502);
    }
    return json({ ok: true, orderId: r.orderId }, 200);
  } catch (err) {
    console.error('[submit-order] Supabase falló: ' + String(err));
    return json({ ok: false, error: 'Could not reach the database' }, 502);
  }
}

async function resenaSupabase(env, payload) {
  try {
    const r = await supabaseRpc(env, 'tienda_resena_crear', { p_resena: { product: payload.product, brand: payload.brand || '', rating: Number(payload.rating), review: payload.review || '', name: payload.name, url: payload.url || '' } });
    return json(r && r.ok ? { ok: true } : { ok: false, error: 'Could not save review' }, r && r.ok ? 200 : 502);
  } catch (err) {
    console.error('[submit-review] Supabase falló: ' + String(err));
    return json({ ok: false, error: 'Could not reach the database' }, 502);
  }
}

async function listarResenasSupabase(env, product) {
  try {
    return json(await supabaseRpc(env, 'tienda_resenas_listar', { p_producto: product }), 200);
  } catch (err) {
    console.error('[get-reviews] Supabase falló: ' + String(err));
    return json({ ok: false, error: 'Could not reach the database' }, 502);
  }
}

async function cuponSupabase(env, name, phone) {
  try {
    const r = await supabaseRpc(env, 'tienda_cupon_elegible', { p_nombre: name, p_telefono: phone });
    return json(r, r && r.ok ? 200 : 400);
  } catch (err) {
    // Si la base no responde, no se le niega el descuento a nadie (el sitio ya trata este caso como "elegible").
    console.error('[check-welcome-coupon] Supabase falló: ' + String(err));
    return json({ ok: false, error: 'Could not reach the database' }, 502);
  }
}

/* ---------- GA4: venta confirmada = evento "purchase" (Measurement Protocol) ----------
   Mismas reglas que tenía el Apps Script: un purchase por pedido (la base lo "reclama" y nadie más lo manda), fechado el
   día en que el cliente pidió si es reciente (GA4 acepta hasta 72 h), con la sesión y fuente del visitante si se guardaron;
   si no, un identificador anónimo derivado del teléfono (o del nombre). Los teléfonos del equipo no identifican a nadie. */
const GA4_TELEFONOS_EQUIPO = ['4141742967'];
const GA4_MAX_ATRASO_MS = 70 * 60 * 60 * 1000;

function sinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function telefonoIdentifica(env, phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 10) return false;
  const extra = String(env.GA4_SHARED_PHONES || '').split(',').map(function (x) { return x.replace(/\D/g, '').slice(-10); }).filter(Boolean);
  return GA4_TELEFONOS_EQUIPO.concat(extra).indexOf(d.slice(-10)) === -1;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function ga4ClientIdAnonimo(env, phone, name) {
  const digits = telefonoIdentifica(env, phone) ? String(phone).replace(/\D/g, '').slice(-10) : '';
  const key = digits ? 'tel:' + digits : 'nombre:' + sinTildes(name).trim();
  if (key === 'nombre:') return '';
  return 'apex.' + (await sha256Hex('apex-ga4:' + key)).slice(0, 20);
}

// d = datos del pedido que devuelve tienda_ga4_reclamar. Devuelve el cuerpo del purchase, o null si no hay cómo identificar al cliente.
async function ga4CuerpoCompra(env, d, nowMs) {
  const clientId = String(d.clientId || '').trim() || await ga4ClientIdAnonimo(env, d.telefono, d.cliente);
  if (!clientId) return null;
  let value = 0;
  const items = (d.items || []).map(function (it) {
    const price = Number(it.precio) || 0;
    const quantity = Number(it.cantidad) || 1;
    value += price * quantity;
    const item = { item_name: String(it.producto || ''), item_brand: String(it.marca || ''), item_category: String(it.categoria || ''), price: Math.round(price * 100) / 100, quantity: quantity };
    if (it.subcategoria) item.item_category2 = String(it.subcategoria);
    return item;
  });
  const params = { transaction_id: String(d.oc), value: Math.round(value * 100) / 100, currency: 'USD', items: items, engagement_time_msec: 1 };
  const delivery = String(d.entrega || '');
  if (delivery.indexOf('$') !== -1) { const n = parseFloat(delivery.replace(/[^0-9.\-]/g, '')); if (n > 0) params.shipping = n; }
  if (d.sessionId) params.session_id = String(d.sessionId);
  const body = { client_id: clientId, events: [{ name: 'purchase', params: params }] };
  const orderMs = Number(d.createdMs);
  const now = nowMs || Date.now();
  if (orderMs > 0 && orderMs <= now && now - orderMs <= GA4_MAX_ATRASO_MS) body.timestamp_micros = String(Math.round(orderMs) * 1000);
  return body;
}

// Manda UNA venta a GA4. Nunca lanza error ni toca la respuesta del panel: un fallo se anota y la revisión de cada hora reintenta.
async function enviarCompraGa4(env, oc) {
  if (!env.GA4_API_SECRET) { console.error('[ga4] Falta GA4_API_SECRET: la venta ' + oc + ' queda pendiente de enviar'); return; }
  let datos = null;
  try {
    datos = await supabaseRpc(env, 'tienda_ga4_reclamar', { p_oc: oc });
    if (!datos) return;   // ya se había enviado, o el pedido no está confirmado
    const body = await ga4CuerpoCompra(env, datos);
    const debug = env.GA4_DEBUG === '1';
    let enviada = false;
    if (!body) {
      console.error('[ga4] Pedido ' + oc + ' sin forma de identificar al cliente');
    } else {
      const url = 'https://www.google-analytics.com/' + (debug ? 'debug/mp/collect' : 'mp/collect') + '?measurement_id=' + encodeURIComponent(env.GA4_MEASUREMENT_ID || 'G-CKJ8VQSLLE') + '&api_secret=' + encodeURIComponent(env.GA4_API_SECRET);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) console.error('[ga4] Pedido ' + oc + ' HTTP ' + res.status);
      else if (debug) console.log('[ga4 debug] ' + oc + ' ' + (await res.text()).slice(0, 400));
      enviada = res.ok && !debug;   // en modo depuración Google no registra nada: la venta sigue pendiente
    }
    if (!enviada) await supabaseRpc(env, 'tienda_ga4_liberar', { p_oc: oc });
  } catch (err) {
    console.error('[ga4] Pedido ' + oc + ' falló: ' + String(err));
    if (datos) { try { await supabaseRpc(env, 'tienda_ga4_liberar', { p_oc: oc }); } catch (e) { /* se reintenta en la próxima revisión */ } }
  }
}

async function sincronizarVentasGa4(env) {
  try {
    const pendientes = await supabaseRpc(env, 'tienda_ga4_pendientes', {});
    for (const oc of (pendientes || []).slice(0, 50)) await enviarCompraGa4(env, oc);
  } catch (err) {
    console.error('[ga4] La revisión de ventas sin enviar falló: ' + String(err));
  }
}

/* ---------- Recordatorio por correo: pedidos pendientes por cerrar ----------
   Lunes 8:00 a.m. y viernes 4:00 p.m. (hora de Caracas = UTC-4; cada uno con un reintento una hora después, que solo actúa si el
   primero falló). Manda un correo con los pedidos sin confirmar y los confirmados sin entrega cerrada, SOLO si hay alguno.
   Se manda con Resend (secreto RESEND_API_KEY; remitente en RECORDATORIO_DESDE, por defecto recordatorio@apexnutricionve.com).
   El destinatario vive en la base (tienda.config, clave "recordatorio_para"), no en el código: este repositorio es público.
   Cada envío queda anotado en tienda.recordatorios_enviados (enviado / omitido / error) y nunca se repite el mismo día. */
const RECORDATORIO_CRONS = ['0 12 * * 1', '0 13 * * 1', '0 20 * * 5', '0 21 * * 5'];
const RECORDATORIO_PANEL_URL = 'https://apexnutricionve.com/panel';

function escHtml(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function esperaLegible(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return 'hace ' + min + ' min';
  if (min < 1440) return 'hace ' + Math.floor(min / 60) + ' h';
  const d = Math.floor(min / 1440);
  return 'hace ' + d + (d === 1 ? ' día' : ' días');
}

function armarCorreoPendientes(pend, ahoraMs, prueba) {
  const nuevos = pend.filter(function (o) { return o.stage === 'new'; });
  const entrega = pend.filter(function (o) { return o.stage !== 'new'; });
  const dinero = function (n) { return '$' + Number(n).toFixed(2).replace('.', ','); };
  const falta = function (o) { return o.stage === 'delivery' ? 'Falta indicar cómo se entregó' : 'Falta el monto del delivery'; };
  const asunto = (prueba ? '[PRUEBA] ' : '') + 'Apex: ' + (pend.length ? pend.length + (pend.length === 1 ? ' pedido pendiente' : ' pedidos pendientes') + ' por cerrar' : 'no hay pedidos pendientes');
  const tdb = 'padding:8px 10px;border-bottom:1px solid #E4DFD5';
  const tabla = function (titulo, arr, tercera) {
    if (!arr.length) return '';
    return '<h3 style="margin:22px 0 6px;font-size:16px">' + titulo + ' (' + arr.length + ')</h3>' +
      '<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#F7F5F1;text-align:left"><th style="padding:8px 10px">Pedido</th><th style="padding:8px 10px">Cliente</th><th style="padding:8px 10px;text-align:right">Total</th><th style="padding:8px 10px">Estado</th></tr></thead><tbody>' +
      arr.map(function (o) {
        return '<tr><td style="' + tdb + ';font-weight:700">' + escHtml(o.id) + '</td><td style="' + tdb + '">' + escHtml(o.customer || '(sin nombre)') + '</td><td style="' + tdb + ';text-align:right">' + dinero(o.total) + '</td><td style="' + tdb + ';color:#514D48">' + escHtml(tercera(o)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  };
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#14120F;max-width:640px">' +
    '<h2 style="margin:0 0 4px;font-size:20px">Pedidos pendientes por cerrar</h2>' +
    '<p style="margin:0 0 8px;color:#514D48">' + (pend.length ? 'Estos pedidos siguen sin cerrar en el panel.' : 'No hay pedidos pendientes. Todo está al día.') + '</p>' +
    tabla('Sin confirmar', nuevos, function (o) { return esperaLegible(ahoraMs - o.createdMs); }) +
    tabla('Confirmados, falta cerrar la entrega', entrega, function (o) { return falta(o) + ' · ' + esperaLegible(ahoraMs - o.createdMs); }) +
    '<p style="margin:24px 0"><a href="' + RECORDATORIO_PANEL_URL + '" style="background:#14120F;color:#fff;padding:12px 20px;text-decoration:none;font-weight:700">Abrir el panel de pedidos</a></p>' +
    '<p style="font-size:12px;color:#726E67">Este recordatorio se envía los lunes y los viernes, solo si hay pedidos pendientes.</p></div>';
  const lineas = function (arr, tercera) { return arr.map(function (o) { return '- ' + o.id + ' · ' + (o.customer || '(sin nombre)') + ' · ' + dinero(o.total) + ' · ' + tercera(o); }).join('\n'); };
  const text = 'Pedidos pendientes por cerrar\n\n' +
    (nuevos.length ? 'SIN CONFIRMAR (' + nuevos.length + ')\n' + lineas(nuevos, function (o) { return esperaLegible(ahoraMs - o.createdMs); }) + '\n\n' : '') +
    (entrega.length ? 'CONFIRMADOS, FALTA CERRAR LA ENTREGA (' + entrega.length + ')\n' + lineas(entrega, function (o) { return falta(o) + ' · ' + esperaLegible(ahoraMs - o.createdMs); }) + '\n\n' : '') +
    (pend.length ? '' : 'No hay pedidos pendientes. Todo está al día.\n\n') + 'Panel: ' + RECORDATORIO_PANEL_URL;
  return { subject: asunto, html: html, text: text };
}

// prueba = true: manda el correo ya mismo aunque no haya pendientes, con "[PRUEBA]" en el asunto (botón del panel).
async function enviarRecordatorioPedidos(env, prueba) {
  if (!usaSupabase(env)) return { estado: 'omitido', detalle: 'Supabase apagado' };
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const clave = prueba ? 'prueba:' + Date.now() : 'rec:' + hoy;
  try {
    if (!(await supabaseRpc(env, 'tienda_recordatorio_iniciar', { p_clave: clave, p_tipo: prueba ? 'prueba' : 'semanal' }))) return { estado: 'omitido', detalle: 'ya se envió hoy' };
    let estado = 'error', pendientes = null, detalle = '';
    try {
      if (!env.RESEND_API_KEY) {
        detalle = 'Falta RESEND_API_KEY';
      } else {
        const lista = await supabaseRpc(env, 'tienda_panel_listar', {});
        const pend = (lista.orders || []).filter(function (o) { return o.stage !== 'done'; }).sort(function (a, b) { return a.createdMs - b.createdMs; });
        pendientes = pend.length;
        if (!pend.length && !prueba) {
          estado = 'omitido'; detalle = 'sin pendientes';
        } else {
          const para = String(await supabaseRpc(env, 'tienda_recordatorio_destino', {}) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
          if (!para.length) throw new Error('No hay destinatario guardado');
          const correo = armarCorreoPendientes(pend, lista.now, prueba);
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: env.RECORDATORIO_DESDE || 'Apex Nutrición <recordatorio@apexnutricionve.com>', to: para, subject: correo.subject, html: correo.html, text: correo.text })
          });
          if (res.ok) { estado = 'enviado'; detalle = 'ok'; } else { detalle = 'Resend HTTP ' + res.status + ' ' + (await res.text()).slice(0, 150); }
        }
      }
    } catch (err) {
      detalle = String(err).slice(0, 200);
    }
    await supabaseRpc(env, 'tienda_recordatorio_cerrar', { p_clave: clave, p_estado: estado, p_pendientes: pendientes, p_detalle: detalle });
    if (estado === 'error') console.error('[recordatorio] ' + detalle);
    return { estado: estado, pendientes: pendientes, detalle: detalle };
  } catch (err) {
    console.error('[recordatorio] falló: ' + String(err));
    return { estado: 'error', detalle: String(err).slice(0, 200) };
  }
}

/* ---------- Panel de pedidos (panel.html) ----------
   Reemplaza a los botones de Telegram: la persona que recibe los pedidos entra con un código compartido y ve
   los pedidos por etapa. Este Worker es el único que habla con Apps Script (con PANEL_APPS_KEY); el navegador
   nunca ve esa clave ni la dirección de Apps Script.
   Variables del Worker (secretas): PANEL_CODE (el código que se escribe para entrar) y PANEL_APPS_KEY (la misma
   clave que PANEL_API_KEY en Apps Script). Sin ellas el panel responde 503 y no se expone nada.
   Sesión: cookie firmada (HMAC con el propio código) que dura 14 días. Si se cambia PANEL_CODE, todas las
   sesiones abiertas dejan de valer. Intentos de entrada: los limita guardPublicApi (5 por minuto por IP). */
const PANEL_COOKIE = 'apex_panel';
const PANEL_SESSION_SECONDS = 14 * 24 * 3600;
const PANEL_ACTIONS = ['completed', 'canceled', 'pickup', 'delivery', 'delivery_price'];
const PANEL_LIST_CACHE_MS = 4000;   // varias pantallas abiertas comparten la misma lectura de la hoja
let panelListCache = null;          // { t, orders }

function panelJson(body, status) {
  const res = json(body, status);
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('X-Robots-Tag', 'noindex');
  return res;
}

async function hmacBase64Url(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  let bin = '';
  for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Compara dos textos sin que el tiempo delate en qué letra difieren (se comparan sus firmas).
async function safeEqual(a, b) {
  const pair = await Promise.all([hmacBase64Url('apex-panel-compare', String(a)), hmacBase64Url('apex-panel-compare', String(b))]);
  let diff = pair[0].length ^ pair[1].length;
  for (let i = 0; i < pair[0].length && i < pair[1].length; i++) diff |= pair[0].charCodeAt(i) ^ pair[1].charCodeAt(i);
  return diff === 0;
}

async function panelMakeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + PANEL_SESSION_SECONDS;
  return exp + '.' + await hmacBase64Url(env.PANEL_CODE + '|apex-panel-session', String(exp));
}

async function panelIsAuthed(request, env) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + PANEL_COOKIE + '=([^;]+)'));
  if (!match) return false;
  const parts = match[1].split('.');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !parts[1]) return false;
  if (Number(parts[0]) < Date.now() / 1000) return false;
  return safeEqual(parts[1], await hmacBase64Url(env.PANEL_CODE + '|apex-panel-session', parts[0]));
}

function panelCookie(value, maxAge) {
  return PANEL_COOKIE + '=' + value + '; Path=/api/panel; Max-Age=' + maxAge + '; HttpOnly; Secure; SameSite=Strict';
}

async function handlePanel(request, env, url, ctx) {
  if (!env.PANEL_CODE || (!usaSupabase(env) && (!env.PANEL_APPS_KEY || !env.APPS_SCRIPT_URL))) {
    console.error('[panel] Faltan PANEL_CODE (y PANEL_APPS_KEY + APPS_SCRIPT_URL si no se usa Supabase) en las variables del Worker');
    return panelJson({ ok: false, error: 'Panel not configured' }, 503);
  }
  const route = url.pathname.slice('/api/panel/'.length);

  if (route === 'login') {
    if (request.method !== 'POST') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const blocked = await guardPublicApi(request, env.ORDER_LIMITER, 'panel-login');
    if (blocked) { blocked.headers.set('Cache-Control', 'no-store'); return blocked; }
    let code = '';
    try {
      const body = await readJsonBody(request);
      code = body.payload && typeof body.payload.code === 'string' ? body.payload.code : '';
    } catch (err) { /* código vacío: falla abajo */ }
    if (!code || code.length > 200 || !(await safeEqual(code, env.PANEL_CODE))) {
      console.error('[panel] Código incorrecto desde ' + clientIp(request));
      return panelJson({ ok: false, error: 'Unauthorized' }, 401);
    }
    const res = panelJson({ ok: true });
    res.headers.append('Set-Cookie', panelCookie(await panelMakeToken(env), PANEL_SESSION_SECONDS));
    return res;
  }

  if (route === 'logout') {
    if (request.method !== 'POST') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const res = panelJson({ ok: true });
    res.headers.append('Set-Cookie', panelCookie('', 0));
    return res;
  }

  if (!(await panelIsAuthed(request, env))) return panelJson({ ok: false, error: 'Unauthorized' }, 401);

  if (route === 'orders') {
    if (request.method !== 'GET') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    if (panelListCache && Date.now() - panelListCache.t < PANEL_LIST_CACHE_MS) {
      return panelJson({ ok: true, now: Date.now(), orders: panelListCache.orders });
    }
    let result;
    if (usaSupabase(env)) {
      try { result = await supabaseRpc(env, 'tienda_panel_listar', {}); } catch (err) { console.error('[panel] Supabase (listar): ' + String(err)); result = { ok: false, error: 'No se pudo leer los pedidos' }; }
    } else {
      result = await forwardToAppsScript(env.APPS_SCRIPT_URL, { source: 'panel-list', key: env.PANEL_APPS_KEY });
    }
    if (!result || result.ok !== true || !Array.isArray(result.orders)) {
      console.error('[panel] No se pudo leer la hoja: ' + (result && result.error));
      return panelJson({ ok: false, error: 'No se pudo leer los pedidos. Intenta otra vez.' }, 502);
    }
    panelListCache = { t: Date.now(), orders: result.orders };
    return panelJson({ ok: true, now: Date.now(), orders: result.orders });
  }

  if (route === 'recordatorio-prueba') {
    if (request.method !== 'POST') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const blocked = await guardPublicApi(request, env.API_LIMITER, 'panel-recordatorio-prueba');
    if (blocked) { blocked.headers.set('Cache-Control', 'no-store'); return blocked; }
    const r = await enviarRecordatorioPedidos(env, true);
    return panelJson({ ok: r.estado === 'enviado', estado: r.estado, pendientes: r.pendientes === undefined ? null : r.pendientes, error: r.estado === 'enviado' ? undefined : (r.detalle || 'No se pudo enviar') }, r.estado === 'enviado' ? 200 : 502);
  }

  if (route === 'action') {
    if (request.method !== 'POST') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const blocked = await guardPublicApi(request, env.API_LIMITER, 'panel-action');
    if (blocked) { blocked.headers.set('Cache-Control', 'no-store'); return blocked; }
    let body;
    try { body = (await readJsonBody(request)).payload; } catch (err) { return panelJson({ ok: false, error: 'Bad JSON' }, 400); }
    const orderId = body && typeof body.orderId === 'string' ? body.orderId : '';
    const action = body && body.action;
    const value = body && typeof body.value === 'string' ? body.value.trim() : null;
    if (!/^\d{1,8}$/.test(orderId)) return panelJson({ ok: false, error: 'Número de pedido inválido' }, 400);
    if (PANEL_ACTIONS.indexOf(action) === -1) return panelJson({ ok: false, error: 'Acción no permitida' }, 400);
    if (action === 'delivery_price' && (!value || value.length > 80)) return panelJson({ ok: false, error: 'Escribe el monto del delivery (o una nota corta).' }, 400);
    panelListCache = null;
    let result;
    if (usaSupabase(env)) {
      try {
        result = await supabaseRpc(env, 'tienda_panel_accion', { p_oc: orderId, p_accion: action, p_valor: action === 'delivery_price' ? value : null });
      } catch (err) {
        console.error('[panel] Supabase (acción ' + action + '): ' + String(err));
        result = { ok: false, error: 'No se pudo guardar. Intenta otra vez.' };
      }
      // Pedido confirmado = venta: se manda a GA4 (en segundo plano; un fallo no afecta al panel).
      if (result && result.ok === true && action === 'completed' && result.enviar_ga4) {
        const envio = enviarCompraGa4(env, orderId);
        if (ctx && ctx.waitUntil) ctx.waitUntil(envio); else await envio;
      }
    } else {
      result = await forwardToAppsScript(env.APPS_SCRIPT_URL, {
        source: 'panel-action', key: env.PANEL_APPS_KEY, action: action, orderId: orderId, value: action === 'delivery_price' ? value : null
      });
    }
    panelListCache = null;
    if (!result || result.ok !== true) {
      console.error('[panel] Acción ' + action + ' en ' + orderId + ' falló: ' + (result && result.error));
      return panelJson({ ok: false, error: (result && result.error) || 'No se pudo guardar. Intenta otra vez.' }, 400);
    }
    return panelJson({ ok: true });
  }

  return panelJson({ ok: false, error: 'Not found' }, 404);
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
