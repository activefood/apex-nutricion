// Cloudflare Worker: sirve el sitio estático (vía ASSETS) y maneja las rutas /api/*. Los pedidos, las reseñas,
// el cupón, el panel de pedidos y las promos viven en Supabase (ya no hay Google Apps Script ni Telegram).

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
    if (url.pathname === '/api/suscripcion/vista') {
      const blocked = await guardPublicApi(request, env.API_LIMITER, 'suscripcion-vista');
      return blocked || handleSuscripcionVista(request, env);
    }
    if (url.pathname === '/api/suscripcion/baja') {
      return handleSuscripcionBaja(request, env, url);
    }
    if (url.pathname === '/api/newsletter' || url.pathname === '/api/suscribir') {
      const blocked = await guardPublicApi(request, env.API_LIMITER, 'newsletter');
      return blocked || handleNewsletter(request, env, ctx);
    }
    if (url.pathname === '/api/promos') {
      return handlePromos(request, env);
    }
    if (url.pathname.indexOf('/api/panel/') === 0) {
      return handlePanel(request, env, url, ctx);
    }
    if (url.pathname.indexOf('/api/marketing/') === 0) {
      return handleMarketing(request, env, url);
    }
    if (url.pathname === '/marketing' || url.pathname === '/marketing/') {
      return Response.redirect(new URL('/marketing.html', url).toString(), 302);
    }
    if (url.pathname === '/marketing.html' || url.pathname.indexOf('/marketing/') === 0) {
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      return new Response(asset.body, { status: asset.status, headers: headers });
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
    else {
      ctx.waitUntil(sincronizarVentasGa4(env));
      ctx.waitUntil(vigilarBlackFriday(env));
      ctx.waitUntil(sincronizarMarketing(env, false));
      ctx.waitUntil(sincronizarInstagram(env, false));
      ctx.waitUntil(completarHistorialInstagram(env));
      ctx.waitUntil(relacionarPedidos(env));
      ctx.waitUntil(enviarAvisosNewsletter(env, false));
    }
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
   Cada pedido escribe en la base de datos, así que /api/* público necesita freno.
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

  if (!usaSupabase(env)) {
    console.error('[submit-order] Supabase no está configurado (PEDIDOS_BACKEND, SUPABASE_URL, SUPABASE_KEY, SUPABASE_RPC_TOKEN)');
    return json({ ok: false, error: 'Server misconfiguration: database not configured' }, 500);
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

  return crearPedidoSupabase(env, payload);
}

/* ---------- /api/submit-review ---------- */
async function handleSubmitReview(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  if (!usaSupabase(env)) {
    console.error('[submit-review] Supabase no está configurado (PEDIDOS_BACKEND, SUPABASE_URL, SUPABASE_KEY, SUPABASE_RPC_TOKEN)');
    return json({ ok: false, error: 'Server misconfiguration: database not configured' }, 500);
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

  return resenaSupabase(env, payload);
}

/* ---------- /api/newsletter ----------
   Suscripción al newsletter de Apex (formulario del inicio). Guarda solo el correo en Supabase (marketing.newsletter).
   Al cliente siempre se le responde igual (haya o no estado suscrito antes) y el campo oculto "website" atrapa robots. */
async function handleNewsletter(request, env, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!usaSupabase(env)) {
    console.error('[newsletter] Supabase no está configurado');
    return json({ ok: false, error: 'No se pudo guardar. Intenta otra vez.' }, 500);
  }
  let body;
  try { body = (await readJsonBody(request)).payload; } catch (err) { return json({ ok: false, error: 'Datos inválidos' }, 400); }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'Datos inválidos' }, 400);
  if (typeof body.website === 'string' && body.website.trim() !== '') return json({ ok: true });   // robot: se hace como si hubiera salido bien
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return json({ ok: false, error: 'Escribe un correo válido.' }, 400);
  try {
    const r = await supabaseRpc(env, 'newsletter_suscribir', { p_email: email, p_origen: 'inicio' });
    if (!r || r.ok !== true) return json({ ok: false, error: (r && r.error === 'Correo inválido') ? 'Escribe un correo válido.' : 'No se pudo guardar. Intenta otra vez.' }, 400);
    // La clave solo se entrega cuando la suscripción es nueva: el navegador la recuerda para registrar lo que mira el suscriptor.
    if (r.clave) {   // suscripción nueva: bienvenida con el 5% (en segundo plano; un fallo no afecta a quien se suscribe)
      const envio = enviarBienvenida(env, email, r.clave);
      if (ctx && ctx.waitUntil) ctx.waitUntil(envio);
    }
    return json({ ok: true, clave: r.clave || undefined });
  } catch (err) {
    console.error('[newsletter] Supabase: ' + String(err));
    return json({ ok: false, error: 'No se pudo guardar. Intenta otra vez.' }, 502);
  }
}

/* ---------- Newsletter personalizado ----------
   Al suscribirse, el navegador recuerda una clave (no es el correo). Desde entonces, las páginas de producto que mira ese suscriptor se anotan
   (solo las suyas; de quien no se suscribió no se guarda nada) y, a lo mucho una vez por semana, se le manda por correo el producto que más vio.
   Cada correo trae su enlace de baja. Los avisos están APAGADOS hasta que la variable NEWSLETTER_AVISOS valga "on" (wrangler.jsonc).
   Remitente: NEWSLETTER_DESDE (por defecto Apex Nutrición <hola@apexnutricionve.com>). Secreto de envío: RESEND_API_KEY (el mismo de los recordatorios). */
