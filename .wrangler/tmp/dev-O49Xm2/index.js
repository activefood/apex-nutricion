var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.js
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/submit-order") {
      const blocked = await guardPublicApi(request, env.ORDER_LIMITER, "submit-order");
      return blocked || handleSubmitOrder(request, env);
    }
    if (url.pathname === "/api/submit-review") {
      const blocked = await guardPublicApi(request, env.API_LIMITER, "submit-review");
      return blocked || handleSubmitReview(request, env);
    }
    if (url.pathname === "/api/get-reviews") {
      const blocked = await guardPublicApi(request, env.API_LIMITER, "get-reviews");
      return blocked || handleGetReviews(request, env);
    }
    if (url.pathname === "/api/check-welcome-coupon") {
      const blocked = await guardPublicApi(request, env.API_LIMITER, "check-welcome-coupon");
      return blocked || handleCheckWelcomeCoupon(request, env);
    }
    if (url.pathname === "/api/promos") {
      return handlePromos(request, env);
    }
    if (url.pathname.indexOf("/api/panel/") === 0) {
      return handlePanel(request, env, url, ctx);
    }
    if (url.pathname === "/panel" || url.pathname === "/panel/") {
      return Response.redirect(new URL("/panel.html", url).toString(), 302);
    }
    if (url.pathname === "/panel.html" || url.pathname.indexOf("/panel/") === 0) {
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      return new Response(asset.body, { status: asset.status, headers });
    }
    if (url.pathname === "/api/calculadora") {
      const blocked = await guardPublicApi(request, env.API_LIMITER, "calculadora");
      return blocked || handleCalculadora(request, env);
    }
    if (url.pathname === "/") {
      const indexUrl = new URL(request.url);
      indexUrl.pathname = "/index.html";
      return marcarSitioPrueba(await env.ASSETS.fetch(new Request(indexUrl, request)), env);
    }
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
    }
  }
};
var PRUEBA_FRANJA = '<div role="note" style="background:#FBF3DD;color:#14120F;border-bottom:1px solid #E4DFD5;padding:10px 16px;font:600 13px/1.4 Inter,sans-serif;text-align:center">Sitio de prueba: no hagas pedidos aqu\xED. Para comprar, entra a <a href="https://apexnutricionve.com" style="color:#14120F;text-decoration:underline">apexnutricionve.com</a>.</div>';
async function marcarSitioPrueba(response, env) {
  if (!env.SITIO_PRUEBA) return response;
  const type = response.headers.get("Content-Type") || "";
  if (!type.includes("text/html") || response.status !== 200) return response;
  const html = (await response.text()).replace("<body>", "<body>" + PRUEBA_FRANJA).replace('id="checkout-whatsapp">Comprar</button>', 'id="checkout-whatsapp" disabled>Pedidos desactivados (prueba)</button>');
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set("X-Robots-Tag", "noindex");
  return new Response(html, { status: response.status, headers });
}
__name(marcarSitioPrueba, "marcarSitioPrueba");
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json, "json");
var CALC_TIPOS = ["plan", "kit", "pack"];
var CALC_MAX_BYTES = 16e3;
var calcTableReady = false;
async function handleCalculadora(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!env.CALC_DB) return json({ ok: false, error: "Storage not configured" }, 503);
  const text = await request.text();
  if (text.length > CALC_MAX_BYTES) return json({ ok: false, error: "Payload too large" }, 413);
  let p;
  try {
    p = JSON.parse(text);
  } catch (err) {
    return json({ ok: false, error: "Bad JSON" }, 400);
  }
  const isObj = /* @__PURE__ */ __name((o) => o && typeof o === "object" && !Array.isArray(o), "isObj");
  if (!p || p.consent !== true) return json({ ok: false, error: "Consent required" }, 400);
  if (typeof p.sesion !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(p.sesion)) return json({ ok: false, error: "Invalid sesion" }, 400);
  if (CALC_TIPOS.indexOf(p.tipo) === -1) return json({ ok: false, error: "Invalid tipo" }, 400);
  if (!isObj(p.respuestas) || !isObj(p.resultado)) return json({ ok: false, error: "Invalid payload" }, 400);
  const codigo = typeof p.codigo === "string" && /^[A-Za-z0-9-]{1,20}$/.test(p.codigo) ? p.codigo.toUpperCase() : null;
  const version = typeof p.version === "string" ? p.version.slice(0, 40) : null;
  try {
    if (!calcTableReady) {
      await env.CALC_DB.prepare(
        "CREATE TABLE IF NOT EXISTS calculadora_respuestas (n INTEGER PRIMARY KEY AUTOINCREMENT, creado TEXT NOT NULL, sesion TEXT NOT NULL, tipo TEXT NOT NULL, codigo_atleta TEXT, version TEXT, respuestas TEXT NOT NULL, resultado TEXT NOT NULL)"
      ).run();
      calcTableReady = true;
    }
    await env.CALC_DB.prepare(
      "INSERT INTO calculadora_respuestas (creado, sesion, tipo, codigo_atleta, version, respuestas, resultado) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind((/* @__PURE__ */ new Date()).toISOString(), p.sesion, p.tipo, codigo, version, JSON.stringify(p.respuestas), JSON.stringify(p.resultado)).run();
  } catch (err) {
    console.error("[calculadora] No se pudo guardar: " + err);
    return json({ ok: false, error: "Storage error" }, 500);
  }
  return json({ ok: true });
}
__name(handleCalculadora, "handleCalculadora");
var MAX_BODY_CHARS = 32e3;
var MAX_ORDER_ITEMS = 40;
var MAX_ITEM_QUANTITY = 99;
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}
__name(clientIp, "clientIp");
function isForeignOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch (err) {
    return true;
  }
}
__name(isForeignOrigin, "isForeignOrigin");
async function guardPublicApi(request, limiter, route) {
  if (request.method !== "POST") return null;
  if (isForeignOrigin(request)) {
    console.error("[" + route + "] Origin ajeno rechazado: " + request.headers.get("Origin"));
    return json({ ok: false, error: "Forbidden" }, 403);
  }
  if (!limiter) return null;
  try {
    const result = await limiter.limit({ key: route + ":" + clientIp(request) });
    if (!result.success) {
      console.error("[" + route + "] L\xEDmite de peticiones excedido para " + clientIp(request));
      const res = json({ ok: false, error: "Too many requests" }, 429);
      res.headers.set("Retry-After", "60");
      return res;
    }
  } catch (err) {
    console.error("[" + route + "] El limitador fall\xF3, se deja pasar: " + String(err));
  }
  return null;
}
__name(guardPublicApi, "guardPublicApi");
async function readJsonBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return { tooLarge: true };
  return { payload: JSON.parse(raw) };
}
__name(readJsonBody, "readJsonBody");
function isText(value, min, max) {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}
__name(isText, "isText");
function isOptionalText(value, max) {
  return value === void 0 || value === null || typeof value === "string" && value.length <= max;
}
__name(isOptionalText, "isOptionalText");
function isNumberBetween(value, min, max) {
  return typeof value === "number" && isFinite(value) && value >= min && value <= max;
}
__name(isNumberBetween, "isNumberBetween");
function validateOrder(order) {
  if (!order || typeof order !== "object") return "payload no es un objeto";
  if (!isText(order.customerName, 2, 100)) return "customerName inv\xE1lido";
  const phoneDigits = typeof order.phone === "string" ? order.phone.replace(/\D/g, "") : "";
  if (phoneDigits.length < 7 || phoneDigits.length > 15 || order.phone.length > 30) return "phone inv\xE1lido";
  if (!isText(order.location, 1, 1500)) return "location inv\xE1lido";
  if (!isOptionalText(order.deliveryType, 30)) return "deliveryType inv\xE1lido";
  if (!isOptionalText(order.state, 60)) return "state inv\xE1lido";
  if (!isOptionalText(order.ci, 30)) return "ci inv\xE1lido";
  if (!isOptionalText(order.mrwAddress, 1500)) return "mrwAddress inv\xE1lido";
  if (!isOptionalText(order.gaClientId, 60)) return "gaClientId inv\xE1lido";
  if (!isOptionalText(order.gaSessionId, 30)) return "gaSessionId inv\xE1lido";
  if (order.total !== void 0 && !isNumberBetween(order.total, 0, 1e4)) return "total inv\xE1lido";
  if (!Array.isArray(order.items) || order.items.length === 0 || order.items.length > MAX_ORDER_ITEMS) {
    return "items inv\xE1lidos";
  }
  for (const item of order.items) {
    if (!item || typeof item !== "object") return "item inv\xE1lido";
    if (!isText(item.product, 1, 200)) return "item.product inv\xE1lido";
    if (!isOptionalText(item.brand, 60)) return "item.brand inv\xE1lido";
    if (!isNumberBetween(item.unitPrice, 0, 1e3)) return "item.unitPrice inv\xE1lido";
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
      return "item.quantity inv\xE1lido";
    }
  }
  return null;
}
__name(validateOrder, "validateOrder");
async function handleSubmitOrder(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!usaSupabase(env)) {
    console.error("[submit-order] Supabase no est\xE1 configurado (PEDIDOS_BACKEND, SUPABASE_URL, SUPABASE_KEY, SUPABASE_RPC_TOKEN)");
    return json({ ok: false, error: "Server misconfiguration: database not configured" }, 500);
  }
  let payload;
  try {
    const body = await readJsonBody(request);
    if (body.tooLarge) return json({ ok: false, error: "Payload too large" }, 413);
    payload = body.payload;
  } catch (err) {
    return json({ ok: false, error: "Invalid order payload (bad JSON)" }, 400);
  }
  const invalid = validateOrder(payload);
  if (invalid) {
    console.error("[submit-order] Pedido rechazado: " + invalid);
    return json({ ok: false, error: "Invalid order payload" }, 400);
  }
  return crearPedidoSupabase(env, payload);
}
__name(handleSubmitOrder, "handleSubmitOrder");
async function handleSubmitReview(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!usaSupabase(env)) {
    console.error("[submit-review] Supabase no est\xE1 configurado (PEDIDOS_BACKEND, SUPABASE_URL, SUPABASE_KEY, SUPABASE_RPC_TOKEN)");
    return json({ ok: false, error: "Server misconfiguration: database not configured" }, 500);
  }
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ ok: false, error: "Invalid review payload (bad JSON)" }, 400);
  }
  const rating = Number(payload && payload.rating);
  const name = payload && typeof payload.name === "string" ? payload.name.trim() : "";
  if (!payload || !payload.product || !rating || rating < 1 || rating > 5 || !name) {
    return json({ ok: false, error: "Invalid review payload" }, 400);
  }
  return resenaSupabase(env, payload);
}
__name(handleSubmitReview, "handleSubmitReview");
async function handleGetReviews(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!usaSupabase(env)) {
    console.error("[get-reviews] Supabase no est\xE1 configurado (PEDIDOS_BACKEND, SUPABASE_URL, SUPABASE_KEY, SUPABASE_RPC_TOKEN)");
    return json({ ok: false, error: "Server misconfiguration: database not configured" }, 500);
  }
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    payload = {};
  }
  const product = payload && typeof payload.product === "string" ? payload.product.trim() : "";
  return listarResenasSupabase(env, product);
}
__name(handleGetReviews, "handleGetReviews");
async function handleCheckWelcomeCoupon(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!usaSupabase(env)) {
    console.error("[check-welcome-coupon] Supabase no est\xE1 configurado (PEDIDOS_BACKEND, SUPABASE_URL, SUPABASE_KEY, SUPABASE_RPC_TOKEN)");
    return json({ ok: false, error: "Server misconfiguration: database not configured" }, 500);
  }
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ ok: false, error: "Invalid payload (bad JSON)" }, 400);
  }
  const name = payload && typeof payload.name === "string" ? payload.name.trim() : "";
  const phone = payload && typeof payload.phone === "string" ? payload.phone.trim() : "";
  if (!name || !phone) {
    return json({ ok: false, error: "Missing name or phone" }, 400);
  }
  return cuponSupabase(env, name, phone);
}
__name(handleCheckWelcomeCoupon, "handleCheckWelcomeCoupon");
function usaSupabase(env) {
  return env.PEDIDOS_BACKEND === "supabase" && !!env.SUPABASE_URL && !!env.SUPABASE_KEY && !!env.SUPABASE_RPC_TOKEN;
}
__name(usaSupabase, "usaSupabase");
async function supabaseRpc(env, fn, args) {
  const ctl = new AbortController();
  const timer = setTimeout(function() {
    ctl.abort();
  }, 12e3);
  try {
    const res = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { "apikey": env.SUPABASE_KEY, "Authorization": "Bearer " + env.SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ p_token: env.SUPABASE_RPC_TOKEN }, args || {})),
      signal: ctl.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error("HTTP " + res.status + " " + text.slice(0, 200));
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}
__name(supabaseRpc, "supabaseRpc");
async function crearPedidoSupabase(env, o) {
  try {
    const r = await supabaseRpc(env, "tienda_crear_pedido", { p_pedido: {
      cliente: o.customerName,
      telefono: o.phone,
      zona: o.location,
      estado_geo: o.state || "",
      ci: o.ci || "",
      agencia_mrw: o.mrwAddress || "",
      ga_client_id: o.gaClientId || "",
      ga_session_id: o.gaSessionId || "",
      items: o.items.map(function(i) {
        return { product: i.product, brand: i.brand || "", unitPrice: i.unitPrice, quantity: i.quantity };
      })
    } });
    if (!r || r.ok !== true) {
      console.error("[submit-order] Supabase rechaz\xF3 el pedido: " + JSON.stringify(r));
      return json({ ok: false, error: r && r.error || "Could not save order" }, 502);
    }
    return json({ ok: true, orderId: r.orderId }, 200);
  } catch (err) {
    console.error("[submit-order] Supabase fall\xF3: " + String(err));
    return json({ ok: false, error: "Could not reach the database" }, 502);
  }
}
__name(crearPedidoSupabase, "crearPedidoSupabase");
async function resenaSupabase(env, payload) {
  try {
    const r = await supabaseRpc(env, "tienda_resena_crear", { p_resena: { product: payload.product, brand: payload.brand || "", rating: Number(payload.rating), review: payload.review || "", name: payload.name, url: payload.url || "" } });
    return json(r && r.ok ? { ok: true } : { ok: false, error: "Could not save review" }, r && r.ok ? 200 : 502);
  } catch (err) {
    console.error("[submit-review] Supabase fall\xF3: " + String(err));
    return json({ ok: false, error: "Could not reach the database" }, 502);
  }
}
__name(resenaSupabase, "resenaSupabase");
async function listarResenasSupabase(env, product) {
  try {
    return json(await supabaseRpc(env, "tienda_resenas_listar", { p_producto: product }), 200);
  } catch (err) {
    console.error("[get-reviews] Supabase fall\xF3: " + String(err));
    return json({ ok: false, error: "Could not reach the database" }, 502);
  }
}
__name(listarResenasSupabase, "listarResenasSupabase");
async function cuponSupabase(env, name, phone) {
  try {
    const r = await supabaseRpc(env, "tienda_cupon_elegible", { p_nombre: name, p_telefono: phone });
    return json(r, r && r.ok ? 200 : 400);
  } catch (err) {
    console.error("[check-welcome-coupon] Supabase fall\xF3: " + String(err));
    return json({ ok: false, error: "Could not reach the database" }, 502);
  }
}
__name(cuponSupabase, "cuponSupabase");
var GA4_TELEFONOS_EQUIPO = ["4141742967"];
var GA4_MAX_ATRASO_MS = 70 * 60 * 60 * 1e3;
function sinTildes(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
__name(sinTildes, "sinTildes");
function telefonoIdentifica(env, phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 10) return false;
  const extra = String(env.GA4_SHARED_PHONES || "").split(",").map(function(x) {
    return x.replace(/\D/g, "").slice(-10);
  }).filter(Boolean);
  return GA4_TELEFONOS_EQUIPO.concat(extra).indexOf(d.slice(-10)) === -1;
}
__name(telefonoIdentifica, "telefonoIdentifica");
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(function(b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}
__name(sha256Hex, "sha256Hex");
async function ga4ClientIdAnonimo(env, phone, name) {
  const digits = telefonoIdentifica(env, phone) ? String(phone).replace(/\D/g, "").slice(-10) : "";
  const key = digits ? "tel:" + digits : "nombre:" + sinTildes(name).trim();
  if (key === "nombre:") return "";
  return "apex." + (await sha256Hex("apex-ga4:" + key)).slice(0, 20);
}
__name(ga4ClientIdAnonimo, "ga4ClientIdAnonimo");
async function ga4CuerpoCompra(env, d, nowMs) {
  const clientId = String(d.clientId || "").trim() || await ga4ClientIdAnonimo(env, d.telefono, d.cliente);
  if (!clientId) return null;
  let value = 0;
  const items = (d.items || []).map(function(it) {
    const price = Number(it.precio) || 0;
    const quantity = Number(it.cantidad) || 1;
    value += price * quantity;
    const item = { item_name: String(it.producto || ""), item_brand: String(it.marca || ""), item_category: String(it.categoria || ""), price: Math.round(price * 100) / 100, quantity };
    if (it.subcategoria) item.item_category2 = String(it.subcategoria);
    return item;
  });
  const params = { transaction_id: String(d.oc), value: Math.round(value * 100) / 100, currency: "USD", items, engagement_time_msec: 1 };
  const delivery = String(d.entrega || "");
  if (delivery.indexOf("$") !== -1) {
    const n = parseFloat(delivery.replace(/[^0-9.\-]/g, ""));
    if (n > 0) params.shipping = n;
  }
  if (d.sessionId) params.session_id = String(d.sessionId);
  const body = { client_id: clientId, events: [{ name: "purchase", params }] };
  const orderMs = Number(d.createdMs);
  const now = nowMs || Date.now();
  if (orderMs > 0 && orderMs <= now && now - orderMs <= GA4_MAX_ATRASO_MS) body.timestamp_micros = String(Math.round(orderMs) * 1e3);
  return body;
}
__name(ga4CuerpoCompra, "ga4CuerpoCompra");
async function enviarCompraGa4(env, oc) {
  if (!env.GA4_API_SECRET) {
    console.error("[ga4] Falta GA4_API_SECRET: la venta " + oc + " queda pendiente de enviar");
    return;
  }
  let datos = null;
  try {
    datos = await supabaseRpc(env, "tienda_ga4_reclamar", { p_oc: oc });
    if (!datos) return;
    const body = await ga4CuerpoCompra(env, datos);
    const debug = env.GA4_DEBUG === "1";
    let enviada = false;
    if (!body) {
      console.error("[ga4] Pedido " + oc + " sin forma de identificar al cliente");
    } else {
      const url = "https://www.google-analytics.com/" + (debug ? "debug/mp/collect" : "mp/collect") + "?measurement_id=" + encodeURIComponent(env.GA4_MEASUREMENT_ID || "G-CKJ8VQSLLE") + "&api_secret=" + encodeURIComponent(env.GA4_API_SECRET);
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) console.error("[ga4] Pedido " + oc + " HTTP " + res.status);
      else if (debug) console.log("[ga4 debug] " + oc + " " + (await res.text()).slice(0, 400));
      enviada = res.ok && !debug;
    }
    if (!enviada) await supabaseRpc(env, "tienda_ga4_liberar", { p_oc: oc });
  } catch (err) {
    console.error("[ga4] Pedido " + oc + " fall\xF3: " + String(err));
    if (datos) {
      try {
        await supabaseRpc(env, "tienda_ga4_liberar", { p_oc: oc });
      } catch (e) {
      }
    }
  }
}
__name(enviarCompraGa4, "enviarCompraGa4");
async function sincronizarVentasGa4(env) {
  try {
    const pendientes = await supabaseRpc(env, "tienda_ga4_pendientes", {});
    for (const oc of (pendientes || []).slice(0, 50)) await enviarCompraGa4(env, oc);
  } catch (err) {
    console.error("[ga4] La revisi\xF3n de ventas sin enviar fall\xF3: " + String(err));
  }
}
__name(sincronizarVentasGa4, "sincronizarVentasGa4");
var RECORDATORIO_CRONS = ["0 12 * * MON", "0 13 * * MON", "0 20 * * FRI", "0 21 * * FRI"];
var RECORDATORIO_PANEL_URL = "https://apexnutricionve.com/panel";
function escHtml(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
__name(escHtml, "escHtml");
function esperaLegible(ms) {
  const min = Math.max(0, Math.floor(ms / 6e4));
  if (min < 60) return "hace " + min + " min";
  if (min < 1440) return "hace " + Math.floor(min / 60) + " h";
  const d = Math.floor(min / 1440);
  return "hace " + d + (d === 1 ? " d\xEDa" : " d\xEDas");
}
__name(esperaLegible, "esperaLegible");
function armarCorreoPendientes(pend, ahoraMs, prueba) {
  const nuevos = pend.filter(function(o) {
    return o.stage === "new";
  });
  const entrega = pend.filter(function(o) {
    return o.stage !== "new";
  });
  const dinero = /* @__PURE__ */ __name(function(n) {
    return "$" + Number(n).toFixed(2).replace(".", ",");
  }, "dinero");
  const falta = /* @__PURE__ */ __name(function(o) {
    return o.stage === "delivery" ? "Falta indicar c\xF3mo se entreg\xF3" : "Falta el monto del delivery";
  }, "falta");
  const asunto = (prueba ? "[PRUEBA] " : "") + "Apex: " + (pend.length ? pend.length + (pend.length === 1 ? " pedido pendiente" : " pedidos pendientes") + " por cerrar" : "no hay pedidos pendientes");
  const tdb = "padding:8px 10px;border-bottom:1px solid #E4DFD5";
  const tabla = /* @__PURE__ */ __name(function(titulo, arr, tercera) {
    if (!arr.length) return "";
    return '<h3 style="margin:22px 0 6px;font-size:16px">' + titulo + " (" + arr.length + ')</h3><table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#F7F5F1;text-align:left"><th style="padding:8px 10px">Pedido</th><th style="padding:8px 10px">Cliente</th><th style="padding:8px 10px;text-align:right">Total</th><th style="padding:8px 10px">Estado</th></tr></thead><tbody>' + arr.map(function(o) {
      return '<tr><td style="' + tdb + ';font-weight:700">' + escHtml(o.id) + '</td><td style="' + tdb + '">' + escHtml(o.customer || "(sin nombre)") + '</td><td style="' + tdb + ';text-align:right">' + dinero(o.total) + '</td><td style="' + tdb + ';color:#514D48">' + escHtml(tercera(o)) + "</td></tr>";
    }).join("") + "</tbody></table>";
  }, "tabla");
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#14120F;max-width:640px"><h2 style="margin:0 0 4px;font-size:20px">Pedidos pendientes por cerrar</h2><p style="margin:0 0 8px;color:#514D48">' + (pend.length ? "Estos pedidos siguen sin cerrar en el panel." : "No hay pedidos pendientes. Todo est\xE1 al d\xEDa.") + "</p>" + tabla("Sin confirmar", nuevos, function(o) {
    return esperaLegible(ahoraMs - o.createdMs);
  }) + tabla("Confirmados, falta cerrar la entrega", entrega, function(o) {
    return falta(o) + " \xB7 " + esperaLegible(ahoraMs - o.createdMs);
  }) + '<p style="margin:24px 0"><a href="' + RECORDATORIO_PANEL_URL + '" style="background:#14120F;color:#fff;padding:12px 20px;text-decoration:none;font-weight:700">Abrir el panel de pedidos</a></p><p style="font-size:12px;color:#726E67">Este recordatorio se env\xEDa los lunes y los viernes, solo si hay pedidos pendientes.</p></div>';
  const lineas = /* @__PURE__ */ __name(function(arr, tercera) {
    return arr.map(function(o) {
      return "- " + o.id + " \xB7 " + (o.customer || "(sin nombre)") + " \xB7 " + dinero(o.total) + " \xB7 " + tercera(o);
    }).join("\n");
  }, "lineas");
  const text = "Pedidos pendientes por cerrar\n\n" + (nuevos.length ? "SIN CONFIRMAR (" + nuevos.length + ")\n" + lineas(nuevos, function(o) {
    return esperaLegible(ahoraMs - o.createdMs);
  }) + "\n\n" : "") + (entrega.length ? "CONFIRMADOS, FALTA CERRAR LA ENTREGA (" + entrega.length + ")\n" + lineas(entrega, function(o) {
    return falta(o) + " \xB7 " + esperaLegible(ahoraMs - o.createdMs);
  }) + "\n\n" : "") + (pend.length ? "" : "No hay pedidos pendientes. Todo est\xE1 al d\xEDa.\n\n") + "Panel: " + RECORDATORIO_PANEL_URL;
  return { subject: asunto, html, text };
}
__name(armarCorreoPendientes, "armarCorreoPendientes");
async function enviarRecordatorioPedidos(env, prueba) {
  if (!usaSupabase(env)) return { estado: "omitido", detalle: "Supabase apagado" };
  const hoy = (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
  const clave = prueba ? "prueba:" + Date.now() : "rec:" + hoy;
  try {
    if (!await supabaseRpc(env, "tienda_recordatorio_iniciar", { p_clave: clave, p_tipo: prueba ? "prueba" : "semanal" })) return { estado: "omitido", detalle: "ya se envi\xF3 hoy" };
    let estado = "error", pendientes = null, detalle = "";
    try {
      if (!env.RESEND_API_KEY) {
        detalle = "Falta RESEND_API_KEY";
      } else {
        const lista = await supabaseRpc(env, "tienda_panel_listar", {});
        const pend = (lista.orders || []).filter(function(o) {
          return o.stage !== "done";
        }).sort(function(a, b) {
          return a.createdMs - b.createdMs;
        });
        pendientes = pend.length;
        if (!pend.length && !prueba) {
          estado = "omitido";
          detalle = "sin pendientes";
        } else {
          const para = String(await supabaseRpc(env, "tienda_recordatorio_destino", {}) || "").split(",").map(function(x) {
            return x.trim();
          }).filter(Boolean);
          if (!para.length) throw new Error("No hay destinatario guardado");
          const correo = armarCorreoPendientes(pend, lista.now, prueba);
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ from: env.RECORDATORIO_DESDE || "Apex Nutrici\xF3n <recordatorio@apexnutricionve.com>", to: para, subject: correo.subject, html: correo.html, text: correo.text })
          });
          if (res.ok) {
            estado = "enviado";
            detalle = "ok";
          } else {
            detalle = "Resend HTTP " + res.status + " " + (await res.text()).slice(0, 150);
          }
        }
      }
    } catch (err) {
      detalle = String(err).slice(0, 200);
    }
    await supabaseRpc(env, "tienda_recordatorio_cerrar", { p_clave: clave, p_estado: estado, p_pendientes: pendientes, p_detalle: detalle });
    if (estado === "error") console.error("[recordatorio] " + detalle);
    return { estado, pendientes, detalle };
  } catch (err) {
    console.error("[recordatorio] fall\xF3: " + String(err));
    return { estado: "error", detalle: String(err).slice(0, 200) };
  }
}
__name(enviarRecordatorioPedidos, "enviarRecordatorioPedidos");
var BF_PEDIDOS_DESDE_MS = Date.parse("2026-11-23T04:00:00Z");
var BF_PEDIDOS_HASTA_MS = Date.parse("2026-11-30T04:00:00Z");
var BF_VIGILAR_HASTA_MS = Date.parse("2026-12-02T04:00:00Z");
function bfUsd(n) {
  return "$" + Number(n).toFixed(2).replace(".", ",");
}
__name(bfUsd, "bfUsd");
function bfRevisarPedido(o) {
  const items = o.items || [];
  const lineas = [];
  const sobres = items.filter(function(i) {
    return /hidratante/i.test(i.product) && !/300\s*g/i.test(i.product) && Number(i.price) < 10;
  });
  const sobresTotal = sobres.reduce(function(a, i) {
    return a + Number(i.qty);
  }, 0);
  const revisa = /* @__PURE__ */ __name(function(i, nombre, esperado, tol) {
    const real = Number(i.price);
    const ok = Math.abs(real - esperado) <= tol;
    lineas.push({ ok, texto: nombre + " \xD7 " + i.qty + ": " + (ok ? "precio " + bfUsd(real) + " (con 25% OFF)" : "precio " + real.toFixed(4).replace(".", ",") + ", se esperaba " + esperado.toFixed(4).replace(".", ",") + " (25% OFF)") });
  }, "revisa");
  items.forEach(function(i) {
    const nombre = String(i.product || "");
    if (/prote[ií]na en polvo chocolate/i.test(nombre) && !/sobre/i.test(nombre) && (/600\s*g/i.test(nombre) || Number(i.price) >= 20)) revisa(i, "Prote\xEDna chocolate 600 g", 24, 0.01);
    else if (/skratch/i.test(nombre + " " + (i.brand || "")) && /bolsa/i.test(nombre) && /440/.test(nombre)) revisa(i, nombre.replace(/Sport Hydration Drink Mix\s*/i, "Skratch bolsa ").replace(/\s*—.*$/, ""), 26.6625, 0.01);
    else if (sobresTotal >= 24 && sobres.indexOf(i) !== -1) revisa(i, nombre.replace(/\s*Going$/i, "") + " (caja de " + sobresTotal + ")", 38.64 / 24 * 0.75, 5e-3);
  });
  return { hayBf: lineas.length > 0, ok: lineas.every(function(l) {
    return l.ok;
  }), lineas };
}
__name(bfRevisarPedido, "bfRevisarPedido");
function bfArmarCorreo(o, rev, primero) {
  const estado = rev.ok ? "todo bien" : "REVISAR PRECIOS";
  const asunto = "Black Friday: " + (primero ? "primer pedido con oferta" : "pedido con precio distinto") + " (" + o.id + ") \u2014 " + estado;
  const fecha = new Date(o.createdMs).toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "medium", timeStyle: "short" });
  const filas = rev.lineas.map(function(l) {
    return '<li style="margin:4px 0;color:' + (l.ok ? "#14120F" : "#B3261E") + '">' + (l.ok ? "\u2713 " : "\u2717 ") + escHtml(l.texto) + "</li>";
  }).join("");
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#14120F;max-width:640px"><h2 style="margin:0 0 4px;font-size:20px">' + (primero ? "Entr\xF3 el primer pedido con Black Friday" : "Un pedido de Black Friday trae un precio distinto") + '</h2><p style="margin:0 0 10px;color:#514D48">Pedido <strong>' + escHtml(o.id) + "</strong> \xB7 " + escHtml(fecha) + " (hora de Caracas) \xB7 total de productos " + bfUsd(o.total) + '</p><p style="margin:0 0 6px;font-weight:700">' + (rev.ok ? "Los precios de la oferta quedaron como deben." : "Alg\xFAn precio de la oferta no coincide con lo esperado.") + '</p><ul style="padding-left:18px;margin:0 0 14px;font-size:14px">' + filas + '</ul><p style="margin:0 0 14px;font-size:14px;color:#514D48">Cuando lo confirmes en el panel, la venta pasa a GA4 sola (en menos de una hora).</p><p style="margin:18px 0"><a href="' + RECORDATORIO_PANEL_URL + '" style="background:#14120F;color:#fff;padding:12px 20px;text-decoration:none;font-weight:700">Abrir el panel de pedidos</a></p><p style="font-size:12px;color:#726E67">Aviso autom\xE1tico de Black Friday (23 al 29 de nov). Solo lee los pedidos; no cambia nada.</p></div>';
  const text = asunto + "\n\nPedido " + o.id + " \xB7 " + fecha + " \xB7 total de productos " + bfUsd(o.total) + "\n" + rev.lineas.map(function(l) {
    return (l.ok ? "[ok] " : "[REVISAR] ") + l.texto;
  }).join("\n") + "\n\nPanel: " + RECORDATORIO_PANEL_URL;
  return { subject: asunto, html, text };
}
__name(bfArmarCorreo, "bfArmarCorreo");
async function bfEnviarAviso(env, clave, correo) {
  if (!await supabaseRpc(env, "tienda_recordatorio_iniciar", { p_clave: clave, p_tipo: "semanal" })) return;
  let estado = "error", detalle = "";
  try {
    if (!env.RESEND_API_KEY) throw new Error("Falta RESEND_API_KEY");
    const para = String(await supabaseRpc(env, "tienda_recordatorio_destino", {}) || "").split(",").map(function(x) {
      return x.trim();
    }).filter(Boolean);
    if (!para.length) throw new Error("No hay destinatario guardado");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RECORDATORIO_DESDE || "Apex Nutrici\xF3n <recordatorio@apexnutricionve.com>", to: para, subject: correo.subject, html: correo.html, text: correo.text })
    });
    if (res.ok) {
      estado = "enviado";
      detalle = "ok";
    } else {
      detalle = "Resend HTTP " + res.status + " " + (await res.text()).slice(0, 150);
    }
  } catch (err) {
    detalle = String(err).slice(0, 200);
  }
  await supabaseRpc(env, "tienda_recordatorio_cerrar", { p_clave: clave, p_estado: estado, p_pendientes: null, p_detalle: detalle });
  if (estado === "error") console.error("[black-friday] " + detalle);
}
__name(bfEnviarAviso, "bfEnviarAviso");
async function vigilarBlackFriday(env) {
  const ahora = Date.now();
  if (ahora < BF_PEDIDOS_DESDE_MS || ahora > BF_VIGILAR_HASTA_MS) return;
  try {
    const lista = await supabaseRpc(env, "tienda_panel_listar", {});
    const pedidos = (lista.orders || []).filter(function(o) {
      return o.createdMs >= BF_PEDIDOS_DESDE_MS && o.createdMs < BF_PEDIDOS_HASTA_MS;
    }).sort(function(a, b) {
      return a.createdMs - b.createdMs;
    });
    let primeroId = null;
    for (const o of pedidos) {
      const rev = bfRevisarPedido(o);
      if (!rev.hayBf) continue;
      if (primeroId === null) {
        primeroId = o.id;
        await bfEnviarAviso(env, "bf:primero", bfArmarCorreo(o, rev, true));
      } else if (!rev.ok) {
        await bfEnviarAviso(env, "bf:alerta:" + o.id, bfArmarCorreo(o, rev, false));
      }
    }
  } catch (err) {
    console.error("[black-friday] La revisi\xF3n fall\xF3: " + String(err));
  }
}
__name(vigilarBlackFriday, "vigilarBlackFriday");
var PANEL_COOKIE = "apex_panel";
var PANEL_SESSION_SECONDS = 14 * 24 * 3600;
var PANEL_ACTIONS = ["completed", "canceled", "pickup", "delivery", "delivery_price", "confirm_delivery"];
var PANEL_LIST_CACHE_MS = 4e3;
var panelListCache = null;
function panelJson(body, status) {
  const res = json(body, status);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}