const SITIO = 'https://apexnutricionve.com';
const NEWSLETTER_HORA_UTC = 14;   // 10:00 en Caracas
const NEWS_CODIGO = 'APEX5';       // código del 5% del correo de bienvenida (debe ser el mismo que NEWS_COUPON_CODE en app.js)
// Productos que no se anuncian por estar agotados (ruta o nombre).
const AVISO_AGOTADO = [/proteina-tarro[^"]*flavor=vainilla/i, /vainilla[^"]*600/i, /600[^"]*vainilla/i];

async function handleSuscripcionVista(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!usaSupabase(env)) return json({ ok: false }, 500);
  let b;
  try { b = (await readJsonBody(request)).payload; } catch (err) { return json({ ok: false }, 400); }
  if (!b || typeof b.c !== 'string' || typeof b.ruta !== 'string') return json({ ok: false }, 400);
  try {
    await supabaseRpc(env, 'newsletter_registrar_vista', { p_clave: b.c, p_ruta: b.ruta.slice(0, 220), p_titulo: typeof b.titulo === 'string' ? b.titulo.slice(0, 200) : null, p_imagen: typeof b.imagen === 'string' ? b.imagen.slice(0, 260) : null });
  } catch (err) { console.error('[suscripcion] vista: ' + String(err)); return json({ ok: false }, 502); }
  return json({ ok: true });
}

function paginaSimple(titulo, cuerpo) {
  const h = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + titulo + ' · Apex Nutrición</title></head>' +
    '<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#F7F5F1;color:#14120F"><main style="max-width:480px;margin:12vh auto;padding:0 20px">' +
    '<p style="font:700 12px monospace;letter-spacing:.2em;text-transform:uppercase;color:#726E67;margin:0 0 12px">Apex Nutrición</p><h1 style="font-size:28px;margin:0 0 12px">' + titulo + '</h1>' + cuerpo +
    '<p style="margin-top:28px"><a href="' + SITIO + '" style="color:#14120F;font-weight:700">Volver a la tienda</a></p></main></body></html>';
  return new Response(h, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

// Enlace de baja de cada correo: GET muestra el botón de confirmar (así un programa que "visita" el enlace no da de baja a nadie); POST da de baja
// (también sirve para el botón "darse de baja" del propio correo, List-Unsubscribe-Post).
async function handleSuscripcionBaja(request, env, url) {
  const clave = url.searchParams.get('c') || '';
  if (!/^[0-9a-f]{32}$/.test(clave)) return paginaSimple('Enlace no válido', '<p>Este enlace de baja no es válido. Si quieres dejar de recibir correos, escríbenos por WhatsApp.</p>');
  if (request.method === 'GET') {
    return paginaSimple('¿Quieres darte de baja?', '<p style="line-height:1.5">Dejarás de recibir los correos del newsletter de Apex Nutrición.</p>' +
      '<form method="post" action="/api/suscripcion/baja?c=' + clave + '"><button type="submit" style="min-height:52px;padding:0 24px;border:2px solid #14120F;background:#14120F;color:#fff;font:800 15px Arial;letter-spacing:.04em;text-transform:uppercase;cursor:pointer">Sí, darme de baja</button></form>');
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  try {
    if (env.API_LIMITER) { const lim = await env.API_LIMITER.limit({ key: 'baja:' + clientIp(request) }); if (!lim.success) return json({ ok: false, error: 'Too many requests' }, 429); }
  } catch (err) { /* sin limitador: sigue */ }
  if (!usaSupabase(env)) return json({ ok: false }, 500);
  try { await supabaseRpc(env, 'newsletter_baja', { p_clave: clave }); }
  catch (err) { console.error('[suscripcion] baja: ' + String(err)); return paginaSimple('No se pudo', '<p>No pudimos procesar tu baja ahora. Intenta de nuevo en unos minutos o escríbenos por WhatsApp.</p>'); }
  const accept = request.headers.get('Accept') || '';
  if (accept.indexOf('text/html') === -1) return json({ ok: true });
  return paginaSimple('Listo, ya no te escribiremos', '<p style="line-height:1.5">Te diste de baja del newsletter de Apex Nutrición. Si fue un error, puedes volver a suscribirte en la tienda cuando quieras.</p>');
}

function htmlEscapar(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Estilos compartidos de los correos del newsletter (HTML sencillo, a prueba de lectores de correo).
const CORREO_ABRE = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px 16px;color:#14120F"><p style="margin:0 0 6px;font:700 11px monospace;letter-spacing:.2em;text-transform:uppercase;color:#726E67">Apex Nutrición</p>';
function correoPie(baja) {
  return '<hr style="border:0;border-top:1px solid #E4DFD5;margin:24px 0 12px"><p style="margin:0;font-size:12px;line-height:1.5;color:#726E67">Recibes este correo porque te suscribiste al newsletter de Apex en apexnutricionve.com. <a href="' + baja + '" style="color:#726E67">Darme de baja</a>.</p></div>';
}
function enlaceSitio(ruta, campana) {
  const sep = String(ruta).indexOf('?') === -1 ? '?' : '&';
  return SITIO + ruta + sep + 'utm_source=newsletter&utm_medium=email&utm_campaign=' + campana;
}

// Correo de la semana: hasta 4 productos (los que más interesaron a ese suscriptor), presentados como "los productos estrella de la semana".
// No dice que los haya mirado.
function correoProductosSemana(items, clave, prueba) {
  const lista = items.slice(0, 4);
  const baja = SITIO + '/api/suscripcion/baja?c=' + clave;
  const tarjetas = lista.map(function (it) {
    const titulo = String(it.titulo || '').trim() || 'Ver en la tienda';
    const enlace = enlaceSitio(it.ruta, 'productos_semana');
    const imagen = it.imagen && /^https:\/\/apexnutricionve\.com\//.test(it.imagen) ? it.imagen : null;
    return '<tr><td style="padding:14px 0;border-top:1px solid #E4DFD5"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      (imagen ? '<td width="116" valign="middle" style="padding-right:14px"><a href="' + enlace + '"><img src="' + htmlEscapar(imagen) + '" alt="' + htmlEscapar(titulo) + '" width="104" style="display:block;width:104px;height:auto;border:1px solid #E4DFD5;background:#fff"></a></td>' : '') +
      '<td valign="middle"><p style="margin:0 0 10px;font-size:16px;line-height:1.3;font-weight:700">' + htmlEscapar(titulo) + '</p>' +
      '<a href="' + enlace + '" style="display:inline-block;background:#14120F;color:#fff;padding:10px 16px;text-decoration:none;font-weight:700;font-size:14px">' + (/^\/(categoria|marca)/.test(String(it.ruta)) ? 'Ver todos' : 'Ver producto') + '</a></td></tr></table></td></tr>';
  }).join('');
  const html = CORREO_ABRE + '<h1 style="margin:0 0 10px;font-size:26px;line-height:1.15">Los productos estrella de la semana</h1>' +
    '<p style="margin:0 0 18px;font-size:16px;line-height:1.5">Aquí te enviamos una selección de productos de Apex Nutrición para esta semana. Despacho al instante en Caracas y por MRW o Zoom al resto del país.</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + tarjetas + '<tr><td style="border-top:1px solid #E4DFD5;font-size:0;line-height:0">&nbsp;</td></tr></table>' +
    '<p style="margin:18px 0 0"><a href="' + enlaceSitio('/', 'productos_semana') + '" style="color:#14120F;font-weight:700">Ver toda la tienda</a></p>' + correoPie(baja);
  const texto = 'Los productos estrella de la semana\n\nAquí te enviamos una selección de productos de Apex Nutrición para esta semana.\n\n' +
    lista.map(function (it) { return (String(it.titulo || '').trim() || 'Ver en la tienda') + ': ' + enlaceSitio(it.ruta, 'productos_semana'); }).join('\n') +
    '\n\nToda la tienda: ' + SITIO + '\n\n--\nRecibes este correo porque te suscribiste al newsletter de Apex. Darme de baja: ' + baja;
  return { asunto: (prueba ? '[PRUEBA] ' : '') + 'Los productos estrella de la semana en Apex', html: html, texto: texto, baja: baja };
}

// Correo de bienvenida: el código del 5% (APEX5 en el carrito; app.js).
function correoBienvenida(clave, prueba) {
  const baja = SITIO + '/api/suscripcion/baja?c=' + clave;
  const enlace = SITIO + '/?utm_source=newsletter&utm_medium=email&utm_campaign=bienvenida';
  const html = CORREO_ABRE + '<h1 style="margin:0 0 10px;font-size:26px;line-height:1.15">Bienvenido al newsletter de Apex</h1>' +
    '<p style="margin:0 0 18px;font-size:16px;line-height:1.5">Gracias por suscribirte. Aquí tienes tu <b>5% de descuento</b> en tu compra:</p>' +
    '<p style="margin:0 0 18px;text-align:center"><span style="display:inline-block;border:2px dashed #14120F;background:#F7F5F1;padding:14px 28px;font:800 28px monospace;letter-spacing:.14em">' + NEWS_CODIGO + '</span></p>' +
    '<p style="margin:0 0 6px;font-size:15px;line-height:1.5"><b>Cómo usarlo:</b> agrega tus productos al carrito, escribe el código en "Código de descuento" y toca Aplicar.</p>' +
    '<p style="margin:0 0 22px;font-size:13px;line-height:1.5;color:#514D48">Se usa una vez y no se suma a otras promociones (Black Friday, Cyber Monday, precios por cantidad ni el 10% de primera compra).</p>' +
    '<p style="margin:0"><a href="' + enlace + '" style="display:inline-block;background:#14120F;color:#fff;padding:14px 22px;text-decoration:none;font-weight:700">Ir a la tienda</a></p>' +
    '<p style="margin:18px 0 0;font-size:14px;color:#514D48">También te escribiremos con ofertas, lanzamientos y los productos estrella de la semana.</p>' + correoPie(baja);
  const texto = 'Bienvenido al newsletter de Apex\n\nGracias por suscribirte. Aquí tienes tu 5% de descuento en tu compra: ' + NEWS_CODIGO + '\n\nCómo usarlo: agrega tus productos al carrito, escribe el código en "Código de descuento" y toca Aplicar. Se usa una vez y no se suma a otras promociones (Black Friday, Cyber Monday, precios por cantidad ni el 10% de primera compra).\n\nIr a la tienda: ' + enlace + '\n\n--\nRecibes este correo porque te suscribiste al newsletter de Apex. Darme de baja: ' + baja;
  return { asunto: (prueba ? '[PRUEBA] ' : '') + 'Bienvenido a Apex: aquí está tu 5% de descuento', html: html, texto: texto, baja: baja };
}

// Bienvenida automática al suscribirse (solo a suscripciones nuevas). Un fallo se anota y no afecta a quien se suscribió.
async function enviarBienvenida(env, email, clave) {
  try {
    if (!env.RESEND_API_KEY) { console.error('[newsletter] bienvenida omitida: falta RESEND_API_KEY'); return; }
    await enviarCorreoNewsletter(env, email, correoBienvenida(clave, false));
    await supabaseRpc(env, 'newsletter_marcar_envio', { p_email: email, p_ruta: '/', p_estado: 'enviado', p_detalle: null, p_tipo: 'bienvenida' });
  } catch (err) {
    console.error('[newsletter] bienvenida: ' + String(err));
    try { await supabaseRpc(env, 'newsletter_marcar_envio', { p_email: email, p_ruta: '/', p_estado: 'error', p_detalle: String(err).slice(0, 200), p_tipo: 'bienvenida' }); } catch (e2) { /* sin registro */ }
  }
}

async function enviarCorreoNewsletter(env, para, c) {
  if (!env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.NEWSLETTER_DESDE || 'Apex Nutrición <hola@apexnutricionve.com>', to: [para], subject: c.asunto, html: c.html, text: c.texto,
      headers: { 'List-Unsubscribe': '<' + c.baja + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
  });
  if (!res.ok) throw new Error('Resend HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
}

// Envío diario (10:00 Caracas, desde la revisión horaria). Sin NEWSLETTER_AVISOS="on" no manda nada. A cada suscriptor, un solo correo con hasta 4 productos (los que más le interesaron), como "productos estrella de la semana".
async function enviarAvisosNewsletter(env, forzar) {
  try {
    if (!usaSupabase(env)) return { omitido: 'sin base' };
    if (env.NEWSLETTER_AVISOS !== 'on') return { omitido: 'avisos apagados' };
    const ahora = new Date();
    if (!forzar && (ahora.getUTCHours() !== NEWSLETTER_HORA_UTC || ahora.getUTCMinutes() > 30)) return { omitido: 'no es la hora' };
    const lista = await supabaseRpc(env, 'newsletter_candidatos', { p_limite: 40 });
    let enviados = 0, fallos = 0;
    for (const c of (Array.isArray(lista) ? lista : [])) {
      const vistas = (c.vistas || []).filter(function (v) { return !AVISO_AGOTADO.some(function (re) { return re.test(String(v.ruta) + ' ' + String(v.titulo || '')); }); });
      if (!vistas.length) continue;
      const item = vistas[0];
      try {
        await enviarCorreoNewsletter(env, c.email, correoProductosSemana(vistas, c.clave, false));
        await supabaseRpc(env, 'newsletter_marcar_envio', { p_email: c.email, p_ruta: item.ruta, p_estado: 'enviado', p_detalle: null });
        enviados++;
      } catch (err) {
        fallos++;
        console.error('[newsletter] envío: ' + String(err));
        try { await supabaseRpc(env, 'newsletter_marcar_envio', { p_email: c.email, p_ruta: item.ruta, p_estado: 'error', p_detalle: String(err).slice(0, 200) }); } catch (e2) { /* sin registro */ }
      }
    }
    return { enviados: enviados, fallos: fallos };
  } catch (err) {
    console.error('[newsletter] avisos: ' + String(err));
    return { error: true };
  }
}

/* ---------- /api/get-reviews ----------
   Consulta de solo lectura: devuelve las reseñas ya guardadas para un
   producto, para mostrarlas en la ficha (antes solo se podían escribir,
   nunca se mostraban las que ya existían). */
async function handleGetReviews(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  if (!usaSupabase(env)) {
    console.error('[get-reviews] Supabase no está configurado (PEDIDOS_BACKEND, SUPABASE_URL, SUPABASE_KEY, SUPABASE_RPC_TOKEN)');
    return json({ ok: false, error: 'Server misconfiguration: database not configured' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    payload = {};
  }

  const product = payload && typeof payload.product === 'string' ? payload.product.trim() : '';
  return listarResenasSupabase(env, product);
}

/* ---------- /api/check-welcome-coupon ----------
   Consulta de solo lectura: cruza nombre + teléfono contra pedidos
   anteriores en la base de datos para decidir si el código de bienvenida (10% en la
   primera compra) es válido para esta persona. No escribe nada:
   es independiente del flujo de registrar un pedido. */
async function handleCheckWelcomeCoupon(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  if (!usaSupabase(env)) {
    console.error('[check-welcome-coupon] Supabase no está configurado (PEDIDOS_BACKEND, SUPABASE_URL, SUPABASE_KEY, SUPABASE_RPC_TOKEN)');
    return json({ ok: false, error: 'Server misconfiguration: database not configured' }, 500);
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

  return cuponSupabase(env, name, phone);
}

/* ---------- Supabase: el lugar donde viven los pedidos ----------
   Variables: SUPABASE_URL y SUPABASE_KEY (llave pública, van en wrangler.jsonc), SUPABASE_RPC_TOKEN (secreto: el código
   que abre las funciones tienda_* de la base), PEDIDOS_BACKEND = "supabase" (obligatorio: ya no existe otro
   respaldo), y para GA4: GA4_API_SECRET (secreto), GA4_MEASUREMENT_ID, GA4_DEBUG ("1" = solo validar).
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
   Reglas: un purchase por pedido (la base lo "reclama" y nadie más lo manda), fechado el
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

// Manda a GA4 el reembolso (refund) de una venta cancelada. Nunca lanza error ni toca la respuesta del panel.
async function enviarReembolsoGa4(env, r) {
  if (!env.GA4_API_SECRET) { console.error('[ga4] Falta GA4_API_SECRET: el reembolso de ' + (r && r.oc) + ' no se mandó'); return; }
  try {
    const clientId = String(r.clientId || '').trim() || await ga4ClientIdAnonimo(env, r.telefono, r.cliente);
    if (!clientId) { console.error('[ga4] Reembolso ' + r.oc + ' sin forma de identificar al cliente'); return; }
    const body = { client_id: clientId, events: [{ name: 'refund', params: { transaction_id: String(r.oc), value: Math.round((Number(r.total) || 0) * 100) / 100, currency: 'USD', engagement_time_msec: 1 } }] };
    const url = 'https://www.google-analytics.com/mp/collect?measurement_id=' + encodeURIComponent(env.GA4_MEASUREMENT_ID || 'G-CKJ8VQSLLE') + '&api_secret=' + encodeURIComponent(env.GA4_API_SECRET);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) console.error('[ga4] Reembolso ' + r.oc + ' HTTP ' + res.status);
  } catch (err) {
    console.error('[ga4] Reembolso ' + (r && r.oc) + ' falló: ' + String(err));
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
// En Cloudflare el día de la semana cuenta desde 1 = domingo (no desde lunes): por eso se escribe con nombre (MON, FRI), no con número.
const RECORDATORIO_CRONS = ['0 12 * * MON', '0 13 * * MON', '0 20 * * FRI', '0 21 * * FRI'];
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

/* ---------- Vigilancia de Black Friday 2026 (23 al 29 de nov) ----------
   Cada hora (el mismo cron de GA4) revisa los pedidos nuevos con productos de la oferta y manda un correo a los mismos
   destinatarios del recordatorio: 1) cuando entra el PRIMER pedido con algún producto de Black Friday (diga si los precios
   quedaron bien o no); 2) cuando un pedido posterior trae un precio que no cuadra. Solo lee: nunca cambia pedidos.
   El correo no lleva nombres ni teléfonos, solo número de pedido, productos y montos. Cada aviso se anota en
   tienda.recordatorios_enviados con clave "bf:..." (tipo "semanal") y no se repite. Los precios esperados son los de app.js
   (BF_RATE = 0.25): proteína chocolate 600 g $24,00; Skratch bolsa 440 g $26,66; hidratante $1,2075 por sobre con 24 o más. */
const BF_PEDIDOS_DESDE_MS = Date.parse('2026-11-23T04:00:00Z');   // 23 nov 00:00, Caracas
const BF_PEDIDOS_HASTA_MS = Date.parse('2026-11-30T04:00:00Z');   // fin del 29 nov, Caracas
const BF_VIGILAR_HASTA_MS = Date.parse('2026-12-02T04:00:00Z');   // deja de consultar pasado el 1 de dic

function bfUsd(n) { return '$' + Number(n).toFixed(2).replace('.', ','); }

// Devuelve { hayBf, ok, lineas: [{ texto, ok }] } para un pedido del panel (o.items: { product, brand, qty, price }).
function bfRevisarPedido(o) {
  const items = o.items || [];
  const lineas = [];
  const sobres = items.filter(function (i) { return /hidratante/i.test(i.product) && !/300\s*g/i.test(i.product) && Number(i.price) < 10; });
  const sobresTotal = sobres.reduce(function (a, i) { return a + Number(i.qty); }, 0);
  const revisa = function (i, nombre, esperado, tol) {
    const real = Number(i.price);
    const ok = Math.abs(real - esperado) <= tol;
    lineas.push({ ok: ok, texto: nombre + ' × ' + i.qty + ': ' + (ok ? 'precio ' + bfUsd(real) + ' (con 25% OFF)' : 'precio ' + real.toFixed(4).replace('.', ',') + ', se esperaba ' + esperado.toFixed(4).replace('.', ',') + ' (25% OFF)') });
  };
  items.forEach(function (i) {
    const nombre = String(i.product || '');
    if (/prote[ií]na en polvo chocolate/i.test(nombre) && !/sobre/i.test(nombre) && (/600\s*g/i.test(nombre) || Number(i.price) >= 20)) revisa(i, 'Proteína chocolate 600 g', 24, 0.01);
    else if (/skratch/i.test(nombre + ' ' + (i.brand || '')) && /bolsa/i.test(nombre) && /440/.test(nombre)) revisa(i, nombre.replace(/Sport Hydration Drink Mix\s*/i, 'Skratch bolsa ').replace(/\s*—.*$/, ''), 26.6625, 0.01);
    else if (sobresTotal >= 24 && sobres.indexOf(i) !== -1) revisa(i, nombre.replace(/\s*Going$/i, '') + ' (caja de ' + sobresTotal + ')', 38.64 / 24 * 0.75, 0.005);
  });
  return { hayBf: lineas.length > 0, ok: lineas.every(function (l) { return l.ok; }), lineas: lineas };
}

function bfArmarCorreo(o, rev, primero) {
  const estado = rev.ok ? 'todo bien' : 'REVISAR PRECIOS';
  const asunto = 'Black Friday: ' + (primero ? 'primer pedido con oferta' : 'pedido con precio distinto') + ' (' + o.id + ') — ' + estado;
  const fecha = new Date(o.createdMs).toLocaleString('es-VE', { timeZone: 'America/Caracas', dateStyle: 'medium', timeStyle: 'short' });
  const filas = rev.lineas.map(function (l) { return '<li style="margin:4px 0;color:' + (l.ok ? '#14120F' : '#B3261E') + '">' + (l.ok ? '✓ ' : '✗ ') + escHtml(l.texto) + '</li>'; }).join('');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#14120F;max-width:640px">' +
    '<h2 style="margin:0 0 4px;font-size:20px">' + (primero ? 'Entró el primer pedido con Black Friday' : 'Un pedido de Black Friday trae un precio distinto') + '</h2>' +
    '<p style="margin:0 0 10px;color:#514D48">Pedido <strong>' + escHtml(o.id) + '</strong> · ' + escHtml(fecha) + ' (hora de Caracas) · total de productos ' + bfUsd(o.total) + '</p>' +
    '<p style="margin:0 0 6px;font-weight:700">' + (rev.ok ? 'Los precios de la oferta quedaron como deben.' : 'Algún precio de la oferta no coincide con lo esperado.') + '</p>' +
    '<ul style="padding-left:18px;margin:0 0 14px;font-size:14px">' + filas + '</ul>' +
    '<p style="margin:0 0 14px;font-size:14px;color:#514D48">Cuando lo confirmes en el panel, la venta pasa a GA4 sola (en menos de una hora).</p>' +
    '<p style="margin:18px 0"><a href="' + RECORDATORIO_PANEL_URL + '" style="background:#14120F;color:#fff;padding:12px 20px;text-decoration:none;font-weight:700">Abrir el panel de pedidos</a></p>' +
    '<p style="font-size:12px;color:#726E67">Aviso automático de Black Friday (23 al 29 de nov). Solo lee los pedidos; no cambia nada.</p></div>';
  const text = asunto + '\n\nPedido ' + o.id + ' · ' + fecha + ' · total de productos ' + bfUsd(o.total) + '\n' +
    rev.lineas.map(function (l) { return (l.ok ? '[ok] ' : '[REVISAR] ') + l.texto; }).join('\n') + '\n\nPanel: ' + RECORDATORIO_PANEL_URL;
  return { subject: asunto, html: html, text: text };
}

async function bfEnviarAviso(env, clave, correo) {
  if (!(await supabaseRpc(env, 'tienda_recordatorio_iniciar', { p_clave: clave, p_tipo: 'semanal' }))) return;
  let estado = 'error', detalle = '';
  try {
    if (!env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY');
    const para = String(await supabaseRpc(env, 'tienda_recordatorio_destino', {}) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!para.length) throw new Error('No hay destinatario guardado');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RECORDATORIO_DESDE || 'Apex Nutrición <recordatorio@apexnutricionve.com>', to: para, subject: correo.subject, html: correo.html, text: correo.text })
    });
    if (res.ok) { estado = 'enviado'; detalle = 'ok'; } else { detalle = 'Resend HTTP ' + res.status + ' ' + (await res.text()).slice(0, 150); }
  } catch (err) {
    detalle = String(err).slice(0, 200);
  }
  await supabaseRpc(env, 'tienda_recordatorio_cerrar', { p_clave: clave, p_estado: estado, p_pendientes: null, p_detalle: detalle });
  if (estado === 'error') console.error('[black-friday] ' + detalle);
}

async function vigilarBlackFriday(env) {
  const ahora = Date.now();
  if (ahora < BF_PEDIDOS_DESDE_MS || ahora > BF_VIGILAR_HASTA_MS) return;
  try {
    const lista = await supabaseRpc(env, 'tienda_panel_listar', {});
    const pedidos = (lista.orders || []).filter(function (o) { return o.createdMs >= BF_PEDIDOS_DESDE_MS && o.createdMs < BF_PEDIDOS_HASTA_MS; })
      .sort(function (a, b) { return a.createdMs - b.createdMs; });
    let primeroId = null;
    for (const o of pedidos) {
      const rev = bfRevisarPedido(o);
      if (!rev.hayBf) continue;
      if (primeroId === null) {
        primeroId = o.id;
        await bfEnviarAviso(env, 'bf:primero', bfArmarCorreo(o, rev, true));
      } else if (!rev.ok) {
        await bfEnviarAviso(env, 'bf:alerta:' + o.id, bfArmarCorreo(o, rev, false));
      }
    }
  } catch (err) {
    console.error('[black-friday] La revisión falló: ' + String(err));
  }
}

/* ---------- Pedidos relacionados ----------
   Un cliente cancela (o repite) un pedido y hace otro enseguida: la base enlaza cada pedido cancelado con el pedido del mismo cliente
   (mismo teléfono, o nombre y productos parecidos, en un rango de 72 horas) y lo guarda en tienda.pedido_relacion. Corre cada hora
   y al cancelar; es idempotente. Nunca lanza error. */
async function relacionarPedidos(env) {
  try {
    if (!usaSupabase(env)) return;
    const r = await supabaseRpc(env, 'tienda_relacionar_pedidos', {});
    if (!r || r.ok !== true) console.error('[pedidos] No se pudieron relacionar: ' + JSON.stringify(r).slice(0, 160));
  } catch (err) {
    console.error('[pedidos] Relacionar pedidos: ' + String(err));
  }
}

/* ---------- Panel de pedidos (panel.html) ----------
   La persona que recibe los pedidos entra con un código compartido y ve los pedidos por etapa. Este Worker es el único
   que habla con Supabase (con SUPABASE_RPC_TOKEN); el navegador nunca ve esas claves.
   Variable del Worker (secreta): PANEL_CODE (el código que se escribe para entrar). Sin ella el panel responde 503 y no se expone nada.
   Sesión: cookie firmada (HMAC con el propio código) que dura 14 días. Si se cambia PANEL_CODE, todas las
   sesiones abiertas dejan de valer. Intentos de entrada: los limita guardPublicApi (5 por minuto por IP). */
const PANEL_COOKIE = 'apex_panel';
const PANEL_SESSION_SECONDS = 14 * 24 * 3600;
const PANEL_ACTIONS = ['completed', 'canceled', 'pickup', 'delivery', 'delivery_price', 'confirm_delivery'];
const PANEL_LIST_CACHE_MS = 4000;   // varias pantallas abiertas comparten la misma lectura de la base
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
  if (!env.PANEL_CODE || !usaSupabase(env)) {
    console.error('[panel] Faltan PANEL_CODE o la configuración de Supabase en las variables del Worker');
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
    try { result = await supabaseRpc(env, 'tienda_panel_listar', {}); } catch (err) { console.error('[panel] Supabase (listar): ' + String(err)); result = { ok: false, error: 'No se pudo leer los pedidos' }; }
    if (!result || result.ok !== true || !Array.isArray(result.orders)) {
      console.error('[panel] No se pudo leer los pedidos: ' + (result && result.error));
      return panelJson({ ok: false, error: 'No se pudo leer los pedidos. Intenta otra vez.' }, 502);
    }
    panelListCache = { t: Date.now(), orders: result.orders };
    return panelJson({ ok: true, now: Date.now(), orders: result.orders });
  }

  // Tablero de ventas: totales, por día, por producto y marca, y comparación con otro periodo. Solo lectura.
  if (route === 'ventas') {
    if (request.method !== 'GET') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const q = url.searchParams;
    const fecha = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; };
    const hasta = fecha(q.get('hasta'));
    if (!hasta) return panelJson({ ok: false, error: 'Falta la fecha final.' }, 400);
    let r;
    try {
      r = await supabaseRpc(env, 'tienda_dashboard_ventas', { p_desde: fecha(q.get('desde')), p_hasta: hasta, p_cdesde: fecha(q.get('cdesde')), p_chasta: fecha(q.get('chasta')) });
    } catch (err) {
      console.error('[panel] Supabase (ventas): ' + String(err));
      return panelJson({ ok: false, error: 'No se pudieron leer las ventas. Intenta otra vez.' }, 502);
    }
    if (!r || r.ok !== true) return panelJson({ ok: false, error: (r && r.error) || 'No se pudieron leer las ventas.' }, 400);
    return panelJson(r);
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
    // Confirmar + registrar la entrega en un solo paso: tipo (delivery / pickup), quién paga y monto.
    // También sirve para cerrar la entrega de un pedido que ya estaba confirmado pero sin entrega.
    if (action === 'confirm_delivery') {
      const tipo = body && body.tipo;
      const paga = body && body.paga;
      if (tipo !== 'delivery' && tipo !== 'pickup') return panelJson({ ok: false, error: 'Elige Delivery o Pick up.' }, 400);
      if (tipo === 'delivery' && paga !== 'Cliente' && paga !== 'Tienda') return panelJson({ ok: false, error: 'Elige quién paga el delivery.' }, 400);
      if (tipo === 'delivery' && (!value || value.length > 80)) return panelJson({ ok: false, error: 'Escribe el monto del delivery (o una nota corta).' }, 400);
      panelListCache = null;
      let conf;
      try { conf = await supabaseRpc(env, 'tienda_panel_accion', { p_oc: orderId, p_accion: 'completed', p_valor: null }); }
      catch (err) { console.error('[panel] Supabase (confirmar): ' + String(err)); conf = { ok: false, error: 'No se pudo guardar. Intenta otra vez.' }; }
      if (!conf || conf.ok !== true) { panelListCache = null; return panelJson({ ok: false, error: (conf && conf.error) || 'No se pudo guardar. Intenta otra vez.' }, 400); }
      // Pedido confirmado = venta: se manda a GA4 en segundo plano (un fallo no afecta al panel).
      if (conf.enviar_ga4) {
        const envio = enviarCompraGa4(env, orderId);
        if (ctx && ctx.waitUntil) ctx.waitUntil(envio); else await envio;
      }
      let r;
      try { r = await supabaseRpc(env, 'tienda_panel_editar_entrega', { p_oc: orderId, p_tipo: tipo, p_paga: tipo === 'delivery' ? paga : null, p_valor: tipo === 'delivery' ? value : null }); }
      catch (err) { console.error('[panel] Supabase (entrega): ' + String(err)); r = { ok: false, error: 'No se pudo guardar la entrega.' }; }
      panelListCache = null;
      // Si la entrega falló, el pedido ya quedó confirmado y sigue en la lista pidiendo la entrega.
      if (!r || r.ok !== true) return panelJson({ ok: false, error: 'El pedido quedó confirmado, pero falta guardar la entrega: ' + ((r && r.error) || 'intenta otra vez.') }, 400);
      return panelJson({ ok: true });
    }
    panelListCache = null;
    let result;
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
    // Cancelar un pedido que ya era venta: GA4 recibe el reembolso para dejar de contarla.
    if (result && result.ok === true && action === 'canceled' && result.reembolso) {
      const rem = enviarReembolsoGa4(env, result.reembolso);
      if (ctx && ctx.waitUntil) ctx.waitUntil(rem); else await rem;
    }
    // Un pedido cancelado se enlaza enseguida con otro del mismo cliente (si lo hay), en segundo plano.
    if (result && result.ok === true && action === 'canceled') {
      const rel = relacionarPedidos(env);
      if (ctx && ctx.waitUntil) ctx.waitUntil(rel);
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

/* ---------- /api/promos: descuentos con fecha, leídos de la hoja de Google ----------
   La hoja "APEX - Cargar descuentos" (pestaña DESCUENTOS) se publica como CSV (Archivo > Compartir > Publicar en la web) y su
   dirección va en la variable PROMOS_CSV_URL (wrangler.jsonc). Solo se aceptan las filas con ESTADO = LISTO. El sitio (app.js) usa
   esta respuesta para calcular los descuentos del carrito, las etiquetas y la barra de anuncio. Sin la variable o con la hoja
   caída responde error y el sitio usa su última copia guardada. Solo lectura: nunca escribe nada. Sin datos de clientes. */
const PROMOS_CACHE_MS = 5 * 60 * 1000;
let promosCache = null;   // { t, promos }

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; } }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function promoFechaIso(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function promosDesdeCsv(text) {
  const rows = parseCsv(text);
  const start = rows.findIndex(function (r) { return /^1\.\s*Promoci/i.test(String(r[0] || '').trim()); });
  if (start < 0) throw new Error('No se encontró el encabezado de la hoja');
  const promos = [];
  const descartadas = [];
  rows.slice(start + 1).forEach(function (r) {
    if (!String(r[0] || '').trim()) return;
    if (String(r[7] || '').trim() !== 'LISTO') { descartadas.push(String(r[0]).trim() + ' / ' + String(r[1] || '').trim()); return; }
    const rate = Number(String(r[2] || '').replace('%', '').replace(',', '.').trim()) / 100;
    const desde = promoFechaIso(r[3]);
    const hasta = promoFechaIso(r[4]);
    const min = Math.max(1, Math.floor(Number(String(r[5] || '1').trim()) || 1));
    if (!(rate > 0 && rate <= 0.9) || !desde || !hasta || desde > hasta) { descartadas.push(String(r[0]).trim() + ' / ' + String(r[1] || '').trim()); return; }
    promos.push({
      nombre: String(r[0]).trim().slice(0, 60),
      producto: String(r[1] || '').trim().slice(0, 120),
      rate: Math.round(rate * 10000) / 10000,
      desde: desde,
      hasta: hasta,
      min: min,
      base: min > 1 ? 'caja' : 'normal'   // con caja (12, 24...) el % se calcula sobre el precio de la caja; con 1 unidad, sobre el normal
    });
  });
  return { promos: promos, descartadas: descartadas.length };
}

async function handlePromos(request, env) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (request.method !== 'GET') return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: headers });
  if (!env.PROMOS_CSV_URL) {
    headers['Cache-Control'] = 'no-store';
    return new Response(JSON.stringify({ ok: false, error: 'La hoja de descuentos todavía no está publicada' }), { status: 503, headers: headers });
  }
  if (promosCache && Date.now() - promosCache.t < PROMOS_CACHE_MS) {
    headers['Cache-Control'] = 'public, max-age=60';
    return new Response(JSON.stringify({ ok: true, promos: promosCache.promos, descartadas: promosCache.descartadas }), { headers: headers });
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(function () { ctl.abort(); }, 8000);
    let res;
    try { res = await fetch(env.PROMOS_CSV_URL, { signal: ctl.signal, redirect: 'follow' }); } finally { clearTimeout(timer); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const parsed = promosDesdeCsv(await res.text());
    promosCache = { t: Date.now(), promos: parsed.promos, descartadas: parsed.descartadas };
    headers['Cache-Control'] = 'public, max-age=60';
    return new Response(JSON.stringify({ ok: true, promos: parsed.promos, descartadas: parsed.descartadas }), { headers: headers });
  } catch (err) {
    console.error('[promos] ' + String(err));
    // Si la hoja falla pero hay una copia anterior en memoria, se entrega esa.
    if (promosCache) {
      headers['Cache-Control'] = 'no-store';
      return new Response(JSON.stringify({ ok: true, promos: promosCache.promos, descartadas: promosCache.descartadas, vieja: true }), { headers: headers });
    }
    headers['Cache-Control'] = 'no-store';
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo leer la hoja de descuentos' }), { status: 502, headers: headers });
  }
}


/* ---------- Panel de marketing (marketing.html) ----------
   Portal para el equipo de marketing: solo tráfico del sitio (Google Analytics vía Windsor). NO muestra ni guarda ventas,
   ingresos ni datos de dinero de la empresa, y su código (MARKETING_CODE) es distinto al del panel de pedidos: con él no se
   puede abrir /api/panel/*. Variables del Worker (secretas): MARKETING_CODE (código de entrada) y WINDSOR_API_KEY (lectura de GA4).
   Los datos se copian a Supabase (esquema `marketing`) cada 6 horas y con el botón "Actualizar ahora". */
const MKT_COOKIE = 'apex_marketing';
const MKT_SESSION_SECONDS = 14 * 24 * 3600;
const MKT_HORAS_SYNC = [0, 6, 12, 18];   // hora UTC en que la revisión horaria también copia los datos de Windsor
const MKT_GA4_BASE = 'https://connectors.windsor.ai/googleanalytics4';

async function mktMakeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + MKT_SESSION_SECONDS;
  return exp + '.' + await hmacBase64Url(env.MARKETING_CODE + '|apex-marketing-session', String(exp));
}

async function mktIsAuthed(request, env) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + MKT_COOKIE + '=([^;]+)'));
  if (!match) return false;
  const parts = match[1].split('.');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !parts[1]) return false;
  if (Number(parts[0]) < Date.now() / 1000) return false;
  return safeEqual(parts[1], await hmacBase64Url(env.MARKETING_CODE + '|apex-marketing-session', parts[0]));
}

function mktCookie(value, maxAge) {
  return MKT_COOKIE + '=' + value + '; Path=/api/marketing; Max-Age=' + maxAge + '; HttpOnly; Secure; SameSite=Strict';
}

function ymd(d) { return d.toISOString().slice(0, 10); }

// La llave de Windsor tal como quedó guardada en Cloudflare, ya limpia: sin espacios ni saltos de línea, y si pegaron la URL completa o
// "api_key=..." se queda solo con el valor. (Una llave con un espacio o un salto de línea al final es la causa más común de "API key inválida".)
function windsorKey(env) {
  let k = String(env.WINDSOR_API_KEY || '').trim();
  const m = k.match(/api_key=([^&\s"']+)/);
  if (m) k = m[1];
  return k.replace(/^["']+|["']+$/g, '').trim();
}

// Pide una tabla a Windsor (GA4). Devuelve la lista de filas o lanza error (con el motivo que dé Windsor).
async function windsorGa4(env, campos, desde, hasta) {
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, 25000);
  try {
    const u = MKT_GA4_BASE + '?api_key=' + encodeURIComponent(windsorKey(env)) + '&fields=' + campos.join(',') + '&date_from=' + desde + '&date_to=' + hasta;
    const res = await fetch(u, { signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) {
      const pista = /api key/i.test(text) ? ' [llave: ' + windsorKey(env).length + ' caracteres]' : '';
      throw new Error('Windsor HTTP ' + res.status + ' ' + text.replace(/api_key=[^&"\s]+/g, 'api_key=***').slice(0, 120) + pista);
    }
    const body = text ? JSON.parse(text) : {};
    return Array.isArray(body) ? body : (body && Array.isArray(body.data) ? body.data : []);
  } finally {
    clearTimeout(timer);
  }
}

// Pide un rango largo en tramos de 30 días (Windsor responde más rápido y sin topes de filas).
async function windsorGa4Tramos(env, campos, desde, hasta) {
  const filas = [];
  let ini = new Date(desde + 'T00:00:00Z');
  const fin = new Date(hasta + 'T00:00:00Z');
  while (ini <= fin) {
    const fTramo = new Date(Math.min(ini.getTime() + 29 * 86400000, fin.getTime()));
    const rows = await windsorGa4(env, campos, ymd(ini), ymd(fTramo));
    for (let i = 0; i < rows.length; i++) filas.push(rows[i]);
    ini = new Date(fTramo.getTime() + 86400000);
  }
  return filas;
}

const num = function (v) { const n = Number(v); return isFinite(n) ? n : 0; };

// Cada tabla: campos que se piden a Windsor y cómo se pasan a las columnas de Supabase. Nunca se piden compras ni ingresos.
const MKT_TABLAS = {
  dia: { campos: ['date', 'sessions', 'totalusers', 'newusers', 'screen_page_views', 'engaged_sessions', 'average_session_duration', 'add_to_carts', 'checkouts'],
    fila: function (r) { return { dia: r.date, sesiones: num(r.sessions), usuarios: num(r.totalusers), nuevos: num(r.newusers), paginas_vistas: num(r.screen_page_views), sesiones_activas: num(r.engaged_sessions), duracion_prom: Math.round(num(r.average_session_duration) * 100) / 100, add_carrito: num(r.add_to_carts), inicia_compra: num(r.checkouts) }; } },
  fuente: { campos: ['date', 'source', 'medium', 'sessions', 'totalusers'],
    fila: function (r) { return { dia: r.date, fuente: r.source, medio: r.medium, sesiones: num(r.sessions), usuarios: num(r.totalusers) }; } },
  dispositivo: { campos: ['date', 'devicecategory', 'sessions', 'totalusers'],
    fila: function (r) { return { dia: r.date, dispositivo: r.devicecategory, sesiones: num(r.sessions), usuarios: num(r.totalusers) }; } },
  pagina: { campos: ['date', 'page_path', 'screen_page_views', 'totalusers'], filtro: function (r) { return !!r.page_path; },
    fila: function (r) { return { dia: r.date, ruta: r.page_path, vistas: num(r.screen_page_views), usuarios: num(r.totalusers) }; } },
  ciudad: { campos: ['date', 'country', 'city', 'sessions'],
    fila: function (r) { return { dia: r.date, pais: r.country, ciudad: r.city, sesiones: num(r.sessions) }; } }
};

// ¿Faltan datos de los últimos 90 días? Si la última carga falló hace menos de 3 horas no insiste (evita repetir cada hora).
async function marketingNecesitaHistorial(env, ahora) {
  try {
    const r = await supabaseRpc(env, 'marketing_leer', { p_desde: ymd(new Date(ahora.getTime() - 89 * 86400000)), p_hasta: ymd(ahora) });
    if (!r || r.ok !== true) return false;
    const u = r.ultima_sync;
    if (u && u.fin && u.estado !== 'ok' && Date.now() - new Date(u.fin).getTime() < 3 * 3600 * 1000) return false;
    const completo = r.actual && r.actual.dias_con_datos >= 60 && r.fuentes.length && r.dispositivos.length && r.paginas.length && r.ciudades.length;
    return !completo;
  } catch (err) {
    return false;
  }
}

// Copia a Supabase los últimos `dias` días de Google Analytics. Sin `forzar`, solo corre en las horas de MKT_HORAS_SYNC.
// Cada tabla va por separado: si una falla, las demás se guardan igual y el motivo queda en el registro. Devuelve { ok, filas, error }.
async function sincronizarMarketing(env, forzar, dias) {
  try {
    if (!env.WINDSOR_API_KEY || !usaSupabase(env)) return { ok: false, error: 'Falta WINDSOR_API_KEY o Supabase' };
    const ahora = new Date();
    // Si todavía falta historial (primera vez o una tabla vacía), la revisión horaria lo trae sola: nadie tiene que pulsar nada.
    const historial = !forzar && await marketingNecesitaHistorial(env, ahora);
    if (!forzar && !historial && (MKT_HORAS_SYNC.indexOf(ahora.getUTCHours()) === -1 || ahora.getUTCMinutes() > 30)) return { ok: true, omitido: true };
    const n = historial ? 90 : Math.max(1, Math.min(90, Math.floor(num(dias)) || 3));
    const hasta = ymd(ahora);
    const desde = ymd(new Date(ahora.getTime() - (n - 1) * 86400000));
    let total = 0;
    const fallos = [];
    for (const nombre of Object.keys(MKT_TABLAS)) {
      const t = MKT_TABLAS[nombre];
      try {
        let rows = await windsorGa4Tramos(env, t.campos, desde, hasta);
        if (t.filtro) rows = rows.filter(t.filtro);
        const filas = rows.map(t.fila);
        for (let i = 0; i < filas.length; i += 500) {
          const r = await supabaseRpc(env, 'marketing_guardar', { p_tabla: nombre, p_filas: filas.slice(i, i + 500) });
          if (!r || r.ok !== true) throw new Error('No se guardó: ' + (r && r.error));
          total += filas.slice(i, i + 500).length;
        }
      } catch (err) {
        console.error('[marketing] ' + nombre + ': ' + String(err));
        fallos.push(nombre + ' (' + String(err).replace(/^Error: /, '').slice(0, 140) + ')');
      }
    }
    await supabaseRpc(env, 'marketing_registrar_sync', { p_estado: fallos.length ? (total ? 'parcial' : 'error') : 'ok', p_filas: total, p_detalle: fallos.length ? 'Fallaron: ' + fallos.join('; ') : desde + ' a ' + hasta });
    if (!total) {
      const llave = fallos.length && fallos.every(function (f) { return /api key/i.test(f); });
      return { ok: false, error: llave ? 'Windsor no aceptó la llave. Hay que volver a copiarla en el secreto WINDSOR_API_KEY de Cloudflare.' : 'No se pudo traer los datos de Google Analytics.' };
    }
    return { ok: true, filas: total, fallos: fallos.length };
  } catch (err) {
    console.error('[marketing] Sincronización: ' + String(err));
    try { await supabaseRpc(env, 'marketing_registrar_sync', { p_estado: 'error', p_filas: 0, p_detalle: String(err).slice(0, 300) }); } catch (e2) { /* sin registro */ }
    return { ok: false, error: 'No se pudo traer los datos de Google Analytics.' };
  }
}

/* ---------- Instagram de Apex (panel de marketing) ----------
   Igual que el monitor de Going: Apify (actor apify/instagram-scraper) lee las publicaciones PÚBLICAS de @apexnutricionve, sin usar
   ninguna cuenta de Instagram. Se guarda en Supabase (marketing.ig_perfil / ig_post). Corre una vez al día (07:00 Caracas) y con el
   botón del portal. Secretos del Worker: APIFY_TOKEN y, opcional, APIFY_TOKEN_RESPALDO (segunda cuenta, como en Going). Cuesta cupo de Apify (1 cuenta, ~12 publicaciones por corrida). */
const IG_USUARIO = 'apexnutricionve';
const IG_HORAS_SYNC = [11];     // hora UTC en que la revisión horaria también trae Instagram (11 UTC = 07:00 Caracas)
const IG_LIMITE = 12;      // publicaciones recientes por corrida (cuidar el cupo de Apify; Going bajó de 12 a 6 por lo mismo)
const APIFY_URL = 'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?timeout=150';

// Un intento contra Apify con UN token. Lanza error con el motivo (sin mostrar el token).
async function apifyConToken(token, usuario, tipo, limite) {
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, 170000);
  try {
    const res = await fetch(APIFY_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + String(token).trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ directUrls: ['https://www.instagram.com/' + usuario + '/'], resultsType: tipo, resultsLimit: limite, addParentData: true }),
      signal: ctl.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error('Apify HTTP ' + res.status + ' ' + text.replace(/\s+/g, ' ').slice(0, 140));
    const items = text ? JSON.parse(text) : [];
    return Array.isArray(items) ? items : [];
  } finally {
    clearTimeout(timer);
  }
}

// Hay dos cuentas de Apify (igual que el monitor de Going): APIFY_TOKEN (principal) y APIFY_TOKEN_RESPALDO. Si la principal se queda sin cupo
// del mes o falla su token, se prueba con la de respaldo.
async function apifyInstagram(env, usuario, tipo, limite) {
  const tokens = [env.APIFY_TOKEN, env.APIFY_TOKEN_RESPALDO].filter(Boolean);
  let ultimo = null;
  for (let i = 0; i < tokens.length; i++) {
    try {
      return await apifyConToken(tokens[i], usuario, tipo, limite);
    } catch (err) {
      ultimo = err;
      const cupo = /HTTP (402|403|401)|usage|limit|quota/i.test(String(err));
      if (i < tokens.length - 1 && cupo) { console.error('[marketing] Apify cuenta #' + (i + 1) + ' no sirvió, probando la de respaldo: ' + String(err).slice(0, 120)); continue; }
      throw err;
    }
  }
  throw ultimo || new Error('Falta el token de Apify');
}

function igSeguidores(item) {
  const fuentes = [item.dataSource || {}, item, item.owner || {}];
  for (let i = 0; i < fuentes.length; i++) {
    const k = ['followersCount', 'followerCount', 'followers', 'ownerFollowersCount'];
    for (let j = 0; j < k.length; j++) { const v = fuentes[i][k[j]]; if (typeof v === 'number' && v > 0) return v; }
  }
  return null;
}

function igTipo(item) {
  const t = String(item.type || '').toLowerCase();
  if (t === 'video' || item.productType === 'clips') return 'video';
  if (t === 'sidecar') return 'carrusel';
  return 'imagen';
}

// Convierte lo que devuelve Apify en filas y las guarda (seguidores + publicaciones). Devuelve { posts, seguidores }.
async function guardarInstagram(env, itemsCrudos) {
  const items = (itemsCrudos || []).filter(function (i) { return i && i.shortCode; });
  if (!items.length) throw new Error('Apify no devolvió publicaciones de @' + IG_USUARIO);
  let seguidores = null;
  for (let i = 0; i < items.length && seguidores === null; i++) seguidores = igSeguidores(items[i]);
  if (seguidores === null) {   // algunas versiones del actor no traen el perfil junto a los posts: se pide aparte
    const det = await apifyInstagram(env, IG_USUARIO, 'details', 1);
    for (let i = 0; i < det.length && seguidores === null; i++) seguidores = igSeguidores(det[i]);
  }
  const posts = items.map(function (i) {
    return { shortcode: i.shortCode, tipo: igTipo(i), publicado: i.timestamp, me_gusta: typeof i.likesCount === 'number' ? i.likesCount : null, comentarios: num(i.commentsCount),
      vistas: typeof i.videoViewCount === 'number' ? i.videoViewCount : (typeof i.videoPlayCount === 'number' ? i.videoPlayCount : null),
      texto: i.caption || '', url: i.url || ('https://www.instagram.com/p/' + i.shortCode + '/') };
  });
  for (let k = 0; k < posts.length; k += 50) {
    const r = await supabaseRpc(env, 'marketing_ig_guardar', { p_usuario: IG_USUARIO, p_seguidores: k === 0 ? seguidores : null, p_posts: posts.slice(k, k + 50) });
    if (!r || r.ok !== true) throw new Error('No se guardó: ' + (r && r.error));
  }
  return { posts: posts.length, seguidores: seguidores };
}

function mensajeErrorApify(err) {
  const m = String(err);
  return /HTTP 40[13]/.test(m) ? 'Apify no aceptó el token (APIFY_TOKEN en Cloudflare).' : (/usage|limit|402/i.test(m) ? 'La cuenta de Apify se quedó sin cupo este mes.' : 'No se pudo traer el Instagram de Apex.');
}

// Trae seguidores y publicaciones recientes de la cuenta y los guarda. Sin `forzar`, solo corre a las IG_HORAS_SYNC. Devuelve { ok, posts, seguidores, error }.
async function sincronizarInstagram(env, forzar) {
  try {
    if (!(env.APIFY_TOKEN || env.APIFY_TOKEN_RESPALDO) || !usaSupabase(env)) return { ok: false, error: 'Falta el secreto APIFY_TOKEN en Cloudflare.' };
    const ahora = new Date();
    if (!forzar && (IG_HORAS_SYNC.indexOf(ahora.getUTCHours()) === -1 || ahora.getUTCMinutes() > 30)) return { ok: true, omitido: true };
    const r = await guardarInstagram(env, await apifyInstagram(env, IG_USUARIO, 'posts', IG_LIMITE));
    await supabaseRpc(env, 'marketing_ig_registrar', { p_estado: 'ok', p_filas: r.posts, p_detalle: (r.seguidores === null ? 'sin dato de seguidores' : r.seguidores + ' seguidores') });
    return { ok: true, posts: r.posts, seguidores: r.seguidores };
  } catch (err) {
    console.error('[marketing] Instagram: ' + String(err));
    try { await supabaseRpc(env, 'marketing_ig_registrar', { p_estado: 'error', p_filas: 0, p_detalle: String(err).replace(/^Error: /, '').slice(0, 300) }); } catch (e2) { /* sin registro */ }
    return { ok: false, error: mensajeErrorApify(err) };
  }
}

/* Carga de historial (100 publicaciones, una sola vez): tarda más de lo que conviene tener una petición abierta, así que va en dos tiempos.
   1) iniciarHistorialInstagram: arranca la corrida en Apify (sin esperar) y anota en el registro "pendiente" con el número de corrida.
   2) completarHistorialInstagram: cuando la corrida terminó, baja los resultados y los guarda. Se llama cada hora y cada vez que el portal pide Instagram. */
const APIFY_RUNS_URL = 'https://api.apify.com/v2/acts/apify~instagram-scraper/runs';
const IG_HISTORIAL_MAX = 100;

async function iniciarHistorialInstagram(env, limite) {
  try {
    if (!(env.APIFY_TOKEN || env.APIFY_TOKEN_RESPALDO) || !usaSupabase(env)) return { ok: false, error: 'Falta el secreto APIFY_TOKEN en Cloudflare.' };
    const ult = await supabaseRpc(env, 'marketing_ig_ultima', {});
    if (ult && ult.estado === 'pendiente' && ult.fin && Date.now() - new Date(ult.fin).getTime() < 20 * 60 * 1000) return { ok: true, iniciado: true, yaEnCurso: true };
    const n = Math.max(IG_LIMITE, Math.min(IG_HISTORIAL_MAX, Math.floor(num(limite)) || IG_HISTORIAL_MAX));
    const tokens = [env.APIFY_TOKEN, env.APIFY_TOKEN_RESPALDO];
    let ultimoError = null;
    for (let slot = 0; slot < tokens.length; slot++) {
      if (!tokens[slot]) continue;
      const res = await fetch(APIFY_RUNS_URL, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + String(tokens[slot]).trim(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ directUrls: ['https://www.instagram.com/' + IG_USUARIO + '/'], resultsType: 'posts', resultsLimit: n, addParentData: true })
      });
      const text = await res.text();
      if (!res.ok) {
        ultimoError = new Error('Apify HTTP ' + res.status + ' ' + text.replace(/\s+/g, ' ').slice(0, 140));
        if (/HTTP (401|402|403)|usage|limit|quota/i.test(String(ultimoError))) continue;
        throw ultimoError;
      }
      const d = (JSON.parse(text) || {}).data || {};
      if (!d.id || !d.defaultDatasetId) throw new Error('Apify no devolvió el número de corrida');
      await supabaseRpc(env, 'marketing_ig_registrar', { p_estado: 'pendiente', p_filas: 0, p_detalle: 'RUN:' + d.id + '|' + d.defaultDatasetId + '|' + slot + '|' + n });
      return { ok: true, iniciado: true };
    }
    throw ultimoError || new Error('Falta el token de Apify');
  } catch (err) {
    console.error('[marketing] Historial Instagram (inicio): ' + String(err));
    try { await supabaseRpc(env, 'marketing_ig_registrar', { p_estado: 'error', p_filas: 0, p_detalle: String(err).replace(/^Error: /, '').slice(0, 300) }); } catch (e2) { /* sin registro */ }
    return { ok: false, error: mensajeErrorApify(err) };
  }
}

async function completarHistorialInstagram(env) {
  try {
    if (!usaSupabase(env)) return { pendiente: false };
    const ult = await supabaseRpc(env, 'marketing_ig_ultima', {});
    if (!ult || ult.estado !== 'pendiente') return { pendiente: false };
    const m = /RUN:(\S+?)\|(\S+?)\|(\d)\|(\d+)/.exec(ult.detalle || '');
    if (!m) return { pendiente: false };
    const token = [env.APIFY_TOKEN, env.APIFY_TOKEN_RESPALDO][Number(m[3])];
    if (!token) return { pendiente: false };
    const cab = { 'Authorization': 'Bearer ' + String(token).trim() };
    const rr = await fetch('https://api.apify.com/v2/actor-runs/' + encodeURIComponent(m[1]), { headers: cab });
    if (!rr.ok) throw new Error('Apify HTTP ' + rr.status + ' al consultar la corrida');
    const estado = String((((await rr.json()) || {}).data || {}).status || '');
    if (estado === 'READY' || estado === 'RUNNING') {
      if (Date.now() - new Date(ult.fin).getTime() > 25 * 60 * 1000) { await supabaseRpc(env, 'marketing_ig_registrar', { p_estado: 'error', p_filas: 0, p_detalle: 'La carga de historial tardó demasiado en Apify.' }); return { pendiente: false }; }
      return { pendiente: true };
    }
    if (estado !== 'SUCCEEDED') { await supabaseRpc(env, 'marketing_ig_registrar', { p_estado: 'error', p_filas: 0, p_detalle: 'La corrida de Apify terminó con estado ' + estado.slice(0, 30) }); return { pendiente: false }; }
    const dr = await fetch('https://api.apify.com/v2/datasets/' + encodeURIComponent(m[2]) + '/items?clean=true&limit=' + IG_HISTORIAL_MAX, { headers: cab });
    if (!dr.ok) throw new Error('Apify HTTP ' + dr.status + ' al bajar los resultados');
    const r = await guardarInstagram(env, await dr.json());
    await supabaseRpc(env, 'marketing_ig_registrar', { p_estado: 'ok', p_filas: r.posts, p_detalle: 'Historial: ' + r.posts + ' publicaciones' + (r.seguidores === null ? '' : ', ' + r.seguidores + ' seguidores') });
    return { pendiente: false, posts: r.posts };
  } catch (err) {
    console.error('[marketing] Historial Instagram (cierre): ' + String(err));
    return { pendiente: true };
  }
}

async function handleMarketing(request, env, url) {
  if (!env.MARKETING_CODE || !usaSupabase(env)) {
    console.error('[marketing] Falta MARKETING_CODE o la configuración de Supabase');
    return panelJson({ ok: false, error: 'Marketing not configured' }, 503);
  }
  const route = url.pathname.slice('/api/marketing/'.length);

  if (route === 'login') {
    if (request.method !== 'POST') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const blocked = await guardPublicApi(request, env.ORDER_LIMITER, 'marketing-login');
    if (blocked) { blocked.headers.set('Cache-Control', 'no-store'); return blocked; }
    let code = '';
    try {
      const body = await readJsonBody(request);
      code = body.payload && typeof body.payload.code === 'string' ? body.payload.code : '';
    } catch (err) { /* código vacío: falla abajo */ }
    if (!code || code.length > 200 || !(await safeEqual(code, env.MARKETING_CODE))) {
      console.error('[marketing] Código incorrecto desde ' + clientIp(request));
      return panelJson({ ok: false, error: 'Unauthorized' }, 401);
    }
    const res = panelJson({ ok: true });
    res.headers.append('Set-Cookie', mktCookie(await mktMakeToken(env), MKT_SESSION_SECONDS));
    return res;
  }

  if (route === 'logout') {
    if (request.method !== 'POST') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const res = panelJson({ ok: true });
    res.headers.append('Set-Cookie', mktCookie('', 0));
    return res;
  }

  if (!(await mktIsAuthed(request, env))) return panelJson({ ok: false, error: 'Unauthorized' }, 401);

  if (route === 'datos') {
    if (request.method !== 'GET') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const q = url.searchParams;
    const fecha = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; };
    const desde = fecha(q.get('desde')), hasta = fecha(q.get('hasta'));
    if (!desde || !hasta) return panelJson({ ok: false, error: 'Faltan las fechas.' }, 400);
    let r;
    try {
      r = await supabaseRpc(env, 'marketing_leer', { p_desde: desde, p_hasta: hasta, p_cdesde: fecha(q.get('cdesde')), p_chasta: fecha(q.get('chasta')) });
    } catch (err) {
      console.error('[marketing] Supabase (leer): ' + String(err));
      return panelJson({ ok: false, error: 'No se pudieron leer los datos. Intenta otra vez.' }, 502);
    }
    if (!r || r.ok !== true) return panelJson({ ok: false, error: (r && r.error) || 'No se pudieron leer los datos.' }, 400);
    return panelJson(r);
  }

  if (route === 'actualizar') {
    if (request.method !== 'POST') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const blocked = await guardPublicApi(request, env.API_LIMITER, 'marketing-actualizar');
    if (blocked) { blocked.headers.set('Cache-Control', 'no-store'); return blocked; }
    let dias = 3;
    try { const b = await readJsonBody(request); if (b.payload && b.payload.dias) dias = num(b.payload.dias); } catch (err) { /* usa 3 días */ }
    const r = await sincronizarMarketing(env, true, dias);
    return panelJson({ ok: r.ok, filas: r.filas, error: r.ok ? undefined : r.error }, r.ok ? 200 : 502);
  }

  if (route === 'instagram') {
    if (request.method !== 'GET') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const q = url.searchParams;
    const fecha = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; };
    const desde = fecha(q.get('desde')), hasta = fecha(q.get('hasta'));
    if (!desde || !hasta) return panelJson({ ok: false, error: 'Faltan las fechas.' }, 400);
    let r, ult = null;
    try {
      await completarHistorialInstagram(env);   // si hay una carga de historial en marcha y ya terminó, se guarda aquí
      r = await supabaseRpc(env, 'marketing_ig_leer', { p_usuario: IG_USUARIO, p_desde: desde, p_hasta: hasta, p_cdesde: fecha(q.get('cdesde')), p_chasta: fecha(q.get('chasta')) });
      ult = await supabaseRpc(env, 'marketing_ig_ultima', {});
    } catch (err) {
      console.error('[marketing] Supabase (instagram): ' + String(err));
      return panelJson({ ok: false, error: 'No se pudieron leer los datos de Instagram. Intenta otra vez.' }, 502);
    }
    if (!r || r.ok !== true) return panelJson({ ok: false, error: (r && r.error) || 'No se pudieron leer los datos de Instagram.' }, 400);
    r.ultima_sync = ult;
    return panelJson(r);
  }

  if (route === 'instagram-actualizar') {
    if (request.method !== 'POST') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const blocked = await guardPublicApi(request, env.API_LIMITER, 'marketing-instagram');
    if (blocked) { blocked.headers.set('Cache-Control', 'no-store'); return blocked; }
    let limite = 0;
    try { const b = await readJsonBody(request); if (b.payload && b.payload.limite) limite = num(b.payload.limite); } catch (err) { /* normal */ }
    if (limite > IG_LIMITE) {
      const h = await iniciarHistorialInstagram(env, limite);
      return panelJson({ ok: h.ok, iniciado: h.iniciado, error: h.ok ? undefined : h.error }, h.ok ? 200 : 502);
    }
    const r = await sincronizarInstagram(env, true);
    return panelJson({ ok: r.ok, posts: r.posts, seguidores: r.seguidores, error: r.ok ? undefined : r.error }, r.ok ? 200 : 502);
  }

  if (route === 'newsletter') {
    if (request.method !== 'GET') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const q = url.searchParams;
    const fecha = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; };
    const desde = fecha(q.get('desde')), hasta = fecha(q.get('hasta'));
    if (!desde || !hasta) return panelJson({ ok: false, error: 'Faltan las fechas.' }, 400);
    let r;
    try { r = await supabaseRpc(env, 'newsletter_resumen', { p_desde: desde, p_hasta: hasta }); }
    catch (err) { console.error('[marketing] Supabase (newsletter): ' + String(err)); return panelJson({ ok: false, error: 'No se pudieron leer los datos del newsletter.' }, 502); }
    if (!r || typeof r !== 'object') return panelJson({ ok: false, error: 'No se pudieron leer los datos del newsletter.' }, 502);
    r.ok = true; r.avisos_activos = env.NEWSLETTER_AVISOS === 'on';
    return panelJson(r);
  }

  if (route === 'newsletter-prueba') {
    if (request.method !== 'POST') return panelJson({ ok: false, error: 'Method not allowed' }, 405);
    const blocked = await guardPublicApi(request, env.API_LIMITER, 'marketing-newsletter-prueba');
    if (blocked) { blocked.headers.set('Cache-Control', 'no-store'); return blocked; }
    let b;
    try { b = (await readJsonBody(request)).payload; } catch (err) { return panelJson({ ok: false, error: 'Bad JSON' }, 400); }
    const para = b && typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!para || para.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(para)) return panelJson({ ok: false, error: 'Escribe un correo válido.' }, 400);
    const tipo = b && b.tipo === 'bienvenida' ? 'bienvenida' : 'semana';
    const clavePrueba = '0'.repeat(32);
    const ejemplo = [
      { ruta: '/producto-going-hidratante.html', titulo: 'Hidratante Uva Going', imagen: SITIO + '/assets/going/hidratante-sobre-uva.webp?v=2' },
      { ruta: '/producto-going-proteina-tarro.html', titulo: 'Proteína en Polvo Chocolate — 600 g Going', imagen: SITIO + '/assets/going/proteina-tarro-chocolate.webp' },
      { ruta: '/categoria.html?cat=hidratacion', titulo: 'Toda la hidratación', imagen: null }
    ];
    try {
      await enviarCorreoNewsletter(env, para, tipo === 'bienvenida' ? correoBienvenida(clavePrueba, true) : correoProductosSemana(ejemplo, clavePrueba, true));
      try { await supabaseRpc(env, 'newsletter_marcar_envio', { p_email: para, p_ruta: '/', p_estado: 'prueba', p_detalle: tipo, p_tipo: 'prueba' }); } catch (e2) { /* sin registro */ }
    } catch (err) {
      console.error('[marketing] correo de prueba: ' + String(err));
      return panelJson({ ok: false, error: 'No se pudo enviar el correo de prueba.' }, 502);
    }
    return panelJson({ ok: true });
  }

  return panelJson({ ok: false, error: 'Not found' }, 404);
}