__name(panelJson, "panelJson");
async function hmacBase64Url(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  let bin = "";
  for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(hmacBase64Url, "hmacBase64Url");
async function safeEqual(a, b) {
  const pair = await Promise.all([hmacBase64Url("apex-panel-compare", String(a)), hmacBase64Url("apex-panel-compare", String(b))]);
  let diff = pair[0].length ^ pair[1].length;
  for (let i = 0; i < pair[0].length && i < pair[1].length; i++) diff |= pair[0].charCodeAt(i) ^ pair[1].charCodeAt(i);
  return diff === 0;
}
__name(safeEqual, "safeEqual");
async function panelMakeToken(env) {
  const exp = Math.floor(Date.now() / 1e3) + PANEL_SESSION_SECONDS;
  return exp + "." + await hmacBase64Url(env.PANEL_CODE + "|apex-panel-session", String(exp));
}
__name(panelMakeToken, "panelMakeToken");
async function panelIsAuthed(request, env) {
  const match = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + PANEL_COOKIE + "=([^;]+)"));
  if (!match) return false;
  const parts = match[1].split(".");
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !parts[1]) return false;
  if (Number(parts[0]) < Date.now() / 1e3) return false;
  return safeEqual(parts[1], await hmacBase64Url(env.PANEL_CODE + "|apex-panel-session", parts[0]));
}
__name(panelIsAuthed, "panelIsAuthed");
function panelCookie(value, maxAge) {
  return PANEL_COOKIE + "=" + value + "; Path=/api/panel; Max-Age=" + maxAge + "; HttpOnly; Secure; SameSite=Strict";
}
__name(panelCookie, "panelCookie");
async function handlePanel(request, env, url, ctx) {
  if (!env.PANEL_CODE || !usaSupabase(env)) {
    console.error("[panel] Faltan PANEL_CODE o la configuraci\xF3n de Supabase en las variables del Worker");
    return panelJson({ ok: false, error: "Panel not configured" }, 503);
  }
  const route = url.pathname.slice("/api/panel/".length);
  if (route === "login") {
    if (request.method !== "POST") return panelJson({ ok: false, error: "Method not allowed" }, 405);
    const blocked = await guardPublicApi(request, env.ORDER_LIMITER, "panel-login");
    if (blocked) {
      blocked.headers.set("Cache-Control", "no-store");
      return blocked;
    }
    let code = "";
    try {
      const body = await readJsonBody(request);
      code = body.payload && typeof body.payload.code === "string" ? body.payload.code : "";
    } catch (err) {
    }
    if (!code || code.length > 200 || !await safeEqual(code, env.PANEL_CODE)) {
      console.error("[panel] C\xF3digo incorrecto desde " + clientIp(request));
      return panelJson({ ok: false, error: "Unauthorized" }, 401);
    }
    const res = panelJson({ ok: true });
    res.headers.append("Set-Cookie", panelCookie(await panelMakeToken(env), PANEL_SESSION_SECONDS));
    return res;
  }
  if (route === "logout") {
    if (request.method !== "POST") return panelJson({ ok: false, error: "Method not allowed" }, 405);
    const res = panelJson({ ok: true });
    res.headers.append("Set-Cookie", panelCookie("", 0));
    return res;
  }
  if (!await panelIsAuthed(request, env)) return panelJson({ ok: false, error: "Unauthorized" }, 401);
  if (route === "orders") {
    if (request.method !== "GET") return panelJson({ ok: false, error: "Method not allowed" }, 405);
    if (panelListCache && Date.now() - panelListCache.t < PANEL_LIST_CACHE_MS) {
      return panelJson({ ok: true, now: Date.now(), orders: panelListCache.orders });
    }
    let result;
    try {
      result = await supabaseRpc(env, "tienda_panel_listar", {});
    } catch (err) {
      console.error("[panel] Supabase (listar): " + String(err));
      result = { ok: false, error: "No se pudo leer los pedidos" };
    }
    if (!result || result.ok !== true || !Array.isArray(result.orders)) {
      console.error("[panel] No se pudo leer los pedidos: " + (result && result.error));
      return panelJson({ ok: false, error: "No se pudo leer los pedidos. Intenta otra vez." }, 502);
    }
    panelListCache = { t: Date.now(), orders: result.orders };
    return panelJson({ ok: true, now: Date.now(), orders: result.orders });
  }
  if (route === "recordatorio-prueba") {
    if (request.method !== "POST") return panelJson({ ok: false, error: "Method not allowed" }, 405);
    const blocked = await guardPublicApi(request, env.API_LIMITER, "panel-recordatorio-prueba");
    if (blocked) {
      blocked.headers.set("Cache-Control", "no-store");
      return blocked;
    }
    const r = await enviarRecordatorioPedidos(env, true);
    return panelJson({ ok: r.estado === "enviado", estado: r.estado, pendientes: r.pendientes === void 0 ? null : r.pendientes, error: r.estado === "enviado" ? void 0 : r.detalle || "No se pudo enviar" }, r.estado === "enviado" ? 200 : 502);
  }
  if (route === "action") {
    if (request.method !== "POST") return panelJson({ ok: false, error: "Method not allowed" }, 405);
    const blocked = await guardPublicApi(request, env.API_LIMITER, "panel-action");
    if (blocked) {
      blocked.headers.set("Cache-Control", "no-store");
      return blocked;
    }
    let body;
    try {
      body = (await readJsonBody(request)).payload;
    } catch (err) {
      return panelJson({ ok: false, error: "Bad JSON" }, 400);
    }
    const orderId = body && typeof body.orderId === "string" ? body.orderId : "";
    const action = body && body.action;
    const value = body && typeof body.value === "string" ? body.value.trim() : null;
    if (!/^\d{1,8}$/.test(orderId)) return panelJson({ ok: false, error: "N\xFAmero de pedido inv\xE1lido" }, 400);
    if (PANEL_ACTIONS.indexOf(action) === -1) return panelJson({ ok: false, error: "Acci\xF3n no permitida" }, 400);
    if (action === "delivery_price" && (!value || value.length > 80)) return panelJson({ ok: false, error: "Escribe el monto del delivery (o una nota corta)." }, 400);
    if (action === "confirm_delivery") {
      const tipo = body && body.tipo;
      const paga = body && body.paga;
      if (tipo !== "delivery" && tipo !== "pickup") return panelJson({ ok: false, error: "Elige Delivery o Pick up." }, 400);
      if (tipo === "delivery" && paga !== "Cliente" && paga !== "Tienda") return panelJson({ ok: false, error: "Elige qui\xE9n paga el delivery." }, 400);
      if (tipo === "delivery" && (!value || value.length > 80)) return panelJson({ ok: false, error: "Escribe el monto del delivery (o una nota corta)." }, 400);
      panelListCache = null;
      let conf;
      try {
        conf = await supabaseRpc(env, "tienda_panel_accion", { p_oc: orderId, p_accion: "completed", p_valor: null });
      } catch (err) {
        console.error("[panel] Supabase (confirmar): " + String(err));
        conf = { ok: false, error: "No se pudo guardar. Intenta otra vez." };
      }
      if (!conf || conf.ok !== true) {
        panelListCache = null;
        return panelJson({ ok: false, error: conf && conf.error || "No se pudo guardar. Intenta otra vez." }, 400);
      }
      if (conf.enviar_ga4) {
        const envio = enviarCompraGa4(env, orderId);
        if (ctx && ctx.waitUntil) ctx.waitUntil(envio);
        else await envio;
      }
      let r;
      try {
        r = await supabaseRpc(env, "tienda_panel_editar_entrega", { p_oc: orderId, p_tipo: tipo, p_paga: tipo === "delivery" ? paga : null, p_valor: tipo === "delivery" ? value : null });
      } catch (err) {
        console.error("[panel] Supabase (entrega): " + String(err));
        r = { ok: false, error: "No se pudo guardar la entrega." };
      }
      panelListCache = null;
      if (!r || r.ok !== true) return panelJson({ ok: false, error: "El pedido qued\xF3 confirmado, pero falta guardar la entrega: " + (r && r.error || "intenta otra vez.") }, 400);
      return panelJson({ ok: true });
    }
    panelListCache = null;
    let result;
    try {
      result = await supabaseRpc(env, "tienda_panel_accion", { p_oc: orderId, p_accion: action, p_valor: action === "delivery_price" ? value : null });
    } catch (err) {
      console.error("[panel] Supabase (acci\xF3n " + action + "): " + String(err));
      result = { ok: false, error: "No se pudo guardar. Intenta otra vez." };
    }
    if (result && result.ok === true && action === "completed" && result.enviar_ga4) {
      const envio = enviarCompraGa4(env, orderId);
      if (ctx && ctx.waitUntil) ctx.waitUntil(envio);
      else await envio;
    }
    panelListCache = null;
    if (!result || result.ok !== true) {
      console.error("[panel] Acci\xF3n " + action + " en " + orderId + " fall\xF3: " + (result && result.error));
      return panelJson({ ok: false, error: result && result.error || "No se pudo guardar. Intenta otra vez." }, 400);
    }
    return panelJson({ ok: true });
  }
  return panelJson({ ok: false, error: "Not found" }, 404);
}
__name(handlePanel, "handlePanel");
var PROMOS_CACHE_MS = 5 * 60 * 1e3;
var promosCache = null;
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
__name(parseCsv, "parseCsv");
function promoFechaIso(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
__name(promoFechaIso, "promoFechaIso");
function promosDesdeCsv(text) {
  const rows = parseCsv(text);
  const start = rows.findIndex(function(r) {
    return /^1\.\s*Promoci/i.test(String(r[0] || "").trim());
  });
  if (start < 0) throw new Error("No se encontr\xF3 el encabezado de la hoja");
  const promos = [];
  const descartadas = [];
  rows.slice(start + 1).forEach(function(r) {
    if (!String(r[0] || "").trim()) return;
    if (String(r[7] || "").trim() !== "LISTO") {
      descartadas.push(String(r[0]).trim() + " / " + String(r[1] || "").trim());
      return;
    }
    const rate = Number(String(r[2] || "").replace("%", "").replace(",", ".").trim()) / 100;
    const desde = promoFechaIso(r[3]);
    const hasta = promoFechaIso(r[4]);
    const min = Math.max(1, Math.floor(Number(String(r[5] || "1").trim()) || 1));
    if (!(rate > 0 && rate <= 0.9) || !desde || !hasta || desde > hasta) {
      descartadas.push(String(r[0]).trim() + " / " + String(r[1] || "").trim());
      return;
    }
    promos.push({
      nombre: String(r[0]).trim().slice(0, 60),
      producto: String(r[1] || "").trim().slice(0, 120),
      rate: Math.round(rate * 1e4) / 1e4,
      desde,
      hasta,
      min,
      base: min > 1 ? "caja" : "normal"
      // con caja (12, 24...) el % se calcula sobre el precio de la caja; con 1 unidad, sobre el normal
    });
  });
  return { promos, descartadas: descartadas.length };
}
__name(promosDesdeCsv, "promosDesdeCsv");
async function handlePromos(request, env) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (request.method !== "GET") return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers });
  if (!env.PROMOS_CSV_URL) {
    headers["Cache-Control"] = "no-store";
    return new Response(JSON.stringify({ ok: false, error: "La hoja de descuentos todav\xEDa no est\xE1 publicada" }), { status: 503, headers });
  }
  if (promosCache && Date.now() - promosCache.t < PROMOS_CACHE_MS) {
    headers["Cache-Control"] = "public, max-age=60";
    return new Response(JSON.stringify({ ok: true, promos: promosCache.promos, descartadas: promosCache.descartadas }), { headers });
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(function() {
      ctl.abort();
    }, 8e3);
    let res;
    try {
      res = await fetch(env.PROMOS_CSV_URL, { signal: ctl.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const parsed = promosDesdeCsv(await res.text());
    promosCache = { t: Date.now(), promos: parsed.promos, descartadas: parsed.descartadas };
    headers["Cache-Control"] = "public, max-age=60";
    return new Response(JSON.stringify({ ok: true, promos: parsed.promos, descartadas: parsed.descartadas }), { headers });
  } catch (err) {
    console.error("[promos] " + String(err));
    if (promosCache) {
      headers["Cache-Control"] = "no-store";
      return new Response(JSON.stringify({ ok: true, promos: promosCache.promos, descartadas: promosCache.descartadas, vieja: true }), { headers });
    }
    headers["Cache-Control"] = "no-store";
    return new Response(JSON.stringify({ ok: false, error: "No se pudo leer la hoja de descuentos" }), { status: 502, headers });
  }
}
__name(handlePromos, "handlePromos");

// ../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-V3pjeE/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-V3pjeE/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
