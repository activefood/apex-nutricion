'use strict';

/* ---------- Bloqueo de pellizco para zoom (iOS Safari) ----------
   maximum-scale=1.0 en el viewport y touch-action en el CSS no siempre
   alcanzan en Safari de iPhone — a veces igual deja hacer zoom por
   pellizco. gesturestart/gesturechange son eventos propios de WebKit que
   se disparan específicamente con ese gesto; cancelarlos es la forma más
   directa de bloquearlo, sin afectar el scroll normal. */
['gesturestart', 'gesturechange', 'gestureend'].forEach(function(type){
  document.addEventListener(type, function(e){ e.preventDefault(); }, { passive: false });
});

/* ---------- Reset de zoom pegado por sitio (Safari) ----------
   Safari en iPhone permite fijar un nivel de zoom guardado para todo un
   sitio (ícono "Aa" en la barra de direcciones) que no depende de nada de
   esta página — ni maximum-scale ni gesturestart lo evitan, porque no es un
   gesto, es una preferencia ya guardada que se vuelve a aplicar en cada
   carga. window.visualViewport.scale expone el zoom real con el que se
   está viendo la página ahora mismo; si no es 1, se lo forzamos una sola
   vez al cargar (no en cada resize/scroll) para no pelear con un zoom que
   alguien haga a propósito durante la sesión. */
if (window.visualViewport) {
  window.addEventListener('load', function(){
    if (Math.abs(window.visualViewport.scale - 1) < 0.01) return;
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    var original = meta.getAttribute('content');
    meta.setAttribute('content', original + ', user-scalable=no');
    requestAnimationFrame(function(){
      meta.setAttribute('content', original);
    });
  });
}

/* ---------- Cupón de bienvenida (10% en la primera compra) ----------
   No hay cuentas de usuario, así que "primera compra" se detecta por
   navegador: si este dispositivo/navegador nunca completó un pedido con el
   código, se ofrece y se aplica en el carrito. Se puede evitar con
   incógnito/otro dispositivo — es una limitación conocida y aceptada, sin
   verificación adicional del lado del backend. */
const WELCOME_COUPON_CODE = 'APEX2026';
const WELCOME_COUPON_RATE = 0.10;
const WELCOME_COUPON_STORAGE_KEY = 'apex_welcome_coupon_used';
let appliedCoupon = null; // { code, rate } mientras dure la sesión del carrito, o null

/* Promos automáticas por producto (10%, sin código). No se combinan con el 10% de primera
   compra / APEX2026: si el cliente tiene ese descuento, cubre todo el carrito y reemplaza a estas.
   - Bolsas de hidratante (Going 300 g y Skratch Labs 440 g): hasta el día de la Carrera Nike
     (8-nov-2026, hora de Caracas, inclusive).
   - Barras de proteína Probar: hasta PROBAR_PROMO_LAST_DAY (misma fecha por defecto; cambiar aquí). */
const PRODUCT_PROMO_RATE = 0.10;
const BAG_PROMO_LAST_DAY = '2026-11-08';
const PROBAR_PROMO_LAST_DAY = '2026-11-08';
const PROMO_BADGE_SELECTOR = '[data-bag-promo],[data-probar-promo]';
const PROMO_BADGE_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/></svg>10% OFF';

/* ---------- Promociones con fecha (Black Friday, Cyber Monday y las que vengan) ----------
   Los porcentajes, fechas, productos y cantidades mínimas salen de la hoja de Google "APEX - Cargar descuentos":
   el Worker (/api/promos) lee la hoja publicada y entrega las filas con ESTADO = LISTO. Si el Worker no responde se usa la
   última copia guardada en este navegador (hasta 3 días) y, si no hay, PROMOS_RESPALDO (fechas dentro: si ya vencieron, no aplican).
   Regla del dueño: los descuentos NO se suman. Con un producto en promo en el carrito aplica SOLO el descuento de la promo
   (couponForCart) y un producto con precio por cantidad no recibe además el 10% de primera compra (hasVolumeDiscount).
   Las imágenes de los banners y las tarjetas de la página de ofertas siguen siendo manuales (index.html / ofertas.html). */
const PROMO_COUPON_NAME = 'Primera compra (siempre)';
const PROMOS_CACHE_KEY = 'apex_promos_v1';
const PROMOS_FRESH_MS = 10 * 60 * 1000;
const PROMOS_STALE_MAX_MS = 3 * 24 * 60 * 60 * 1000;

/* Producto de la hoja -> cómo se reconoce en el carrito, en las tarjetas y en la ficha.
   m = patrones que TODOS deben cumplirse; x = patrones que NINGUNO debe cumplirse; fn = regla propia. */
function protRule(flavor, size600){
  return function(item){
    const text = (item.name || '') + ' ' + (item.variant || '');
    if(!new RegExp('prote[ií]na en polvo ' + flavor, 'i').test(text)) return false;
    const is600 = /600 g/i.test(text) || /proteina-tarro/i.test(item.photo || '') || /producto-going-proteina-tarro/.test(item.family || '');
    return size600 ? is600 : !is600;
  };
}
const PROMO_CATALOG = {
  'Going · Gel Energético Café': { m: [/gel energ[eé]tico caf[eé]/i] },
  'Going · Gel Energético Fresa Banano': { m: [/gel energ[eé]tico fresa banano/i] },
  'Going · Gel Energético Granada (sin cafeína)': { m: [/gel energ[eé]tico granada/i] },
  'Going · Gel Energético Guayaba': { m: [/gel energ[eé]tico guayaba/i] },
  'Going · Barra Endurance Chocolate': { m: [/barra endurance chocolate/i] },
  'Going · Barra Endurance Frutos Rojos': { m: [/barra endurance frutos rojos/i] },
  'Going · Hidratante Uva (sobres)': { m: [/hidratante uva/i], x: [/300 g/i] },
  'Going · Hidratante Coco (sobres)': { m: [/hidratante coco/i], x: [/300 g/i] },
  'Going · Hidratante Pitaya (sobres)': { m: [/hidratante pitaya/i], x: [/300 g/i] },
  'Going · Hidratante Uva 300 g (tarro)': { m: [/hidratante uva/i, /300 g/i] },
  'Going · Hidratante Coco 300 g (tarro)': { m: [/hidratante coco/i, /300 g/i] },
  'Going · Hidratante Pitaya 300 g (tarro)': { m: [/hidratante pitaya/i, /300 g/i] },
  'Going · Proteína Chocolate 600 g': { fn: protRule('chocolate', true) },
  'Going · Proteína Vainilla 600 g': { fn: protRule('vainilla', true) },
  'Going · Proteína Chocolate sobre 30 g': { fn: protRule('chocolate', false) },
  'Going · Proteína Vainilla sobre 30 g': { fn: protRule('vainilla', false) },
  'Going · Kit Carrera 10K': { m: [/kit carrera 10k/i] },
  'Going · Kit Media Maratón 21K': { m: [/kit media marat[oó]n 21k/i] },
  'Going · Kit Maratón 42K': { m: [/kit marat[oó]n 42k/i], x: [/media/i] },
  'Going · Kit Gran Fondo': { m: [/kit gran fondo/i] },
  'Going · Kit Recharge': { m: [/kit recharge/i] },
  'Honey Stinger · Gel Acai Pomegranate': { m: [/gel energ[eé]tico org[aá]nico acai pomegranate/i] },
  'Honey Stinger · Gel Fruit Smoothie': { m: [/gel energ[eé]tico org[aá]nico fruit smoothie/i] },
  'Honey Stinger · Gel Gold': { m: [/gel energ[eé]tico org[aá]nico gold/i] },
  'Honey Stinger · Gel con cafeína Strawberry Kiwi': { m: [/gel energ[eé]tico org[aá]nico.*strawberry kiwi/i] },
  'Honey Stinger · Gomitas Citrus Splash': { m: [/gomitas energ[eé]ticas org[aá]nicas citrus splash/i] },
  'Honey Stinger · Gomitas Fruit Smoothie': { m: [/gomitas energ[eé]ticas org[aá]nicas fruit smoothie/i] },
  'Honey Stinger · Waffle Chocolate': { m: [/waffle energ[eé]tico org[aá]nico chocolate/i] },
  'Honey Stinger · Waffle Miel': { m: [/waffle energ[eé]tico org[aá]nico miel/i] },
  'Honey Stinger · Waffle Vainilla': { m: [/waffle energ[eé]tico org[aá]nico vainilla/i] },
  'Probar · Barra Cookie Dough': { m: [/barra de prote[ií]na cookie dough/i] },
  'Probar · Barra Peanut Butter Chocolate': { m: [/barra de prote[ií]na peanut butter chocolate/i] },
  'Probar · Barra Sea Salt Caramel': { m: [/barra de prote[ií]na sea salt caramel/i] },
  'Probar · Gomas Bolt Fresa': { m: [/gomas energ[eé]ticas bolt fresa/i] },
  'Probar · Gomas Bolt Naranja': { m: [/gomas energ[eé]ticas bolt naranja/i] },
  'SaltStick · Cápsulas de Electrolitos': { m: [/c[aá]psulas de electrolitos/i] },
  'SaltStick · FastChews Frutos Rojos': { m: [/fastchews frutos rojos/i] },
  'SaltStick · FastChews Limonada Rosada': { m: [/fastchews limonada rosada/i] },
  'SaltStick · FastChews Limón Lima': { m: [/fastchews lim[oó]n lima/i] },
  'SaltStick · FastChews Naranja': { m: [/fastchews naranja/i] },
  'Skratch Labs · Bolsa 440 g Fresa Limonada': { m: [/fresa limonada/i, /bolsa 440 g/i] },
  'Skratch Labs · Bolsa 440 g Limón Lima': { m: [/lim[oó]n lima/i, /bolsa 440 g/i], x: [/fastchews/i] },
  'Skratch Labs · Sobres Fresa Limonada': { m: [/skratch/i, /fresa limonada/i], x: [/bolsa 440/i] },
  'Skratch Labs · Sobres Limón Lima': { m: [/skratch/i, /lim[oó]n lima/i], x: [/bolsa 440/i, /fastchews/i] },
  'Todos los productos': { fn: function(){ return true; } }
};
function promoProductMatches(key, item){
  const rule = PROMO_CATALOG[key];
  if(!rule) return false;
  if(rule.fn) return rule.fn(item);
  const text = (item.brand || '') + ' ' + (item.name || '') + ' ' + (item.variant || '');
  return (rule.m || []).every(function(re){ return re.test(text); }) && !(rule.x || []).some(function(re){ return re.test(text); });
}

/* Copia de respaldo (la misma de la hoja el 2026-11-23): solo se usa si no hay hoja ni copia guardada. */
function respaldoFila(nombre, producto, pct, desde, hasta, min, base){
  return { nombre: nombre, producto: producto, rate: pct / 100, desde: desde, hasta: hasta, min: min, base: base };
}
const PROMOS_RESPALDO = [
  respaldoFila('Black Friday', 'Going · Proteína Chocolate 600 g', 25, '2026-11-23', '2026-11-29', 1, 'normal'),
  respaldoFila('Black Friday', 'Skratch Labs · Bolsa 440 g Fresa Limonada', 25, '2026-11-23', '2026-11-29', 1, 'normal'),
  respaldoFila('Black Friday', 'Skratch Labs · Bolsa 440 g Limón Lima', 25, '2026-11-23', '2026-11-29', 1, 'normal'),
  respaldoFila('Black Friday', 'Going · Hidratante Uva (sobres)', 25, '2026-11-23', '2026-11-29', 24, 'caja'),
  respaldoFila('Black Friday', 'Going · Hidratante Coco (sobres)', 25, '2026-11-23', '2026-11-29', 24, 'caja'),
  respaldoFila('Black Friday', 'Going · Hidratante Pitaya (sobres)', 25, '2026-11-23', '2026-11-29', 24, 'caja'),
  respaldoFila('Cyber Monday', 'Skratch Labs · Bolsa 440 g Fresa Limonada', 50, '2026-11-30', '2026-11-30', 1, 'normal'),
  respaldoFila('Cyber Monday', 'Skratch Labs · Bolsa 440 g Limón Lima', 50, '2026-11-30', '2026-11-30', 1, 'normal'),
  respaldoFila('Cyber Monday', 'Skratch Labs · Sobres Fresa Limonada', 50, '2026-11-30', '2026-11-30', 12, 'caja'),
  respaldoFila('Cyber Monday', 'Skratch Labs · Sobres Limón Lima', 50, '2026-11-30', '2026-11-30', 12, 'caja'),
  respaldoFila('Cyber Monday', 'SaltStick · FastChews Frutos Rojos', 50, '2026-11-30', '2026-11-30', 24, 'caja'),
  respaldoFila('Cyber Monday', 'SaltStick · FastChews Limonada Rosada', 50, '2026-11-30', '2026-11-30', 24, 'caja'),
  respaldoFila('Cyber Monday', 'SaltStick · FastChews Limón Lima', 50, '2026-11-30', '2026-11-30', 24, 'caja'),
  respaldoFila('Cyber Monday', 'SaltStick · FastChews Naranja', 50, '2026-11-30', '2026-11-30', 24, 'caja'),
  respaldoFila('Cyber Monday', 'SaltStick · Cápsulas de Electrolitos', 50, '2026-11-30', '2026-11-30', 24, 'caja'),
  respaldoFila(PROMO_COUPON_NAME, 'Todos los productos', 10, '2026-11-30', '2030-12-31', 1, 'normal')
];

function readPromosCache(maxAgeMs){
  try {
    const raw = localStorage.getItem(PROMOS_CACHE_KEY);
    if(!raw) return null;
    const o = JSON.parse(raw);
    if(!o || !Array.isArray(o.promos) || !(Date.now() - o.t <= maxAgeMs)) return null;
    return o;
  } catch(e){ return null; }
}
let PROMOS = (function(){
  const c = readPromosCache(PROMOS_STALE_MAX_MS);
  return c ? c.promos : PROMOS_RESPALDO;
})();
/* Pide las promos al Worker (como mucho cada 10 minutos). Si cambiaron, el carrito se repinta y las demás páginas se recargan una vez. */
function refreshPromos(){
  if(readPromosCache(PROMOS_FRESH_MS)) return;
  fetch('/api/promos', { cache: 'no-store' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    if(!d || d.ok !== true || !Array.isArray(d.promos)) return;
    const changed = JSON.stringify(d.promos) !== JSON.stringify(PROMOS);
    try { localStorage.setItem(PROMOS_CACHE_KEY, JSON.stringify({ t: Date.now(), promos: d.promos })); } catch(e){}
    if(!changed) return;
    PROMOS = d.promos;
    if(typeof window.__apexCartRerender === 'function'){ window.__apexCartRerender(); return; }
    try {
      if(sessionStorage.getItem('apex_promos_reload')) return;
      sessionStorage.setItem('apex_promos_reload', '1');
    } catch(e){ return; }
    location.reload();
  }).catch(function(){});
}

function promoActive(p){
  const t = todayCaracas();
  return t >= p.desde && t <= p.hasta;
}
function activePromos(){
  return PROMOS.filter(function(p){ return p.nombre !== PROMO_COUPON_NAME && promoActive(p); });
}
function promoNameActive(nombre){
  return activePromos().some(function(p){ return p.nombre === nombre; });
}
function bfActive(){ return promoNameActive('Black Friday'); }
function cmActive(){ return promoNameActive('Cyber Monday'); }
function eventActive(){ return activePromos().length > 0; }
/* Tasa del código de primera compra: la de la hoja (fila "Primera compra (siempre)") o 10%. */
function welcomePromo(){
  return PROMOS.find(function(x){ return x.nombre === PROMO_COUPON_NAME; }) || null;
}
/* El 10% de primera compra se puede pausar desde la hoja: fila "Primera compra (siempre)" con fechas. Sin la fila, está activo. */
function welcomeActive(){
  const p = welcomePromo();
  return !p || promoActive(p);
}
function welcomeRate(){
  const p = welcomePromo();
  return p && promoActive(p) ? p.rate : WELCOME_COUPON_RATE;
}
/* ¿Alcanza la cantidad mínima? Con precios por cantidad la mínima es la caja (appliedTierUnits); sin ellos, las unidades del carrito. */
function promoUnitsOk(promo, item){
  const min = promo.min || 1;
  if(min <= 1) return true;
  return (item.appliedTierUnits || 0) >= min || (!item.family && (item.quantity || 0) >= min);
}
/* La promo vigente que le toca a este producto (si hay varias, la de mayor porcentaje). */
function promoForItem(item){
  let best = null;
  activePromos().forEach(function(p){
    if(!promoUnitsOk(p, item) || !promoProductMatches(p.producto, item)) return;
    if(!best || p.rate > best.rate) best = p;
  });
  return best;
}
/* Porcentaje que efectivamente se rebaja sobre el precio que ya trae el carrito. "Precio normal" parte del precio de 1 unidad; "Precio de la caja", del precio por cantidad ya aplicado. */
function promoEffectiveRate(item, promo){
  let basePrice = item.unitPrice;
  if(promo.base === 'normal' && item.tiers && item.tiers.length) basePrice = Math.max(item.unitPrice, item.tiers[0].unitPrice);
  const finalUnit = Math.min(item.unitPrice, basePrice * (1 - promo.rate));
  return item.unitPrice > 0 ? 1 - finalUnit / item.unitPrice : 0;
}
function isEventItem(item){ return !!promoForItem(item); }
function uniq(list){ return list.filter(function(v, i){ return list.indexOf(v) === i; }); }
/* Nombres y porcentajes de las promos que tocan los productos de este carrito, para las etiquetas. */
function promoNamesFor(items){
  return uniq(items.map(promoForItem).filter(Boolean).map(function(p){ return p.nombre; }));
}
function promoPctFor(items){
  const rates = uniq(items.map(promoForItem).filter(Boolean).map(function(p){ return Math.round(p.rate * 100); })).sort(function(a, b){ return a - b; });
  return rates.join('/') + '%';
}

function bagPromoActive(){
  return todayCaracas() <= BAG_PROMO_LAST_DAY;
}
function probarPromoActive(){
  return todayCaracas() <= PROBAR_PROMO_LAST_DAY;
}
function isProbarBarName(name){
  return /barra de prote[ií]na/i.test(name || '') && /probar/i.test(name || '');
}
function isProbarBarItem(item){
  return /barra de prote[ií]na/i.test(item.name || '') && /probar/i.test((item.brand || '') + ' ' + (item.name || ''));
}
/* ¿Está vigente la promo a la que pertenece esta insignia? */
function promoBadgeActive(el){
  return el.hasAttribute('data-probar-promo') ? probarPromoActive() : bagPromoActive();
}
function createPromoBadge(inline){
  const badge = document.createElement('span');
  badge.className = 'tag tag--discount' + (inline ? ' tag--inline' : '');
  badge.setAttribute('data-probar-promo', '');
  badge.hidden = true;
  badge.innerHTML = PROMO_BADGE_SVG;
  return badge;
}
/* Las barras Probar aparecen en varias páginas (inicio, catálogo, marca, ficha, "también te puede
   gustar"): en vez de repetir el HTML en cada una, la insignia se agrega aquí por nombre. */
function addProbarPromoBadges(){
  document.querySelectorAll('.product-card').forEach(function(card){
    const nameEl = card.querySelector('.product-name');
    const media = card.querySelector('.product-media');
    if(!nameEl || !media || !isProbarBarName(nameEl.textContent) || card.querySelector(PROMO_BADGE_SELECTOR)) return;
    media.insertBefore(createPromoBadge(false), media.firstChild);
  });
  const row = document.querySelector('.pdp-price-row');
  const title = document.getElementById('pdp-main-title');
  if(row && title && isProbarBarName(title.textContent) && !row.querySelector(PROMO_BADGE_SELECTOR)){
    row.appendChild(createPromoBadge(true));
  }
}
/* Insignias "10% OFF" y precio de oferta (se tacha el original y se muestra el nuevo) en los
   productos en promo, solo mientras su promo está activa. El carrito sigue recibiendo el
   precio original: el 10% lo aplica el propio carrito (applyFamilyPricing + cartDiscount). */
function initBagPromoBadges(){
  addProbarPromoBadges();
  document.querySelectorAll(PROMO_BADGE_SELECTOR).forEach(function(el){ el.hidden = !promoBadgeActive(el); });

  document.querySelectorAll('.product-card').forEach(function(card){
    const badge = card.querySelector(PROMO_BADGE_SELECTOR);
    if(!badge || !promoBadgeActive(badge)) return;
    const priceEl = card.querySelector('.product-price');
    if(!priceEl || priceEl.dataset.originalUsd) return;
    const original = parsePriceText(priceEl.textContent);
    if(original == null) return;
    priceEl.dataset.originalUsd = String(original);
    priceEl.classList.add('on-sale');
    let usdSpan = priceEl.querySelector('.product-price-usd');
    if(!usdSpan){
      priceEl.innerHTML = '';
      usdSpan = document.createElement('span');
      usdSpan.className = 'product-price-usd';
      priceEl.appendChild(usdSpan);
    }
    usdSpan.innerHTML = '<span>' + formatPrice(original * (1 - PRODUCT_PROMO_RATE)) + '</span><span class="was">' + formatPrice(original) + '</span>';
  });

  const row = document.querySelector('.pdp-price-row');
  const pdpPrice = document.getElementById('pdp-price');
  const rowBadge = row && row.querySelector(PROMO_BADGE_SELECTOR);
  if(row && pdpPrice && rowBadge && promoBadgeActive(rowBadge) && !row.classList.contains('on-sale')){
    const original = parsePriceText(pdpPrice.textContent);
    if(original != null){
      const sale = document.createElement('span');
      sale.className = 'pdp-price-sale';
      sale.textContent = formatPrice(original * (1 - PRODUCT_PROMO_RATE));
      row.classList.add('on-sale');
      row.insertBefore(sale, pdpPrice);
    }
  }
}
/* ---------- Black Friday: etiqueta "25% OFF" y precio tachado ----------
   Se agregan por nombre del producto (como las barras Probar), en tarjetas de cualquier página y en la ficha.
   El carrito sigue recibiendo el precio normal: el 25% lo aplica el carrito (promoRateForItem). */
function bfBadge(inline, rate){
  const badge = document.createElement('span');
  badge.className = 'tag tag--discount' + (inline ? ' tag--inline' : '');
  badge.setAttribute('data-bf-badge', '');
  badge.innerHTML = PROMO_BADGE_SVG.replace('10% OFF', Math.round(rate * 100) + '% OFF');
  return badge;
}
/* Producto de la ficha como si fuera una línea del carrito: sabor y presentación elegidos (la caja es la presentación activa). */
function pdpItem(units){
  const title = document.getElementById('pdp-main-title');
  if(!title) return null;
  const pill = document.querySelector('[data-pill-group="presentation"] .pill--active');
  const photo = document.getElementById('pdp-main-photo');
  return {
    name: title.textContent,
    brand: '',
    photo: photo ? (photo.getAttribute('src') || '') : '',
    variant: pill ? pill.textContent.trim() : '',
    family: location.pathname,
    quantity: 1,
    appliedTierUnits: units != null ? units : (pill ? pillUnits(pill) : 0)
  };
}
/* La promo que le toca a la ficha con lo que está elegido ahora (o null). */
function pdpPromo(){
  const item = pdpItem();
  return item ? promoForItem(item) : null;
}
/* Promo de la ficha que solo se activa con una caja (min > 1) y todavía no está elegida: para avisar dónde está el descuento. */
function pdpBoxPromoHint(){
  let found = null;
  activePromos().forEach(function(p){
    if((p.min || 1) <= 1) return;
    const item = pdpItem(p.min);
    if(item && promoUnitsOk(p, item) && promoProductMatches(p.producto, item) && (!found || p.rate > found.rate)) found = p;
  });
  return found;
}
/* Ficha de producto: se llama al cargar y cada vez que cambia el sabor o la presentación. */
function applyBfPdp(){
  const row = document.querySelector('.pdp-price-row');
  const priceEl = document.getElementById('pdp-price');
  if(!row || !priceEl) return;
  const promo = pdpPromo();
  const rate = promo ? promo.rate : 0;
  const oldSale = row.querySelector('.pdp-price-sale[data-bf]');
  const oldBadge = row.querySelector('[data-bf-badge]');
  const hint = document.querySelector('[data-bf-hint]');
  if(!rate){
    if(oldSale) oldSale.remove();
    if(oldBadge) oldBadge.remove();
    if(oldSale){ row.classList.remove('on-sale'); delete row.dataset.saleRate; }
    // Si el descuento es por caja y todavía no está elegida, se avisa dónde está el descuento.
    const boxPromo = pdpBoxPromoHint();
    if(boxPromo){
      if(!hint){
        const p = document.createElement('p');
        p.className = 'pdp-bf-hint';
        p.setAttribute('data-bf-hint', '');
        const mezcla = /capsulas/.test(location.pathname) ? '' : ' (puedes mezclar sabores)';
        p.innerHTML = '<strong>' + boxPromo.nombre + ':</strong> elige la <strong>Caja x' + boxPromo.min + '</strong>' + mezcla + ' y llévala con ' + Math.round(boxPromo.rate * 100) + '% OFF.';
        row.parentNode.insertBefore(p, row.nextSibling);
      }
    }
    return;
  }
  if(hint) hint.remove();
  const original = parsePriceText(priceEl.textContent);
  if(original == null) return;
  let sale = oldSale;
  if(!sale){
    sale = document.createElement('span');
    sale.className = 'pdp-price-sale';
    sale.setAttribute('data-bf', '');
    row.insertBefore(sale, priceEl);
  }
  sale.textContent = formatPrice(original * (1 - rate));
  if(!oldBadge) row.appendChild(bfBadge(true, rate));
  row.classList.add('on-sale');
  row.dataset.saleRate = String(rate);
  injectPdpBsPrice();
}
function initBlackFridayPrices(){
  if(!eventActive()) return;
  document.querySelectorAll('.product-card').forEach(function(card){
    const nameEl = card.querySelector('.product-name');
    const media = card.querySelector('.product-media');
    const priceEl = card.querySelector('.product-price');
    if(!nameEl || !media || !priceEl || card.querySelector('[data-bf-badge]')) return;
    const brandEl = card.querySelector('.product-brand');
    const cardPromo = promoForItem({ name: nameEl.textContent, brand: brandEl ? brandEl.textContent : '', variant: '', photo: '', family: '', quantity: 1, appliedTierUnits: 0 });
    if(!cardPromo) return;
    const cardRate = cardPromo.rate;
    // La tarjeta ya trae una promo de 10% de otra fecha (apagada): se muestra solo el 25%.
    const old = card.querySelector(PROMO_BADGE_SELECTOR);
    if(old) old.remove();
    media.insertBefore(bfBadge(false, cardRate), media.firstChild);
    const original = priceEl.dataset.originalUsd ? parseFloat(priceEl.dataset.originalUsd) : parsePriceText(priceEl.textContent);
    if(original == null) return;
    priceEl.dataset.originalUsd = String(original);
    priceEl.dataset.saleRate = String(cardRate);
    priceEl.classList.add('on-sale');
    let usdSpan = priceEl.querySelector('.product-price-usd');
    if(!usdSpan){
      priceEl.innerHTML = '';
      usdSpan = document.createElement('span');
      usdSpan.className = 'product-price-usd';
      priceEl.appendChild(usdSpan);
    }
    usdSpan.innerHTML = '<span>' + formatPrice(original * (1 - cardRate)) + '</span><span class="was">' + formatPrice(original) + '</span>';
  });
  const title = document.getElementById('pdp-main-title');
  if(title){
    applyBfPdp();
    // El sabor de la ficha cambia el título (la proteína solo es Black Friday en Chocolate): se revisa de nuevo.
    new MutationObserver(applyBfPdp).observe(title, { childList: true, characterData: true, subtree: true });
  }
}

/* ---------- Ofertas (página ofertas.html y sección del inicio) ----------
   Cada tarjeta ([data-deals-group]) se muestra solo mientras la promo de su grupo está vigente. En la
   página, si ninguna lo está se muestra el aviso de "no hay ofertas"; en el inicio, la sección
   ([data-deals-section]) se oculta completa. */
function initOffersPage(){
  const cards = document.querySelectorAll('[data-deals-group]');
  if(!cards.length) return;
  const bf = bfActive();
  const cm = cmActive();
  const active = { bag: bagPromoActive(), probar: probarPromoActive(), kits: true, box24: true, pair: true, gift: true, bf: bf, cm: cm };   // kits, cajas x24 y pareja de bolsas no tienen fecha de fin
  let any = false;
  document.querySelectorAll('[data-bf-only]').forEach(function(el){ el.hidden = !bf; });
  document.querySelectorAll('[data-cm-only]').forEach(function(el){ el.hidden = !cm; });
  cards.forEach(function(card){
    const on = !!active[card.dataset.dealsGroup] && !(bf && card.hasAttribute('data-hide-in-bf')) && !(cm && card.hasAttribute('data-hide-in-cm'));
    card.hidden = !on;
    if(on) any = true;
  });
  document.querySelectorAll('[data-deals-section]').forEach(function(sec){ sec.hidden = !any; });
  const emptyEl = document.getElementById('ofertas-empty');
  if(emptyEl) emptyEl.hidden = any;
  const grid = document.getElementById('ofertas-grid');
  if(grid) grid.hidden = !any;
  document.querySelectorAll('.deals-note').forEach(function(el){ el.hidden = !(active.bag || active.probar); });   // la nota habla del 10% de las promos con fecha
}

function isBagHydrationItem(item){
  return /hidratante.*300 g|bolsa 440 g/i.test(item.name || '');
}
function itemPromoActive(item){
  return (bagPromoActive() && isBagHydrationItem(item)) || (probarPromoActive() && isProbarBarItem(item));
}
/* Descuento automático del producto (sin código): Black Friday 25%, o el 10% de las promos con fecha. */
function promoRateForItem(item){
  const promo = promoForItem(item);
  if(promo) return promoEffectiveRate(item, promo);
  return itemPromoActive(item) ? PRODUCT_PROMO_RATE : 0;
}
/* Con un producto de Black Friday / Cyber Monday en el carrito aplica SOLO el descuento del evento (a los productos de la lista):
   el 10% de primera compra no se suma ni se usa en los demás productos. Sin evento, el código vale como siempre. */
function couponForCart(pricedCart, coupon){
  return coupon && welcomeActive() && !pricedCart.some(isEventItem) ? coupon : null;
}
/* El código de primera compra y la promo del producto no se suman: gana el mayor. */
/* Producto que ya tiene un descuento por cantidad (caja x6/x12/x24 o pareja de bolsas): no recibe además el código. */
function hasVolumeDiscount(item){
  return (item.appliedTierUnits || 0) > 1 || !!item.appliedPair;
}
function discountRateForItem(coupon, item){
  if(hasVolumeDiscount(item)) return promoRateForItem(item);
  return Math.max(coupon ? coupon.rate : 0, promoRateForItem(item));
}
/* Nombre de las promos presentes en el carrito, para las etiquetas de descuento. */
function promoLabelForCart(cart){
  const priced = applyFamilyPricing(cart);
  const names = [];
  promoNamesFor(priced).forEach(function(n){ names.push(n); });
  if(priced.some(function(i){ return bagPromoActive() && isBagHydrationItem(i); })) names.push('hidratantes en bolsa');
  if(priced.some(function(i){ return probarPromoActive() && isProbarBarItem(i); })) names.push('barras Probar');
  return names.join(' y ') || 'promoción';
}
function cartDiscount(pricedCart, coupon){
  return pricedCart.reduce(function(sum, item){
    return sum + item.unitPrice * item.quantity * discountRateForItem(coupon, item);
  }, 0);
}
/* Texto del descuento para el resumen del carrito y el mensaje del pedido. */
function discountLabelFor(cart, coupon){
  const priced = applyFamilyPricing(cart);
  const ev = priced.filter(isEventItem);
  if(coupon){
    // Los descuentos no se suman: en cada producto aplica solo el mayor (el del evento o el 10% de primera compra).
    const base = 'primera compra ' + Math.round(coupon.rate * 100) + '%';
    const pct = promoPctFor(ev);
    const evName = promoNamesFor(ev).join(' y ');
    let txt;
    if(!ev.length) txt = base;
    else txt = evName + ' ' + pct + ', no se suma a la primera compra';
    return txt + (coupon.auto ? '' : ' · código ' + coupon.code);
  }
  const rates = [];
  priced.forEach(function(i){
    const r = promoRateForItem(i);
    if(r > 0 && rates.indexOf(r) < 0) rates.push(r);
  });
  return rates.sort().map(function(r){ return Math.round(r * 100) + '%'; }).join(' / ') + ' ' + promoLabelForCart(cart);
}

function hasUsedWelcomeCoupon(){
  try { return localStorage.getItem(WELCOME_COUPON_STORAGE_KEY) === '1'; }
  catch(e){ return false; }
}
function markWelcomeCouponUsed(){
  try { localStorage.setItem(WELCOME_COUPON_STORAGE_KEY, '1'); } catch(e){}
}

/* Barra negra de anuncio (arriba del header, en todas las páginas): a quien
   todavía no haya usado el código de bienvenida le suma ese mensaje al de
   envío gratis (que queda fijo, siempre visible). */
/* Textos fijos que hablan del 10% de primera compra ([data-welcome-only]): se ocultan mientras la hoja lo tenga pausado. */
function initWelcomeCopy(){
  document.querySelectorAll('[data-welcome-only]').forEach(function(el){ el.hidden = !welcomeActive(); });
}
function initAnnounceBar(){
  const el = document.querySelector('.announce p');
  if(!el) return;
  const vigentes = activePromos();
  if(vigentes.length){
    // Una sola promo en la barra: la de mayor porcentaje (si empatan, la primera de la hoja).
    const top = vigentes.reduce(function(m, p){ return p.rate > m.rate ? p : m; }, vigentes[0]);
    const mismas = vigentes.filter(function(p){ return p.nombre === top.nombre; });
    const rates = uniq(mismas.map(function(p){ return Math.round(p.rate * 100); }));
    const pct = Math.max.apply(null, rates);
    const hasta = mismas.reduce(function(m, p){ return p.hasta > m ? p.hasta : m; }, mismas[0].hasta);
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const d = new Date(hasta + 'T12:00:00');
    const fecha = d.getDate() + ' de ' + meses[d.getMonth()];
    const desde = mismas.reduce(function(m, p){ return p.desde < m ? p.desde : m; }, mismas[0].desde);
    const cuando = desde === hasta ? 'solo hoy ' + dias[d.getDay()] + ' ' + fecha : 'hasta el ' + fecha;
    const emoji = top.nombre === 'Cyber Monday' ? '💧' : (top.nombre === 'Black Friday' ? '🔥' : '🏷️');
    const que = top.nombre === 'Cyber Monday' ? 'en hidratación' : 'en productos seleccionados';
    el.innerHTML = emoji + ' <strong>' + top.nombre.toUpperCase() + ': ' + pct + '% OFF</strong> ' + que + ', ' + cuando;
    return;
  }
  if(!hasUsedWelcomeCoupon() && welcomeActive()){
    el.innerHTML = '🎉 <strong>10% OFF</strong> automático en tu primera compra &nbsp;·&nbsp; Envío gratis desde <strong>$30</strong> en Caracas';
  }
}

/* ---------- Tasa BCV (Banco Central de Venezuela) ---------- */
const BCV_CACHE_KEY = 'apex_bcv_rate';
let bcvRate = null; // Bs por $1, null hasta que se obtenga (o si falla)

function todayCaracas(){
  // Solo en localhost: ?hoy=2026-11-27 simula esa fecha (y ?hoy= la quita) para ver promos con fecha antes de que lleguen.
  try {
    if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
      const q = new URLSearchParams(location.search).get('hoy');
      if(q !== null) sessionStorage.setItem('apex_hoy', q);
      const fake = sessionStorage.getItem('apex_hoy');
      if(/^\d{4}-\d{2}-\d{2}$/.test(fake)) return fake;
    }
  } catch(e){}
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }); // YYYY-MM-DD
}

function loadCachedBcvRate(){
  try {
    const raw = localStorage.getItem(BCV_CACHE_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.cachedDate === todayCaracas() && typeof parsed.rate === 'number') return parsed.rate;
    return null;
  } catch(e){ return null; }
}

function saveCachedBcvRate(rate){
  try {
    localStorage.setItem(BCV_CACHE_KEY, JSON.stringify({ rate: rate, cachedDate: todayCaracas() }));
  } catch(e){ /* localStorage no disponible, no es crítico */ }
}

function fetchBcvRate(){
  const cached = loadCachedBcvRate();
  if(cached != null){
    bcvRate = cached;
    return Promise.resolve(bcvRate);
  }
  return fetch('https://ve.dolarapi.com/v1/dolares/oficial')
    .then(function(res){ if(!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data){
      const rate = Number(data && data.promedio);
      if(!rate || isNaN(rate)) throw new Error('Tasa inválida');
      bcvRate = rate;
      saveCachedBcvRate(rate);
      return bcvRate;
    })
    .catch(function(err){
      console.error('No se pudo obtener la tasa BCV: ' + err);
      bcvRate = null;
      return null;
    });
}

/* Formatos numéricos venezolanos: coma decimal, punto de miles en bolívares.
   Los montos en dólares van sin separador de miles porque parsePriceText y
   addProductToCart vuelven a leer ese texto como número. */
const BS_FORMAT = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const USD_FORMAT = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const RATING_FORMAT = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatBsNumber(usdAmount){
  if(bcvRate == null || usdAmount == null || isNaN(usdAmount)) return null;
  return BS_FORMAT.format(usdAmount * bcvRate);
}

function parsePriceText(text){
  if(!text) return null;
  const match = String(text).match(/\$\s*([\d.,]+)/);
  if(!match) return null;
  const num = parseFloat(match[1].replace(',', '.'));
  return isNaN(num) ? null : num;
}

/* Agrega "≈ Bs ..." debajo del precio en cada tarjeta de producto (catálogo, home, búsqueda) */
function injectProductCardBsPrices(){
  if(bcvRate == null) return;
  document.querySelectorAll('.product-card .product-price').forEach(function(el){
    let usdSpan = el.querySelector('.product-price-usd');
    if(!usdSpan){
      const text = el.textContent;
      el.innerHTML = '';
      usdSpan = document.createElement('span');
      usdSpan.className = 'product-price-usd';
      usdSpan.textContent = text;
      el.appendChild(usdSpan);
    }
    const usd = el.dataset.originalUsd
      ? parseFloat(el.dataset.originalUsd) * (1 - (parseFloat(el.dataset.saleRate) || PRODUCT_PROMO_RATE))
      : parsePriceText(usdSpan.textContent);
    const bsFormatted = formatBsNumber(usd);
    if(bsFormatted == null) return;
    let bsSpan = el.querySelector('.product-price-bs');
    if(!bsSpan){
      bsSpan = document.createElement('span');
      bsSpan.className = 'product-price-bs';
      el.appendChild(bsSpan);
    }
    bsSpan.textContent = '≈ Bs ' + bsFormatted;
  });
}

/* Agrega "≈ Bs ... · Tasa BCV: Bs ..." debajo del precio en la ficha de producto (PDP) */
function injectPdpBsPrice(){
  if(bcvRate == null) return;
  const priceEl = document.getElementById('pdp-price');
  const bsEl = document.getElementById('pdp-price-bs');
  if(!priceEl || !bsEl) return;
  const row = priceEl.closest('.pdp-price-row');
  const onSale = row && row.classList.contains('on-sale');
  const usd = parsePriceText(priceEl.textContent) * (onSale ? 1 - (parseFloat(row.dataset.saleRate) || PRODUCT_PROMO_RATE) : 1);
  const bsFormatted = formatBsNumber(usd);
  if(bsFormatted == null) return;
  bsEl.textContent = '≈ Bs ' + bsFormatted + ' · Tasa BCV: Bs ' + formatBsNumber(1);
}

/* ---------- Eventos de embudo para GA4 (view_item / add_to_cart / begin_checkout) ----------
   Antes el sitio solo mandaba el pageview automático — no había forma de ver en
   qué paso se cae la gente entre entrar y llegar a WhatsApp. */
function trackEvent(name, params){
  try { if(typeof gtag === 'function') gtag('event', name, params || {}); } catch(e){}
}

/* ---------- Carrito real (localStorage) ---------- */
const CART_STORAGE_KEY = 'apex_cart';

function getCart(){
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e){
    return [];
  }
}

function saveCart(cart){
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch(e){
    console.error('No se pudo guardar el carrito: ' + e);
  }
}

function cartTotalQty(cart){
  return cart.reduce(function(sum, item){ return sum + item.quantity; }, 0);
}

function initCartCount(){
  const totalQty = cartTotalQty(getCart());
  document.querySelectorAll('[data-cart-count]').forEach(function(el){
    el.textContent = totalQty;
  });
}

// Tope de unidades por línea del carrito. Antes era 10 pensando en "cantidad
// de tarros/paquetes"; ahora que las cajas (x6/x12/x24) se guardan como
// unidades individuales para poder mezclar sabores, 10 sería demasiado bajo
// (ni siquiera cabría una sola caja de x12).
const CART_LINE_QTY_MAX = 120;

/* Agrega un producto al carrito real, combinando cantidad si ya existe la misma variante. */
/* ---------- Avisos para lectores de pantalla ----------
   Región aria-live compartida: cambios que solo se ven ("Agregado ✓",
   cantidades en el carrito) también se anuncian. */
let liveRegion = null;
function initLiveRegion(){
  if(liveRegion) return;
  liveRegion = document.createElement('div');
  liveRegion.className = 'visually-hidden';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  document.body.appendChild(liveRegion);
}
function announce(text){
  initLiveRegion();
  liveRegion.textContent = '';
  setTimeout(function(){ liveRegion.textContent = text; }, 50);
}

/* Honey Stinger todavía no tiene inventario ("Próximamente"): no se puede agregar al carrito. */
function isComingSoonItem(item){
  return /honey stinger/i.test((item.brand || '') + ' ' + (item.name || ''));
}

/* Agotado por ahora (hay existencias en otros sabores/presentaciones): no se puede agregar. */
function isOutOfStockItem(item){
  return /prote[ií]na en polvo vainilla\s*—\s*600 g/i.test(item.name || '');
}

function addItemToCart(item){
  if(isComingSoonItem(item)){
    announce(item.name + ' estará disponible próximamente.');
    return;
  }
  if(isOutOfStockItem(item)){
    announce(item.name + ' está agotado por ahora.');
    return;
  }
  const cart = getCart();
  const existing = cart.find(function(c){ return c.name === item.name && c.brand === item.brand && c.variant === item.variant; });
  if(existing){
    existing.quantity = Math.min(CART_LINE_QTY_MAX, existing.quantity + item.quantity);
  } else {
    cart.push({
      name: item.name,
      brand: item.brand,
      photo: item.photo,
      variant: item.variant,
      unitPrice: item.unitPrice,
      quantity: Math.min(CART_LINE_QTY_MAX, item.quantity),
      // "family" agrupa sabores de un mismo producto (ej. FastChews Naranja
      // y Frutos Rojos comparten family) para poder sumar unidades entre
      // sabores y aplicar el descuento por cantidad aunque estén mezclados.
      // "tiers" es la tabla de precios por unidad en cada tramo (1/6/12/24)
      // tal como está configurada en la ficha de ese producto.
      family: item.family || null,
      tiers: item.tiers || null,
      kit: !!item.kit   // kit de Hot Deals: su detalle (variant) se manda también en el pedido
    });
  }
  saveCart(cart);
  initCartCount();
  announce(item.name + ' agregado al carrito.');
  trackEvent('add_to_cart', {
    currency: 'USD',
    value: item.unitPrice * item.quantity,
    items: [{ item_name: item.name, item_brand: item.brand, price: item.unitPrice, quantity: item.quantity }]
  });
}

/* Agrupa el carrito por "family" y recalcula el precio por unidad de cada
   línea según el total combinado de unidades de esa familia (sumando todos
   los sabores). Tramos: si el total llega al umbral de una caja (6/12/24),
   TODAS las unidades de esa familia pagan el precio por unidad de esa caja,
   sin importar cómo estén repartidas entre sabores. No modifica el carrito
   guardado — devuelve una copia con el unitPrice ya recalculado. */
function applyFamilyPricing(cart){
  const totalsByFamily = {};
  cart.forEach(function(item){
    if(!item.family) return;
    totalsByFamily[item.family] = (totalsByFamily[item.family] || 0) + item.quantity;
  });

  return applyPairBagPricing(cart.map(function(item){
    if(!item.family || !item.tiers || !item.tiers.length) return item;
    const totalQty = totalsByFamily[item.family];
    let bestTier = item.tiers[0];
    item.tiers.forEach(function(tier){
      if(totalQty >= tier.units && tier.units >= bestTier.units) bestTier = tier;
    });
    if(bestTier.unitPrice === item.unitPrice && bestTier.units <= 1) return item;
    const priced = Object.assign({}, item);
    priced.unitPrice = bestTier.unitPrice;
    priced.appliedTierUnits = bestTier.units;
    return priced;
  }));
}

/* 2 bolsas de Hidratante Going de 300 g (cualquier sabor, mezclados o no) = $47,50 en vez de $51,98.
   Cada pareja del carrito se cobra a ese precio; la bolsa que sobra paga el normal. Como todas valen lo mismo,
   el descuento se reparte parejo entre las bolsas (2 bolsas = $23,75 c/u; 3 = $47,50 + $25,99). */
const PAIR_BAG_PRICE = 47.50;
function isPairBagItem(item){
  // Desde la ficha el "300 g" viaja en variant ("presentación de 300 g"); desde Hot Deals va en el nombre.
  const text = (item.name || '') + ' ' + (item.variant || '');
  return !item.kit && /hidratante/i.test(item.name || '') && /300 g/i.test(text) && /going/i.test((item.brand || '') + ' ' + (item.name || ''));
}
function applyPairBagPricing(cart){
  const bags = cart.filter(isPairBagItem);
  const total = bags.reduce(function(n, i){ return n + i.quantity; }, 0);
  const pairs = Math.floor(total / 2);
  if(!pairs) return cart;
  return cart.map(function(item){
    if(!isPairBagItem(item)) return item;
    const saving = 2 * item.unitPrice - PAIR_BAG_PRICE;
    if(saving <= 0) return item;
    const priced = Object.assign({}, item);
    priced.unitPrice = item.unitPrice - (pairs * saving) / total;
    priced.appliedPair = true;
    return priced;
  });
}

// Lee cuántas unidades representa una píldora de presentación ("Individual" = 1,
// "Caja x6" = 6, etc.) a partir de su propio texto, para no depender de ningún
// atributo nuevo en el HTML.
function pillUnits(pill){
  if(!pill) return 1;
  const match = pill.textContent.trim().match(/Caja\s*x\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 1;
}

/* Lee el producto/precio/foto actuales de la ficha (ya reflejan el sabor/presentación elegidos) y lo agrega al carrito real.
   Si la ficha tiene selector de "Presentación" (cajas de 6/12/24), la cantidad
   se guarda como unidades individuales (no cajas) y se etiqueta con una
   "family" — así el carrito puede sumar unidades de distintos sabores de la
   misma ficha y aplicar el descuento por volumen aunque el cliente mezcle. */
function addProductToCart(quantity){
  const titleEl = document.getElementById('pdp-main-title');
  const priceEl = document.getElementById('pdp-price');
  const brandEl = document.querySelector('.pdp-brand');
  const photoEl = document.getElementById('pdp-main-photo');
  const unitEl = document.querySelector('.pdp-price-unit');
  if(!titleEl || !priceEl) return;

  const presentationGroup = document.querySelector('[data-pill-group="presentation"]');
  const totalPrice = parseFloat(priceEl.textContent.replace(/[^0-9,.-]/g, '').replace(',', '.')) || 0;

  let family = null;
  let tiers = null;
  let units = 1;

  if(presentationGroup){
    const activePill = presentationGroup.querySelector('.pill--active') || presentationGroup.querySelector('.pill');
    units = pillUnits(activePill);
    tiers = Array.from(presentationGroup.querySelectorAll('.pill')).map(function(pill){
      const n = pillUnits(pill);
      const total = parseFloat(pill.dataset.price) || 0;
      return { units: n, unitPrice: n > 0 ? total / n : total };
    });
    family = window.location.pathname;
  }

  const totalUnits = units * quantity;
  const unitPrice = units > 0 ? totalPrice / units : totalPrice;

  addItemToCart({
    name: titleEl.textContent.trim(),
    brand: brandEl ? brandEl.textContent.trim() : '',
    photo: photoEl ? photoEl.src : '',
    variant: family ? (totalUnits + ' unidad' + (totalUnits === 1 ? '' : 'es')) : (unitEl ? unitEl.textContent.trim() : ''),
    unitPrice: unitPrice,
    quantity: family ? totalUnits : quantity,
    family: family,
    tiers: tiers
  });
}

/* Lee el producto/precio/foto de una tarjeta de catálogo y lo agrega al carrito real. */
function addCardToCart(card){
  if(!card) return;
  const nameEl = card.querySelector('.product-name');
  const priceEl = card.querySelector('.product-price');
  const brandEl = card.querySelector('.product-brand');
  const photoEl = card.querySelector('.product-photo');
  if(!nameEl || !priceEl) return;

  // Kit: un solo producto con precio propio; el contenido viaja en "variant" y también en el nombre del pedido (ver el envío)
  if(card.hasAttribute('data-kit')){
    addItemToCart({
      name: nameEl.textContent.trim(),
      brand: brandEl ? brandEl.textContent.trim() : '',
      photo: photoEl ? photoEl.src : '',
      variant: card.dataset.kitContents || '',
      unitPrice: parseFloat(card.dataset.kitPrice) || 0,
      quantity: 1,
      kit: true
    });
    return;
  }

  addItemToCart({
    name: nameEl.textContent.trim(),
    brand: brandEl ? brandEl.textContent.trim() : '',
    photo: photoEl ? photoEl.src : '',
    variant: '',
    unitPrice: parseFloat(priceEl.dataset.originalUsd) || parsePriceText(priceEl.textContent) || 0,
    quantity: 1
  });
}

/* ---------- Botón "Agregar al carrito" en las tarjetas de catálogo ---------- */
function initCardAddToCartButtons(){
  document.querySelectorAll('[data-add-to-cart-card]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      addCardToCart(btn.closest('.product-card'));
      btn.classList.add('added');
      const label = btn.textContent;
      btn.textContent = 'Agregado ✓';
      setTimeout(function(){ btn.textContent = label; btn.classList.remove('added'); }, 1400);
    });
  });
}

/* El nombre del producto siempre termina en la marca, pero para Going se
   usa la forma corta "Going" en vez del nombre completo "Going Nutrición"
   (que sí se sigue mostrando tal cual en la etiqueta de marca aparte). */
function shortBrandName(brand){
  return brand === 'Going Nutrición' ? 'Going' : brand;
}

function escapeHtml(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- Mega menú (escritorio) ---------- */
function initMegaMenu(){
  const items = document.querySelectorAll('.nav-item.has-mega');
  items.forEach(function(item){
    let closeTimer = null;
    const trigger = item.querySelector('.nav-trigger');

    function open(){
      clearTimeout(closeTimer);
      items.forEach(function(other){ if(other !== item) other.classList.remove('open'); });
      item.classList.add('open');
      if(trigger) trigger.setAttribute('aria-expanded', 'true');
    }
    function close(){
      closeTimer = setTimeout(function(){
        item.classList.remove('open');
        if(trigger) trigger.setAttribute('aria-expanded', 'false');
      }, 120);
    }

    item.addEventListener('mouseenter', open);
    item.addEventListener('mouseleave', close);
    item.addEventListener('focusin', open);
    item.addEventListener('focusout', function(e){
      if(!item.contains(e.relatedTarget)) close();
    });

    if(trigger){
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('click', function(){
        const isOpen = item.classList.contains('open');
        items.forEach(function(other){ other.classList.remove('open'); });
        if(!isOpen){ item.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); }
        else { trigger.setAttribute('aria-expanded', 'false'); }
      });
    }
  });

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      items.forEach(function(item){ item.classList.remove('open'); });
    }
  });
}

/* ---------- Menú móvil ---------- */
function initMobileMenu(){
  const toggle = document.querySelector('.menu-toggle');
  const panel = document.querySelector('.mobile-nav');
  if(!toggle || !panel) return;

  const header = document.querySelector('.site-header');
  /* El panel arranca justo debajo del encabezado: con la barra de envío visible (arriba del todo) el encabezado
     queda más abajo de 70px y el panel lo tapaba. */
  function placePanel(){
    if(header) panel.style.top = Math.max(header.getBoundingClientRect().bottom, 0) + 'px';
  }

  toggle.addEventListener('click', function(){
    const isOpen = panel.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    /* Sin overflow:hidden en el body: en iPhone rompía el encabezado sticky y la hamburguesa desaparecía al hacer scroll */
    if(isOpen) placePanel();
  });
  window.addEventListener('scroll', function(){
    if(panel.classList.contains('open')) placePanel();
  }, { passive: true });
}

/* ---------- Boletín ----------
   Formulario del inicio: manda el correo a /api/newsletter (el Worker lo guarda en Supabase). Solo el correo; el campo oculto "website" es una trampa para robots. */
function initNewsletterForms(){
  document.querySelectorAll('[data-newsletter-form]').forEach(function(form){
    const input = form.querySelector('input[type="email"]');
    const trap = form.querySelector('input[name="website"]');
    const btn = form.querySelector('button[type="submit"]');
    const box = form.closest('.newsletter') || form.parentNode;
    const success = box.querySelector('[data-newsletter-success]');
    const error = box.querySelector('[data-newsletter-error]');
    function mostrarError(msg){ if(error){ error.textContent = msg; error.hidden = false; } }
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      if(error) error.hidden = true;
      const email = input ? input.value.trim() : '';
      if(!email || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)){ mostrarError('Escribe un correo válido, por ejemplo nombre@correo.com.'); if(input) input.focus(); return; }
      if(btn){ btn.disabled = true; btn.textContent = 'Enviando…'; }
      try {
        const res = await fetch('/api/newsletter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, website: trap ? trap.value : '' }) });
        let j = null;
        try { j = await res.json(); } catch(err){}
        if(!res.ok || !j || j.ok !== true) throw new Error((j && j.error) || (res.status === 429 ? 'Demasiados intentos. Espera un minuto y vuelve a probar.' : 'No se pudo guardar. Intenta otra vez.'));
        form.hidden = true;
        if(success) success.classList.add('visible');
        form.dispatchEvent(new CustomEvent('newsletter:ok', { bubbles: true }));
        if(typeof trackEvent === 'function'){ try { trackEvent('generate_lead', { method: 'newsletter' }); } catch(err){} }
      } catch(err){
        mostrarError(err.message || 'No se pudo guardar. Intenta otra vez.');
        if(btn){ btn.disabled = false; btn.textContent = 'Suscribirme'; }
      }
    });
  });
}

/* ---------- Newsletter: cartelito flotante del inicio ----------
   Sale a los 12 s o cuando se baja el 35% de la página (lo primero que pase). Si lo cierran no vuelve por 14 días; si se suscriben, nunca más.
   Sin animación (solo el carrusel puede animar al entrar) y sin quitarle el foco a nada: no es una ventana modal. */
function initNewsletterFloat(){
  const box = document.querySelector('[data-newsletter-float]');
  if(!box) return;
  const KEY = 'apex_newsletter';
  const LATER = 14 * 24 * 3600 * 1000;
  function leer(){ try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){ return null; } }
  function guardar(estado, ms){ try { localStorage.setItem(KEY, JSON.stringify({ estado: estado, hasta: ms ? Date.now() + ms : 0 })); } catch(e){} }
  const prev = leer();
  if(prev && (prev.estado === 'suscrito' || (prev.hasta && prev.hasta > Date.now()))) return;
  let visto = false, timer = null;
  function cerrar(estado, ms){ guardar(estado, ms); box.hidden = true; }
  function mostrar(){
    if(visto) return; visto = true;
    clearTimeout(timer); window.removeEventListener('scroll', alBajar);
    box.hidden = false;
  }
  function alBajar(){
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if(h > 0 && window.scrollY / h >= 0.35) mostrar();
  }
  timer = setTimeout(mostrar, 12000);
  window.addEventListener('scroll', alBajar, { passive: true });
  box.querySelector('[data-newsletter-close]').addEventListener('click', function(){ cerrar('cerrado', LATER); });
  box.addEventListener('keydown', function(e){ if(e.key === 'Escape') cerrar('cerrado', LATER); });
  box.addEventListener('newsletter:ok', function(){ guardar('suscrito', 0); setTimeout(function(){ box.hidden = true; }, 5000); });
}

/* ---------- Botón "Agregar al carrito" del producto destacado del home ---------- */
function initFeatureAddToCart(){
  document.querySelectorAll('[data-add-to-cart-feature]').forEach(function(btn){
    btn.addEventListener('click', function(){
      const grid = btn.closest('.feature-grid');
      if(!grid) return;
      const nameEl = grid.querySelector('.feature-copy h2');
      const photoEl = grid.querySelector('.feature-media img');
      addItemToCart({
        name: nameEl ? nameEl.textContent.trim() : '',
        brand: btn.getAttribute('data-brand') || '',
        photo: photoEl ? photoEl.src : '',
        variant: '',
        unitPrice: parseFloat(btn.getAttribute('data-price')) || 0,
        quantity: 1
      });
      btn.classList.add('added');
      const label = btn.textContent;
      btn.textContent = 'Agregado ✓';
      setTimeout(function(){ btn.textContent = label; btn.classList.remove('added'); }, 1400);
    });
  });
}

/* ---------- Botón "Agregar al carrito" ---------- */
function initAddToCartButtons(){
  document.querySelectorAll('[data-add-to-cart]').forEach(function(btn){
    btn.addEventListener('click', function(){
      addProductToCart(1);
    });
  });
}

/* ---------- Filtros y orden de categoría ---------- */
function initFiltersToggle(){
  const toggle = document.querySelector('.filters-toggle');
  const panel = document.getElementById('filters-panel');
  if(!toggle || !panel) return;

  toggle.addEventListener('click', function(){
    const isOpen = panel.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });
}

function parseRange(value){
  const parts = value.split('-').map(Number);
  const min = parts[0];
  const max = parts.length > 1 ? parts[1] : parts[0];
  return { min: min, max: max };
}

const CATEGORY_META = {
  hidratacion: {
    title: 'Hidratación',
    subtitle: 'Electrolitos en polvo, masticables y cápsulas para reponer lo que pierdes por el sudor.',
  },
  proteina: {
    title: 'Proteína',
    subtitle: 'Polvos de proteína para la ventana de recuperación después de entrenar.',
  },
  recuperacion: {
    title: 'Recuperación',
    subtitle: 'Barras energéticas para reponer después del esfuerzo.',
  },
  'geles-energia': {
    title: 'Geles y energía',
    subtitle: 'Geles, waffles y gomas para sostener el ritmo antes, durante y después del entrenamiento. Filtra por cafeína, carbohidratos y sodio por porción para comparar de verdad.',
  },
};

function initCategoryFilters(){
  const grid = document.getElementById('product-grid');
  if(!grid) return;

  const cards = Array.from(grid.querySelectorAll('.product-card'));
  const countEl = document.getElementById('result-count');
  const emptyEl = document.getElementById('cat-empty');
  const sortSelect = document.getElementById('sort-select');
  const clearBtn = document.getElementById('clear-filters');
  const checkboxes = Array.from(document.querySelectorAll('.filters input[type="checkbox"]'));
  const numericGroups = ['caffeine', 'carbs', 'sodium', 'price'];

  const params = new URLSearchParams(window.location.search);
  const activeCategory = params.get('cat');
  const activeSub = params.get('sub');
  const meta = activeCategory && CATEGORY_META[activeCategory];

  const titleEl = document.getElementById('cat-title');
  const subtitleEl = document.getElementById('cat-subtitle');
  const breadcrumbEl = document.getElementById('cat-breadcrumb');
  if(meta){
    if(titleEl) titleEl.textContent = meta.title;
    if(subtitleEl) subtitleEl.textContent = meta.subtitle;
    if(breadcrumbEl) breadcrumbEl.textContent = meta.title;
    document.title = meta.title + ' | Apex Nutrición';
  } else if(activeCategory === null && document.getElementById('cat-title')){
    if(titleEl) titleEl.textContent = 'Catálogo completo';
    if(subtitleEl) subtitleEl.textContent = 'Todo lo que tenemos disponible: geles, hidratación, proteína y barras de las cinco marcas.';
    if(breadcrumbEl) breadcrumbEl.textContent = 'Catálogo completo';
  }

  function categoryOk(card){
    return !meta || card.dataset.category === activeCategory;
  }

  function matchesGroup(card, group, selectedValues){
    if(selectedValues.length === 0) return true;
    if(numericGroups.indexOf(group) !== -1){
      const raw = parseFloat(card.dataset[group]);
      return selectedValues.some(function(v){
        const range = parseRange(v);
        return raw >= range.min && raw <= range.max;
      });
    }
    if(group === 'sport'){
      const sports = (card.dataset.sport || '').split(' ');
      return selectedValues.some(function(v){ return sports.indexOf(v) !== -1; });
    }
    return selectedValues.indexOf(card.dataset[group]) !== -1;
  }

  function updateFacetCounts(){
    const scoped = cards.filter(categoryOk);
    document.querySelectorAll('[data-count-for]').forEach(function(span){
      const parts = span.dataset.countFor.split(':');
      const group = parts[0];
      const value = parts.slice(1).join(':');
      const count = scoped.filter(function(card){ return matchesGroup(card, group, [value]); }).length;
      span.textContent = count;
    });
  }

  function applyFilters(){
    const selected = {};
    checkboxes.forEach(function(cb){
      if(cb.checked){
        const g = cb.dataset.filterGroup;
        selected[g] = selected[g] || [];
        selected[g].push(cb.value);
      }
    });

    const groups = ['brand', 'format', 'caffeine', 'carbs', 'sodium', 'sport', 'price'];
    let visibleCount = 0;
    cards.forEach(function(card){
      const match = categoryOk(card) && groups.every(function(g){ return matchesGroup(card, g, selected[g] || []); });
      card.style.display = match ? '' : 'none';
      if(match) visibleCount++;
    });

    if(countEl) countEl.textContent = visibleCount;
    if(emptyEl) emptyEl.hidden = visibleCount !== 0;
    grid.hidden = visibleCount === 0;
  }

  updateFacetCounts();

  /* En Hidratación, mientras dure el 10% de las bolsas, esas tarjetas van primero. */
  function promoBagFirst(){
    return activeCategory === 'hidratacion' && bagPromoActive();
  }
  function isPromoBagCard(card){
    return !!card.querySelector('[data-bag-promo]');
  }

  function applySort(){
    const value = sortSelect.value;
    const sorted = cards.slice().sort(function(a, b){
      switch(value){
        case 'price-asc': return parseFloat(a.dataset.price) - parseFloat(b.dataset.price);
        case 'price-desc': return parseFloat(b.dataset.price) - parseFloat(a.dataset.price);
        case 'rating': return parseFloat(b.dataset.rating) - parseFloat(a.dataset.rating);
        case 'carbs': return parseFloat(b.dataset.carbs) - parseFloat(a.dataset.carbs);
        case 'sodium': return parseFloat(b.dataset.sodium) - parseFloat(a.dataset.sodium);
        case 'newest': return (b.dataset.new === 'true' ? 1 : 0) - (a.dataset.new === 'true' ? 1 : 0);
        default:
          return (promoBagFirst() ? (isPromoBagCard(b) ? 1 : 0) - (isPromoBagCard(a) ? 1 : 0) : 0)
            || (b.dataset.bestseller === 'true' ? 1 : 0) - (a.dataset.bestseller === 'true' ? 1 : 0)
            || parseFloat(b.dataset.rating) - parseFloat(a.dataset.rating);
      }
    });
    sorted.forEach(function(card){ grid.appendChild(card); });
  }

  checkboxes.forEach(function(cb){ cb.addEventListener('change', applyFilters); });
  if(sortSelect) sortSelect.addEventListener('change', applySort);
  if(clearBtn){
    clearBtn.addEventListener('click', function(){
      checkboxes.forEach(function(cb){ cb.checked = false; });
      applyFilters();
    });
  }

  applyFilters();

  // Si el cliente entró desde un enlace de subcategoría (ej. "Geles" dentro de Geles y energía),
  // esos productos se muestran primero —intercalados por marca (Going, Honey, Going, Honey…)—
  // y el resto de la categoría queda debajo.
  if(activeSub){
    const matching = [];
    const rest = [];
    cards.forEach(function(card){
      (card.dataset.format === activeSub ? matching : rest).push(card);
    });

    const byBrand = {};
    const brandOrder = [];
    matching.forEach(function(card){
      const b = card.dataset.brand || '';
      if(!byBrand[b]){ byBrand[b] = []; brandOrder.push(b); }
      byBrand[b].push(card);
    });

    const interleaved = [];
    let pulled = true;
    while(pulled){
      pulled = false;
      brandOrder.forEach(function(b){
        if(byBrand[b].length){ interleaved.push(byBrand[b].shift()); pulled = true; }
      });
    }

    interleaved.concat(rest).forEach(function(card){ grid.appendChild(card); });
  }

  if(promoBagFirst()){
    const current = Array.from(grid.querySelectorAll('.product-card'));
    current.filter(isPromoBagCard).concat(current.filter(function(c){ return !isPromoBagCard(c); }))
      .forEach(function(card){ grid.appendChild(card); });
  }
}

/* ---------- Tabla nutricional dinámica por sabor ---------- */
function applyNutrition(el){
  if(!el || !el.dataset.nutrition) return;
  const tbody = document.querySelector('.nutrition-table tbody');
  if(!tbody) return;
  let rows;
  try{ rows = JSON.parse(el.dataset.nutrition); } catch(e){ return; }
  tbody.innerHTML = rows.map(function(r){
    return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
  }).join('');
}

/* ---------- Kit Recharge: 1 proteína 600 g + 1 hidratante bolsa 300 g, cualquier sabor, 10% menos ----------
   Página kit-recharge.html: la persona elige el sabor de cada producto; entra al carrito como un solo kit con
   precio propio y el detalle (sabores) viaja en "variant", igual que los kits de Hot Deals. */
const KIT_RECHARGE_PRICE = 52.19;     // (32,00 + 25,99) menos 10%
const KIT_RECHARGE_PHOTO = 'assets/kits/kit-recharge.webp';
function initKitRecharge(){
  const root = document.querySelector('[data-kit-recharge]');
  if(!root) return;
  const state = {};
  root.querySelectorAll('[data-kr-group]').forEach(function(group){
    const key = group.dataset.krGroup;
    const img = root.querySelector('[data-kr-photo="' + key + '"]');
    const label = root.querySelector('[data-kr-label="' + key + '"]');
    const options = Array.from(group.querySelectorAll('.flavor-card'));
    function pick(opt){
      options.forEach(function(o){
        const on = o === opt;
        o.classList.toggle('pill--active', on);
        o.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      state[key] = opt.dataset.flavorName;
      if(label) label.textContent = opt.dataset.flavorName;
      if(img){ img.src = opt.dataset.flavorImg; img.alt = (img.dataset.altPrefix || '') + opt.dataset.flavorName; }
    }
    options.forEach(function(o){ if(!o.disabled) o.addEventListener('click', function(){ pick(o); }); });
    pick(options.find(function(o){ return o.classList.contains('pill--active') && !o.disabled; }) || options.find(function(o){ return !o.disabled; }) || options[0]);
  });
  const add = root.querySelector('[data-kr-add]');
  if(add) add.addEventListener('click', function(){
    addItemToCart({
      name: 'Kit Recharge',
      brand: 'Going Nutrición',
      photo: new URL(KIT_RECHARGE_PHOTO, location.href).href,
      variant: 'Proteína ' + state.proteina + ' 600 g + Hidratante ' + state.hidratante + ' 300 g',
      unitPrice: KIT_RECHARGE_PRICE,
      quantity: parseInt((root.querySelector('.qty-stepper output') || {}).textContent, 10) || 1,   // el selector de cantidad es el de siempre (initQuantitySteppers)
      kit: true
    });
  });
}
function injectKitRechargeBs(){
  const bsEl = document.querySelector('[data-kr-bs]');
  if(!bsEl || bcvRate == null) return;
  const bs = formatBsNumber(KIT_RECHARGE_PRICE);
  if(bs != null) bsEl.textContent = '≈ Bs ' + bs + ' · Tasa BCV: Bs ' + formatBsNumber(1);
}

/* ---------- Oferta "con 3 sachets de regalo" (bolsa de hidratante 300 g o caja x24) ----------
   Una línea de kit del carrito (kit:true): el precio es el de la bolsa o la caja; los 3 sachets de regalo van
   en el detalle (variant), que viaja en el pedido. No entra en el 2x$47,50 ni en los tramos por volumen. */
function initGiftOffer(){
  const root = document.querySelector('[data-gift-offer]');
  if(!root) return;
  const GIFT_QTY = 3;
  const main = root.querySelector('[data-gift-main]');
  const mainOptions = Array.from(main.querySelectorAll('.flavor-card'));
  const rows = Array.from(root.querySelectorAll('[data-gift-row]'));
  const add = root.querySelector('[data-gift-add]');
  const hint = root.querySelector('[data-gift-hint]');
  const countEl = root.querySelector('[data-gift-count]');
  const mainLabel = root.querySelector('[data-gift-label]');
  const counts = {};
  rows.forEach(function(r){ counts[r.dataset.giftRow] = parseInt(r.querySelector('output').textContent, 10) || 0; });
  let mainFlavor = (mainOptions.find(function(o){ return o.classList.contains('pill--active'); }) || mainOptions[0]).dataset.flavorName;

  function total(){ return rows.reduce(function(n, r){ return n + counts[r.dataset.giftRow]; }, 0); }
  function giftText(){
    return rows.filter(function(r){ return counts[r.dataset.giftRow] > 0; })
      .map(function(r){ return counts[r.dataset.giftRow] + ' ' + r.dataset.giftRow; }).join(' + ');
  }
  function refresh(){
    const t = total();
    rows.forEach(function(r){
      r.querySelector('output').textContent = String(counts[r.dataset.giftRow]);
      r.querySelector('[data-gift-minus]').disabled = counts[r.dataset.giftRow] <= 0;
      r.querySelector('[data-gift-plus]').disabled = t >= GIFT_QTY;
    });
    countEl.textContent = t + ' de ' + GIFT_QTY;
    hint.textContent = t === GIFT_QTY ? 'Listo: ' + giftText() + '.' : 'Elige ' + (GIFT_QTY - t) + (GIFT_QTY - t === 1 ? ' sachet más.' : ' sachets más.');
    add.disabled = t !== GIFT_QTY;
  }
  mainOptions.forEach(function(o){
    o.addEventListener('click', function(){
      mainOptions.forEach(function(x){ x.classList.toggle('pill--active', x === o); x.setAttribute('aria-pressed', x === o ? 'true' : 'false'); });
      mainFlavor = o.dataset.flavorName;
      mainLabel.textContent = mainFlavor;
    });
  });
  rows.forEach(function(r){
    const flavor = r.dataset.giftRow;
    r.querySelector('[data-gift-minus]').addEventListener('click', function(){ if(counts[flavor] > 0){ counts[flavor]--; refresh(); } });
    r.querySelector('[data-gift-plus]').addEventListener('click', function(){ if(total() < GIFT_QTY){ counts[flavor]++; refresh(); } });
  });
  add.addEventListener('click', function(){
    if(total() !== GIFT_QTY) return;
    const isBox = root.dataset.giftKind === 'caja';
    addItemToCart({
      name: root.dataset.giftName,
      brand: 'Going Nutrición',
      photo: new URL(root.dataset.giftPhoto, location.href).href,
      variant: (isBox ? 'Caja x24 sabor ' : 'Sabor ') + mainFlavor + ' · 3 sachets de regalo: ' + giftText(),
      unitPrice: parseFloat(root.dataset.giftPrice),
      quantity: parseInt((root.querySelector('.qty-stepper output') || {}).textContent, 10) || 1,
      kit: true
    });
  });
  refresh();
}
function injectGiftBs(){
  const root = document.querySelector('[data-gift-offer]');
  const bsEl = root && root.querySelector('[data-gift-bs]');
  if(!bsEl || bcvRate == null) return;
  const bs = formatBsNumber(parseFloat(root.dataset.giftPrice));
  if(bs != null) bsEl.textContent = '≈ Bs ' + bs + ' · Tasa BCV: Bs ' + formatBsNumber(1);
}

/* ---------- Selector de sabor de la ficha de producto (miniaturas + píldoras + foto principal) ---------- */
/* Sabor agotado ([data-out-of-stock] en su tarjeta de sabor): la ficha muestra "Agotado" y deshabilita
   "Agregar al carrito" mientras ese sabor esté elegido; al elegir otro sabor vuelve a la normalidad. */
function applyPdpStock(opt){
  const out = !!(opt && opt.hasAttribute('data-out-of-stock'));
  const avail = document.getElementById('pdp-availability');
  const availText = avail && avail.querySelector('[data-availability-text]');
  const btn = document.querySelector('[data-add-to-cart-qty]');
  if(avail && availText){
    if(!availText.dataset.inStock) availText.dataset.inStock = availText.textContent;
    availText.textContent = out ? 'Agotado por ahora' : availText.dataset.inStock;
    avail.classList.toggle('pdp-availability--soon', out);
  }
  if(btn){
    if(!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = out;
    btn.textContent = out ? 'Agotado' : btn.dataset.label;
    btn.classList.toggle('btn--soon', out);
  }
}

function initPdpFlavorSelector(){
  const groups = Array.from(document.querySelectorAll('[data-flavor-group]'));
  if(groups.length === 0) return;

  const mainPhoto = document.getElementById('pdp-main-photo');
  const mainTitle = document.getElementById('pdp-main-title');
  const label = document.querySelector('[data-pill-label]');
  const allOptions = groups.reduce(function(acc, g){ return acc.concat(Array.from(g.children)); }, []);
  // El nombre del producto siempre termina en la marca (p. ej. "... Honey
  // Stinger") — se toma una sola vez de <p class="pdp-brand"> y se reaplica
  // cada vez que se reconstruye el título al cambiar de sabor, para no
  // perderlo.
  const brandEl = document.querySelector('.pdp-brand');
  const brandSuffix = brandEl && brandEl.textContent.trim() ? ' ' + shortBrandName(brandEl.textContent.trim()) : '';

  function selectFlavor(name, img){
    let matchedOpt = null;
    allOptions.forEach(function(opt){
      const match = opt.dataset.flavorName === name;
      if(match) matchedOpt = opt;
      opt.classList.toggle('pill--active', match && opt.classList.contains('pill'));
      opt.classList.toggle('active', match && opt.classList.contains('pdp-thumb'));
      opt.setAttribute('aria-pressed', String(match));
    });
    if(mainPhoto && img) mainPhoto.src = img;
    if(mainPhoto && img) mainPhoto.alt = (mainPhoto.dataset.altPrefix || '') + name;
    if(mainTitle) mainTitle.textContent = (mainTitle.dataset.titlePrefix || '') + name + brandSuffix;
    if(label) label.textContent = name;
    applyNutrition(matchedOpt);
    applyPdpStock(matchedOpt);
    /* Muestra la galería de fotos extra solo del sabor activo, y la reinicia en la primera foto */
    document.querySelectorAll('[data-photo-gallery-for]').forEach(function(g){
      const show = g.dataset.photoGalleryFor === name;
      g.hidden = !show;
      if(show){
        Array.from(g.querySelectorAll('.pdp-thumb')).forEach(function(t, i){
          t.classList.toggle('active', i === 0);
          t.setAttribute('aria-pressed', String(i === 0));
        });
      }
    });
  }

  allOptions.forEach(function(opt){
    opt.addEventListener('click', function(){
      selectFlavor(opt.dataset.flavorName, opt.dataset.flavorImg);
    });
  });

  const urlFlavor = new URLSearchParams(window.location.search).get('flavor');
  if(urlFlavor){
    const match = allOptions.find(function(opt){ return opt.dataset.flavorName === urlFlavor; });
    if(match) selectFlavor(match.dataset.flavorName, match.dataset.flavorImg);
  }
}

/* ---------- Galería de fotos extra (varias fotos del mismo sabor, sin afectar el selector de sabor) ---------- */
function initPdpPhotoGallery(){
  const containers = Array.from(document.querySelectorAll('[data-photo-gallery]'));
  if(containers.length === 0) return;
  const mainPhoto = document.getElementById('pdp-main-photo');
  containers.forEach(function(container){
    const thumbs = Array.from(container.querySelectorAll('.pdp-thumb'));
    thumbs.forEach(function(thumb){
      thumb.addEventListener('click', function(){
        thumbs.forEach(function(t){
          t.classList.toggle('active', t === thumb);
          t.setAttribute('aria-pressed', String(t === thumb));
        });
        if(mainPhoto && thumb.dataset.photoImg) mainPhoto.src = thumb.dataset.photoImg;
      });
    });
  });
}

/* ---------- Selector de presentación (precio dinámico en la ficha de producto) ---------- */
function initPdpPresentationSelector(){
  const group = document.querySelector('[data-pill-group="presentation"]');
  if(!group) return;

  const priceEl = document.getElementById('pdp-price');
  const unitEl = document.querySelector('.pdp-price-unit');
  const options = Array.from(group.querySelectorAll('.pill'));

  function select(pill){
    const price = parseFloat(pill.dataset.price);
    if(priceEl && !isNaN(price)) priceEl.textContent = formatPrice(price);
    if(unitEl && pill.dataset.unitLabel) unitEl.textContent = pill.dataset.unitLabel;
    if(pill.dataset.packageType && window.__pdpGallerySetPackageType){
      window.__pdpGallerySetPackageType(pill.dataset.packageType);
    }
    applyBfPdp();
    injectPdpBsPrice();
  }

  options.forEach(function(opt){
    opt.addEventListener('click', function(){ select(opt); });
  });

  // ?pack=24 (desde Hot Deals): abre la ficha con esa caja ya elegida.
  const pack = parseInt(new URLSearchParams(window.location.search).get('pack'), 10);
  if(pack > 1){
    const match = options.find(function(opt){ return pillUnits(opt) === pack; });
    if(match) match.click();
  }
}

/* ---------- Elegir mezcla de sabores al comprar una caja (x6/x12/x24) ----------
   Cuando el cliente selecciona una presentación de caja, en vez del stepper
   normal se muestra un panel para repartir las unidades entre los sabores
   disponibles. Cada sabor se agrega como una línea de carrito aparte, con la
   misma "family" — así el descuento por volumen (applyFamilyPricing) se
   aplica automáticamente sobre el total combinado, igual que si el cliente
   hubiera agregado cada sabor por separado. */
function initBoxFlavorBuilder(){
  const presentationGroup = document.querySelector('[data-pill-group="presentation"]');
  const flavorTrack = document.querySelector('.flavor-slider-track');
  if(!presentationGroup || !flavorTrack) return;

  const flavors = Array.from(flavorTrack.querySelectorAll('.flavor-card')).map(function(card){
    const img = card.querySelector('img');
    return {
      name: card.dataset.flavorName || card.dataset.galleryFlavor || '',
      img: img ? img.src : ''
    };
  }).filter(function(f){ return f.name; });
  if(flavors.length < 2) return;

  const buyRow = document.querySelector('.pdp-buy-row');
  if(!buyRow) return;

  const panel = document.createElement('div');
  panel.className = 'box-builder';
  panel.hidden = true;
  panel.innerHTML =
    '<div class="box-builder-head">' +
      '<div>' +
        '<p class="box-builder-title">Elige tus <span data-box-target>6</span> unidades</p>' +
        '<p class="box-builder-subtitle">Puedes mezclar sabores</p>' +
      '</div>' +
      '<p class="box-builder-total"><span data-box-count>0</span> / <span data-box-target-2>6</span> seleccionados</p>' +
    '</div>' +
    '<div class="box-builder-grid">' +
    flavors.map(function(f){
      return '<div class="box-builder-card" data-box-flavor="' + escapeHtml(f.name) + '">' +
        '<img src="' + escapeHtml(f.img) + '" alt="">' +
        '<span class="box-builder-name">' + escapeHtml(f.name) + '</span>' +
        '<div class="box-qty-stepper" role="group" aria-label="Cantidad de ' + escapeHtml(f.name) + '">' +
          '<button type="button" data-box-decrease aria-label="Reducir">−</button>' +
          '<output>0</output>' +
          '<button type="button" data-box-increase aria-label="Aumentar">+</button>' +
        '</div>' +
      '</div>';
    }).join('') +
    '</div>' +
    '<button type="button" class="btn btn--primary" data-box-add disabled>Agregar caja al carrito</button>';

  buyRow.parentNode.insertBefore(panel, buyRow);

  let target = 6;
  const rows = Array.from(panel.querySelectorAll('.box-builder-card'));
  const countEl = panel.querySelector('[data-box-count]');
  const totalEl = panel.querySelector('.box-builder-total');
  const addBtn = panel.querySelector('[data-box-add]');
  const targetEls = panel.querySelectorAll('[data-box-target], [data-box-target-2]');

  function currentTotal(){
    return rows.reduce(function(sum, row){
      return sum + (parseInt(row.querySelector('output').textContent, 10) || 0);
    }, 0);
  }

  function refresh(){
    const total = currentTotal();
    countEl.textContent = total;
    const complete = total === target;
    addBtn.disabled = !complete;
    totalEl.classList.toggle('is-complete', complete);
  }

  rows.forEach(function(row){
    const output = row.querySelector('output');
    row.querySelector('[data-box-decrease]').addEventListener('click', function(){
      const v = Math.max(0, (parseInt(output.textContent, 10) || 0) - 1);
      output.textContent = String(v);
      refresh();
    });
    row.querySelector('[data-box-increase]').addEventListener('click', function(){
      if(currentTotal() >= target) return;
      const v = (parseInt(output.textContent, 10) || 0) + 1;
      output.textContent = String(v);
      refresh();
    });
  });

  addBtn.addEventListener('click', function(){
    if(currentTotal() !== target) return;

    const titleEl = document.getElementById('pdp-main-title');
    const brandEl = document.querySelector('.pdp-brand');
    const activePill = presentationGroup.querySelector('.pill--active');
    const totalPrice = parseFloat(activePill.dataset.price) || 0;
    const unitPrice = target > 0 ? totalPrice / target : totalPrice;
    const family = window.location.pathname;
    const tiers = Array.from(presentationGroup.querySelectorAll('.pill')).map(function(pill){
      const n = pillUnits(pill);
      const t = parseFloat(pill.dataset.price) || 0;
      return { units: n, unitPrice: n > 0 ? t / n : t };
    });
    const brand = brandEl ? brandEl.textContent.trim() : '';
    const namePrefix = titleEl ? (titleEl.dataset.titlePrefix || '') : '';
    const mix = [];

    rows.forEach(function(row){
      const qty = parseInt(row.querySelector('output').textContent, 10) || 0;
      if(qty <= 0) return;
      const flavorName = row.dataset.boxFlavor;
      mix.push(qty + ' ' + flavorName);
      const img = row.querySelector('img').src;
      const baseName = namePrefix ? (namePrefix + flavorName) : flavorName;
      addItemToCart({
        name: brand ? (baseName + ' ' + shortBrandName(brand)) : baseName,
        brand: brand,
        photo: img,
        variant: qty + ' unidad' + (qty === 1 ? '' : 'es'),
        unitPrice: unitPrice,
        quantity: qty,
        family: family,
        tiers: tiers
      });
    });

    rows.forEach(function(row){ row.querySelector('output').textContent = '0'; });
    refresh();
    // Cada sabor se agregó como línea aparte (y cada una anunció su nombre);
    // este aviso reemplaza a esos y describe la caja completa.
    announce('Caja de ' + target + ' agregada al carrito: ' + mix.join(', ') + '.');

    const label = addBtn.textContent;
    addBtn.textContent = 'Agregado ✓';
    setTimeout(function(){ addBtn.textContent = label; }, 1400);
  });

  function syncVisibility(){
    const activePill = presentationGroup.querySelector('.pill--active');
    const units = pillUnits(activePill);
    const isBox = units > 1;
    panel.hidden = !isBox;
    buyRow.hidden = isBox;
    if(isBox){
      target = units;
      targetEls.forEach(function(el){ el.textContent = String(units); });
      rows.forEach(function(row){ row.querySelector('output').textContent = '0'; });
      refresh();
    }
  }

  presentationGroup.querySelectorAll('.pill').forEach(function(pill){
    pill.addEventListener('click', syncVisibility);
  });
  syncVisibility();
}

/* ---------- Galería de producto (varias fotos por sabor, sincronizada con sabor y presentación) ---------- */
function initPdpGallery(){
  const root = document.querySelector('[data-gallery]');
  if(!root) return;

  const mainPhoto = document.getElementById('pdp-main-photo');
  const mainTitle = document.getElementById('pdp-main-title');
  const label = document.querySelector('[data-pill-label]');
  const thumbs = Array.from(root.querySelectorAll('[data-gallery-flavor]'));
  const flavorPills = Array.from(document.querySelectorAll('[data-gallery-flavor-group] [data-gallery-flavor]'));
  // Igual que en initPdpFlavorSelector: el nombre del producto siempre
  // termina en la marca, tomada una sola vez de <p class="pdp-brand">.
  const brandEl = document.querySelector('.pdp-brand');
  const brandSuffix = brandEl && brandEl.textContent.trim() ? ' ' + shortBrandName(brandEl.textContent.trim()) : '';

  const activePresentationPill = document.querySelector('[data-pill-group="presentation"] .pill--active');
  const urlFlavor = new URLSearchParams(window.location.search).get('flavor');
  const urlFlavorValid = urlFlavor && thumbs.some(function(t){ return t.dataset.galleryFlavor === urlFlavor; });

  let currentFlavor = urlFlavorValid ? urlFlavor : (flavorPills.length ? flavorPills[0].dataset.galleryFlavor : (thumbs[0] && thumbs[0].dataset.galleryFlavor));
  let currentType = (activePresentationPill && activePresentationPill.dataset.packageType) || null;

  function selectThumb(thumb){
    thumbs.forEach(function(t){
      const match = t === thumb;
      t.classList.toggle('active', match);
      t.setAttribute('aria-pressed', String(match));
    });
    if(thumb.dataset.galleryType) currentType = thumb.dataset.galleryType;
    if(mainPhoto){
      mainPhoto.src = thumb.dataset.galleryImg;
      mainPhoto.alt = thumb.getAttribute('aria-label') || mainPhoto.alt;
    }
  }

  function showFlavor(flavor){
    currentFlavor = flavor;
    let firstVisible = null;
    let matched = null;
    thumbs.forEach(function(t){
      const isFlavor = t.dataset.galleryFlavor === flavor;
      t.hidden = !isFlavor;
      if(isFlavor && !firstVisible) firstVisible = t;
      if(isFlavor && currentType && !matched && t.dataset.galleryType === currentType) matched = t;
    });
    const target = matched || firstVisible;
    if(target) selectThumb(target);
    applyNutrition(firstVisible);
    flavorPills.forEach(function(p){
      const on = p.dataset.galleryFlavor === flavor;
      p.classList.toggle('pill--active', on);
      p.setAttribute('aria-pressed', String(on));
    });
    if(label) label.textContent = flavor;
    if(mainTitle) mainTitle.textContent = (mainTitle.dataset.titlePrefix || '') + flavor + brandSuffix;
  }

  thumbs.forEach(function(t){
    t.addEventListener('click', function(){ selectThumb(t); });
  });
  flavorPills.forEach(function(p){
    p.addEventListener('click', function(){ showFlavor(p.dataset.galleryFlavor); });
  });

  window.__pdpGallerySetPackageType = function(type){
    currentType = type;
    const match = thumbs.find(function(t){ return !t.hidden && t.dataset.galleryType === type; });
    if(match) selectThumb(match);
  };

  if(currentFlavor) showFlavor(currentFlavor);
}

/* ---------- Selectores tipo píldora (sabor, presentación, miniaturas) ---------- */
/* ---------- Flechas del carrusel de sabor (foto/nombre/precio) ----------
   Solo maneja el scroll horizontal con las flechas — de cuál sabor queda
   seleccionado se encarga initPdpFlavorSelector o initPdpGallery, según
   qué atributos (data-flavor-group o data-gallery-flavor-group) tenga la
   ficha; esta función no necesita saber cuál de los dos es. */
function initFlavorSliders(){
  document.querySelectorAll('.flavor-slider').forEach(function(slider){
    const track = slider.querySelector('.flavor-slider-track');
    const prev = slider.querySelector('.flavor-slider-prev');
    const next = slider.querySelector('.flavor-slider-next');
    if(!track) return;

    function scrollByCard(direction){
      const card = track.querySelector('.flavor-card');
      const amount = (card ? card.offsetWidth + 12 : 100) * direction;
      track.scrollBy({ left: amount, behavior: 'smooth' });
    }

    if(prev) prev.addEventListener('click', function(){ scrollByCard(-1); });
    if(next) next.addEventListener('click', function(){ scrollByCard(1); });
  });
}

function initPillGroups(){
  document.querySelectorAll('[data-pill-group]').forEach(function(group){
    const options = Array.from(group.querySelectorAll('.pill, .pdp-thumb'));
    const label = group.parentElement && group.parentElement.querySelector('[data-pill-label]');
    options.forEach(function(opt){
      opt.addEventListener('click', function(){
        options.forEach(function(o){
          o.classList.remove('pill--active', 'active');
          o.setAttribute('aria-pressed', 'false');
        });
        opt.classList.add(opt.classList.contains('pdp-thumb') ? 'active' : 'pill--active');
        opt.setAttribute('aria-pressed', 'true');
        if(label) label.textContent = opt.textContent.trim();
      });
    });
  });
}

/* ---------- Selector de cantidad ---------- */
function initQuantitySteppers(){
  document.querySelectorAll('.qty-stepper').forEach(function(stepper){
    if(stepper.closest('.cart-line')) return;
    const output = stepper.querySelector('output');
    const decrease = stepper.querySelector('[data-qty-decrease]');
    const increase = stepper.querySelector('[data-qty-increase]');
    const min = 1;
    const max = 10;

    function getQty(){ return parseInt(output.textContent, 10) || min; }
    function setQty(value){ output.textContent = String(Math.min(max, Math.max(min, value))); }

    if(decrease) decrease.addEventListener('click', function(){ setQty(getQty() - 1); });
    if(increase) increase.addEventListener('click', function(){ setQty(getQty() + 1); });

    const addBtn = document.querySelector('[data-add-to-cart-qty]');
    if(addBtn){
      addBtn.addEventListener('click', function(){ addProductToCart(getQty()); });
    }
  });
}

/* ---------- Filtro de categoría de guías ---------- */
function initArticleFilter(){
  const filter = document.querySelector('[data-article-filter]');
  const grid = document.getElementById('article-grid');
  if(!filter || !grid) return;

  const pills = Array.from(filter.querySelectorAll('.pill'));
  const cards = Array.from(grid.querySelectorAll('.article-card'));

  pills.forEach(function(pill){
    pill.addEventListener('click', function(){
      pills.forEach(function(p){ p.classList.remove('pill--active'); p.setAttribute('aria-pressed', 'false'); });
      pill.classList.add('pill--active');
      pill.setAttribute('aria-pressed', 'true');

      const category = pill.dataset.category;
      cards.forEach(function(card){
        const match = category === 'all' || card.dataset.category === category;
        card.style.display = match ? '' : 'none';
      });
    });
  });
}

/* ---------- Índice de contenidos del artículo ---------- */
function initArticleToc(){
  const toc = document.querySelector('.article-toc');
  if(!toc || !('IntersectionObserver' in window)) return;

  const links = Array.from(toc.querySelectorAll('a'));
  const sections = links
    .map(function(link){ return document.querySelector(link.getAttribute('href')); })
    .filter(Boolean);
  if(sections.length === 0) return;

  const observer = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      const link = toc.querySelector('a[href="#' + entry.target.id + '"]');
      if(!link) return;
      if(entry.isIntersecting){
        links.forEach(function(l){ l.classList.remove('active'); });
        link.classList.add('active');
      }
    });
  }, { rootMargin: '-96px 0px -70% 0px' });

  sections.forEach(function(section){ observer.observe(section); });
}

/* ---------- Página de carrito ---------- */
function formatPrice(amount){
  return '$' + USD_FORMAT.format(amount);
}

const WHATSAPP_NUMBER = '584143695233';
const FREE_SHIPPING_AT = 30;
const SHIPPING_COST = 6;
const CARACAS_STATES = ['Distrito Capital'];
// Miranda cuenta como "envío estándar $6" si la zona escrita cae dentro del
// área metropolitana de Caracas (lista de zonas de abajo).
// Cubre los 4 municipios de Miranda que forman la Gran Caracas junto con
// Libertador/Distrito Capital (que ya cuenta aparte, por estado, arriba).
const CARACAS_ZONE_KEYWORDS = [
  // Genérico
  'caracas', 'distrito capital', 'libertador',
  // Chacao
  'chacao', 'altamira', 'bello campo', 'campo alegre', 'chuao', 'country club',
  'el bosque', 'el pedregal', 'el rosal', 'estado leal',
  'la castellana', 'la floresta', 'los palos grandes', 'san marino', 'sans souci', 'chacaito',
  // Baruta
  'baruta', 'las mercedes', 'la trinidad', 'el cafetal', 'santa marta', 'santa sofia',
  'san luis', 'santa paula', 'cerro verde', 'las minas', 'colinas de bello monte',
  'valle arriba', 'cumbres de curumo', 'caurimare', 'lomas del sol',
  'cafetal', 'santa fe', 'bello monte', 'prados del este', 'los samanes', 'el placer',
  'santa rosa de lima', 'la tahona', 'sorocaima', 'la guairita', 'el penon', 'club hipico',
  'alto prado', 'manzanares',
  // El Hatillo
  'hatillo', 'oripoto', 'la lagunita', 'lagunita', 'la boyera', 'boyera', 'loma alta',
  'los naranjos', 'la union', 'la unión', 'alto hatillo',
  // Sucre (Petare y alrededores)
  'petare', 'caucagüita', 'filas de mariche', 'la dolorita', 'leoncio martinez',
  'las brisas de petare', 'campo claro', 'colinas de la california',
  'la california', 'el llanito', 'la carlota', 'urbina', 'los chorros',
  'los dos caminos', 'los ruices', 'macaracuay', 'monseñor lebrun', 'montecristo',
  'parque miranda', 'parque francisco de miranda', 'santa cecilia',
  'santa eduvigis', 'sebucan', 'boleita', 'los cortijos', 'palo verde', 'el marques', 'mariche'
];

function normalizeText(s){
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function isCaracasZoneText(zoneText){
  const t = normalizeText(zoneText);
  if(!t) return false;
  return CARACAS_ZONE_KEYWORDS.some(function(kw){ return t.indexOf(normalizeText(kw)) !== -1; });
}

/* ---------- Tipo de entrega (Pickup / Delivery) ---------- */
function getDeliveryContext(){
  const activeBtn = document.querySelector('.delivery-toggle-btn[data-delivery-type].active');
  const type = activeBtn ? activeBtn.dataset.deliveryType : 'delivery';
  const stateSelect = document.getElementById('checkout-state');
  const state = stateSelect ? stateSelect.value : '';
  const zoneInput = document.getElementById('checkout-zone');
  const zoneText = zoneInput ? zoneInput.value : '';
  const isCaracas = CARACAS_STATES.indexOf(state) !== -1 || (state === 'Miranda' && isCaracasZoneText(zoneText));
  const carrierBtn = document.querySelector('.carrier-btn.active');
  return { type: type, state: state, isCaracas: isCaracas, zoneText: zoneText, carrier: carrierBtn ? carrierBtn.dataset.carrier : 'MRW' };
}

function initDeliveryType(){
  const toggleBtns = Array.from(document.querySelectorAll('.delivery-toggle-btn[data-delivery-type]'));
  if(toggleBtns.length === 0) return;

  const pickupInfo = document.getElementById('pickup-info');
  const deliveryFields = document.getElementById('delivery-fields');
  const stateSelect = document.getElementById('checkout-state');
  const caracasNote = document.getElementById('delivery-caracas-note');
  const mrwNote = document.getElementById('delivery-mrw-note');
  const zoneField = document.getElementById('checkout-zone-field');
  const zoneLabel = zoneField ? zoneField.querySelector('label') : null;
  const zoneInput = document.getElementById('checkout-zone');
  const mrwFields = document.getElementById('mrw-fields');

  function refresh(){
    const ctx = getDeliveryContext();
    if(pickupInfo) pickupInfo.hidden = ctx.type !== 'pickup';
    if(deliveryFields) deliveryFields.hidden = ctx.type !== 'delivery';

    if(ctx.type === 'delivery'){
      const hasState = ctx.state !== '';
      const isMiranda = ctx.state === 'Miranda';
      const isMrw = hasState && !ctx.isCaracas;
      if(caracasNote) caracasNote.hidden = !(hasState && ctx.isCaracas);
      if(mrwNote) mrwNote.hidden = !isMrw;
      if(mrwFields) mrwFields.hidden = !isMrw;
      const carrierField = document.getElementById('carrier-field');
      if(carrierField) carrierField.hidden = !isMrw;
      const agencyLabel = document.getElementById('checkout-agency-label');
      if(agencyLabel) agencyLabel.textContent = 'Dirección de la agencia ' + ctx.carrier;
      if(zoneField) zoneField.hidden = !hasState;
      if(zoneLabel){
        zoneLabel.textContent = (ctx.isCaracas || isMiranda) ? 'Zona de despacho' : 'Dirección de envío (' + ctx.carrier + ')';
      }
      if(zoneInput){
        zoneInput.placeholder = isMiranda ? 'Ej. El Hatillo - Oripoto' : (ctx.isCaracas ? 'Ej. Caracas - Chacao' : 'Dirección completa, punto de referencia');
      }
    }

    if(typeof window.__apexCartRerender === 'function') window.__apexCartRerender();
  }

  toggleBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      toggleBtns.forEach(function(b){
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      refresh();
    });
  });
  // Fuera de Caracas: el cliente escoge MRW o Zoom (envío con pago a destino).
  const carrierBtns = Array.from(document.querySelectorAll('.carrier-btn'));
  carrierBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      carrierBtns.forEach(function(b){
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      refresh();
    });
  });
  if(stateSelect) stateSelect.addEventListener('change', refresh);
  if(zoneInput) zoneInput.addEventListener('input', function(){
    if(getDeliveryContext().state === 'Miranda') refresh();
  });

  refresh();
}

function cartSubtotal(cart){
  return cart.reduce(function(sum, item){ return sum + item.unitPrice * item.quantity; }, 0);
}

function initCartPage(){
  const list = document.getElementById('cart-list');
  if(!list) return;

  const emptyState = document.getElementById('cart-empty');
  const layout = document.getElementById('cart-layout');
  const subtotalEl = document.getElementById('cart-subtotal');
  const shippingEl = document.getElementById('cart-shipping');
  const shippingNoteEl = document.getElementById('cart-shipping-note');
  const totalEl = document.getElementById('cart-total');
  const discountRowEl = document.getElementById('cart-discount-row');
  const discountLabelEl = document.getElementById('cart-discount-label');
  const discountEl = document.getElementById('cart-discount');
  const discountBsEl = document.getElementById('cart-discount-bs');
  const welcomeBannerEl = document.getElementById('welcome-coupon-banner');

  // Quita del carrito guardado lo que todavía no tiene inventario (clientes con un carrito viejo).
  const savedCart = getCart();
  const availableCart = savedCart.filter(function(i){ return !isComingSoonItem(i) && !isOutOfStockItem(i); });
  if(availableCart.length !== savedCart.length){
    saveCart(availableCart);
    const soonNote = document.getElementById('cart-soon-note');
    if(soonNote){
      const notes = [];
      if(savedCart.some(isComingSoonItem)) notes.push('Quitamos Honey Stinger de tu carrito: todavía no tenemos inventario. Muy pronto estará disponible.');
      const outNames = savedCart.filter(isOutOfStockItem).map(function(i){ return i.name; });
      if(outNames.length) notes.push('Quitamos de tu carrito lo que está agotado por ahora: ' + outNames.join(', ') + '.');
      soonNote.textContent = notes.join(' ');
      soonNote.hidden = false;
    }
  }


  function render(){
    const cart = getCart();

    if(cart.length === 0){
      if(layout) layout.hidden = true;
      if(emptyState) emptyState.hidden = false;
      initCartCount();
      return;
    }
    if(layout) layout.hidden = false;
    if(emptyState) emptyState.hidden = true;

    // El precio por unidad de cada línea se recalcula según el total combinado
    // de esa "family" (sumando todos los sabores) — así se aplica el
    // descuento por caja aunque el cliente haya mezclado sabores.
    const pricedCart = applyFamilyPricing(cart);

    list.innerHTML = pricedCart.map(function(item, index){
      const tierNote = item.family && item.appliedTierUnits > 1
        ? '<p class="cart-line-tier-note">✓ Precio por volumen aplicado (caja x' + item.appliedTierUnits + ', combinando sabores)</p>'
        : '';
      // Para productos por familia, "variant" describe la cantidad ("N
      // unidades") — se recalcula con la cantidad actual de la línea en vez
      // de usar el texto fijo guardado al agregarlo, para que no quede
      // desactualizado cuando el cliente cambia la cantidad en el carrito.
      const variantText = item.family
        ? (item.quantity + ' unidad' + (item.quantity === 1 ? '' : 'es'))
        : item.variant;
      return (
        '<div class="cart-line" data-index="' + index + '">' +
          '<div class="cart-line-media">' +
            '<img class="product-photo" src="' + escapeHtml(item.photo) + '" alt="' + escapeHtml(item.name) + '">' +
          '</div>' +
          '<div class="cart-line-info">' +
            '<p class="cart-line-brand">' + escapeHtml(item.brand) + '</p>' +
            '<p class="cart-line-name">' + escapeHtml(item.name) + '</p>' +
            '<p class="cart-line-variant">' + escapeHtml(variantText) + '</p>' +
            tierNote +
          '</div>' +
          '<div class="cart-line-qty">' +
            '<div class="qty-stepper" role="group" aria-label="Cantidad">' +
              '<button type="button" data-qty-decrease aria-label="Reducir cantidad">−</button>' +
              '<output>' + item.quantity + '</output>' +
              '<button type="button" data-qty-increase aria-label="Aumentar cantidad">+</button>' +
            '</div>' +
          '</div>' +
          '<p class="cart-line-price">' + formatPrice(item.unitPrice * item.quantity) + '</p>' +
          '<button type="button" class="cart-line-remove" data-cart-remove aria-label="Eliminar ' + escapeHtml(item.name) + ' del carrito">' +
            '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>'
      );
    }).join('');

    Array.from(list.querySelectorAll('.cart-line')).forEach(function(line){
      const index = parseInt(line.dataset.index, 10);
      const decrease = line.querySelector('[data-qty-decrease]');
      const increase = line.querySelector('[data-qty-increase]');
      const removeBtn = line.querySelector('[data-cart-remove]');

      if(decrease) decrease.addEventListener('click', function(){
        const c = getCart();
        c[index].quantity = Math.max(1, c[index].quantity - 1);
        saveCart(c);
        render();
        focusLineControl(index, '[data-qty-decrease]');
        announce('Cantidad: ' + c[index].quantity);
      });
      if(increase) increase.addEventListener('click', function(){
        const c = getCart();
        c[index].quantity = Math.min(CART_LINE_QTY_MAX, c[index].quantity + 1);
        saveCart(c);
        render();
        focusLineControl(index, '[data-qty-increase]');
        announce('Cantidad: ' + c[index].quantity);
      });
      if(removeBtn) removeBtn.addEventListener('click', function(){
        const c = getCart();
        const removed = c.splice(index, 1)[0];
        saveCart(c);
        render();
        showUndo(removed, index);
      });
    });

    const subtotal = cartSubtotal(pricedCart);
    // El descuento no afecta el umbral de envío gratis — se calcula sobre
    // el subtotal real, no sobre el subtotal ya rebajado.
    const effCoupon = couponForCart(pricedCart, appliedCoupon);
    const discount = cartDiscount(pricedCart, effCoupon);
    if(discountLabelEl) discountLabelEl.textContent = 'Descuento (' + discountLabelFor(getCart(), effCoupon) + ')';
    if(welcomeBannerEl){
      welcomeBannerEl.hidden = !(appliedCoupon && appliedCoupon.auto && welcomeActive());
      // Con productos de Black Friday / Cyber Monday el banner aclara que los descuentos no se suman.
      welcomeBannerEl.innerHTML = pricedCart.some(isEventItem)
        ? '🎉 Tu carrito tiene productos de <strong>' + promoNamesFor(pricedCart).join(' y ') + '</strong>: aplica solo el <strong>' + promoPctFor(pricedCart) + '</strong> en esos productos. Los descuentos no se suman, así que el 10% de primera compra no se usa en este pedido.'
        : '🎉 <strong>10% de descuento en tu primera compra</strong> — ya está aplicado, sin código.' + (pricedCart.some(hasVolumeDiscount) ? ' Los productos con precio por cantidad no llevan además el 10%: los descuentos no se suman.' : '');
    }
    const deliveryCtx = getDeliveryContext();
    // shipping: número = monto fijo | null = pago a destino (MRW o Zoom, no se suma al total) | undefined = todavía no elige estado/zona
    let shipping;
    if(deliveryCtx.type === 'pickup'){
      shipping = 0;
    } else if(deliveryCtx.state === '' || (deliveryCtx.state === 'Miranda' && deliveryCtx.zoneText.trim() === '')){
      shipping = undefined;
    } else if(deliveryCtx.isCaracas){
      shipping = subtotal >= FREE_SHIPPING_AT ? 0 : SHIPPING_COST;
    } else {
      shipping = null; // MRW o Zoom, pago a destino
    }
    const pending = shipping === undefined;
    const total = (subtotal - discount) + (shipping || 0);

    if(subtotalEl) subtotalEl.textContent = formatPrice(subtotal);
    if(discountRowEl) discountRowEl.hidden = discount <= 0;
    if(discountEl) discountEl.textContent = '-' + formatPrice(discount);
    if(shippingEl) shippingEl.textContent = pending ? '—' : (shipping === null ? 'Pago a destino' : (shipping === 0 ? 'Gratis' : formatPrice(shipping)));
    if(totalEl) totalEl.textContent = pending ? formatPrice(subtotal - discount) + ' + envío' : (formatPrice(total) + (shipping === null ? ' + envío' : ''));
    if(shippingNoteEl){
      if(pending){
        shippingNoteEl.textContent = 'Selecciona tu estado para ver el costo de envío.';
        shippingNoteEl.classList.remove('ok');
      } else if(deliveryCtx.type === 'pickup'){
        shippingNoteEl.textContent = 'Retiro en tienda — sin costo de envío.';
        shippingNoteEl.classList.add('ok');
      } else if(shipping === null){
        shippingNoteEl.textContent = 'Envío por ' + deliveryCtx.carrier + ': pagas el envío cuando recibas tu pedido.';
        shippingNoteEl.classList.remove('ok');
      } else if(shipping === 0){
        shippingNoteEl.textContent = 'Tu pedido califica para envío gratis.';
        shippingNoteEl.classList.add('ok');
      } else {
        shippingNoteEl.textContent = 'Añade ' + formatPrice(FREE_SHIPPING_AT - subtotal) + ' más y el envío es gratis.';
        shippingNoteEl.classList.remove('ok');
      }
    }

    const rateNoteEl = document.getElementById('bcv-rate-note');
    const subtotalBsEl = document.getElementById('cart-subtotal-bs');
    const shippingBsEl = document.getElementById('cart-shipping-bs');
    const totalBsEl = document.getElementById('cart-total-bs');
    if(bcvRate != null){
      if(rateNoteEl) rateNoteEl.textContent = 'Tasa BCV: Bs ' + formatBsNumber(1);
      if(subtotalBsEl) subtotalBsEl.textContent = 'Bs ' + formatBsNumber(subtotal);
      if(discountBsEl) discountBsEl.textContent = discount > 0 ? '-Bs ' + formatBsNumber(discount) : '';
      if(shippingBsEl) shippingBsEl.textContent = (pending || shipping === 0 || shipping === null) ? '' : 'Bs ' + formatBsNumber(shipping);
      if(totalBsEl) totalBsEl.textContent = pending ? 'Bs ' + formatBsNumber(subtotal - discount) : 'Bs ' + formatBsNumber(total);
    } else {
      if(rateNoteEl) rateNoteEl.textContent = 'Tasa BCV no disponible por ahora.';
      if(subtotalBsEl) subtotalBsEl.textContent = '';
      if(discountBsEl) discountBsEl.textContent = '';
      if(shippingBsEl) shippingBsEl.textContent = '';
      if(totalBsEl) totalBsEl.textContent = '';
    }

    initCartCount();
  }

  window.__apexCartRerender = render;

  /* render() reemplaza toda la lista, así que el botón que tenía el foco
     desaparece; se le devuelve el foco al mismo control de la misma línea. */
  function focusLineControl(index, selector){
    const el = list.querySelector('.cart-line[data-index="' + index + '"] ' + selector);
    if(el) el.focus();
  }

  /* Eliminar no es inmediato-sin-vuelta: se ofrece "Deshacer" hasta la
     siguiente eliminación. */
  const undoEl = document.getElementById('cart-undo');
  const undoTextEl = document.getElementById('cart-undo-text');
  const undoBtn = document.getElementById('cart-undo-btn');
  let lastRemoved = null;

  function showUndo(item, index){
    lastRemoved = { item: item, index: index };
    if(undoEl && undoTextEl){
      undoTextEl.textContent = 'Eliminaste ' + item.name + '.';
      undoEl.hidden = false;
    }
    announce('Eliminaste ' + item.name + ' del carrito. Puedes deshacerlo.');
    const lines = list.querySelectorAll('.cart-line');
    const next = lines[Math.min(index, lines.length - 1)];
    const target = (next && !layout.hidden) ? next.querySelector('[data-cart-remove]') : undoBtn;
    if(target) target.focus();
  }

  if(undoBtn) undoBtn.addEventListener('click', function(){
    if(!lastRemoved) return;
    const c = getCart();
    const index = Math.min(lastRemoved.index, c.length);
    c.splice(index, 0, lastRemoved.item);
    saveCart(c);
    announce(lastRemoved.item.name + ' volvió al carrito.');
    lastRemoved = null;
    if(undoEl) undoEl.hidden = true;
    render();
    focusLineControl(index, '[data-cart-remove]');
  });

  const couponForm = document.getElementById('coupon-form');
  const couponInput = document.getElementById('coupon');
  const couponNote = document.getElementById('coupon-note');
  const couponSubmitBtn = couponForm ? couponForm.querySelector('button[type="submit"]') : null;

  function showCouponNote(text, kind){
    if(!couponNote) return;
    couponNote.textContent = text;
    couponNote.className = 'coupon-note' + (kind ? ' ' + kind : '');
    couponNote.hidden = false;
  }

  if(couponForm){
    couponForm.addEventListener('submit', function(e){
      e.preventDefault();
      const code = couponInput ? couponInput.value.trim() : '';
      if(!code) return;

      if(code.toUpperCase() !== WELCOME_COUPON_CODE){
        showCouponNote('Código no válido.', 'error');
        return;
      }
      if(hasUsedWelcomeCoupon()){
        showCouponNote('Código no válido.', 'error');
        return;
      }
      if(!welcomeActive()){
        showCouponNote('El descuento de primera compra no está activo por ahora.', 'error');
        return;
      }

      // El código es de "primera compra" de verdad: se cruza nombre +
      // teléfono contra pedidos anteriores en el backend, no solo si este
      // navegador ya lo usó (eso se evita fácil con incógnito/otro
      // dispositivo).
      const nameEl = document.getElementById('checkout-name');
      const phoneEl = document.getElementById('checkout-phone');
      const name = nameEl ? nameEl.value.trim() : '';
      const phone = phoneEl ? phoneEl.value.trim() : '';
      if(!name){
        showCouponNote('Completa tu nombre arriba antes de aplicar el código.', 'error');
        if(nameEl) nameEl.focus();
        return;
      }
      if(!phone){
        showCouponNote('Completa tu teléfono arriba antes de aplicar el código.', 'error');
        if(phoneEl) phoneEl.focus();
        return;
      }

      if(couponSubmitBtn) couponSubmitBtn.disabled = true;
      showCouponNote('Verificando código…', '');

      fetch('/api/check-welcome-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, phone: phone })
      })
        .then(function(res){ return res.json(); })
        .then(function(data){
          if(data && data.ok && data.eligible){
            appliedCoupon = { code: WELCOME_COUPON_CODE, rate: welcomeRate() };
            if(welcomeBannerEl) welcomeBannerEl.hidden = true;
            const pricedNow = applyFamilyPricing(getCart());
            showCouponNote(pricedNow.some(isEventItem) ? 'Código válido. Tu carrito tiene productos de ' + promoNamesFor(pricedNow).join(' y ') + ': aplica solo el ' + promoPctFor(pricedNow) + ' en esos productos, los descuentos no se suman.' : '¡Código aplicado! 10% de descuento en tu compra.' + ((pricedNow.some(itemPromoActive) ? ' Reemplaza el 10% de ' + promoLabelForCart(getCart()) + ': no se combinan.' : '')), 'ok');
          } else {
            appliedCoupon = null;
            showCouponNote('Código no válido.', 'error');
          }
          render();
        })
        .catch(function(){
          appliedCoupon = null;
          showCouponNote('No se pudo verificar el código. Intenta de nuevo.', 'error');
          render();
        })
        .finally(function(){
          if(couponSubmitBtn) couponSubmitBtn.disabled = false;
        });
    });
  }

  /* Primera compra: el 10% se aplica solo, sin código, mientras este navegador
     no haya completado un pedido. Se confirma contra los pedidos anteriores
     (nombre + teléfono) en cuanto el cliente los escribe, o al pulsar Comprar.
     Si el servicio no responde se deja el descuento: no castigamos a un cliente
     nuevo por una falla nuestra. */
  if(welcomeActive() && !hasUsedWelcomeCoupon() && !appliedCoupon){
    appliedCoupon = { code: WELCOME_COUPON_CODE, rate: welcomeRate(), auto: true, verified: false };
  }

  let welcomeCheck = null; // { key, promise }
  function verifyAutoWelcome(name, phone){
    const key = name + '|' + phone;
    if(welcomeCheck && welcomeCheck.key === key) return welcomeCheck.promise;
    const promise = fetch('/api/check-welcome-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, phone: phone })
    })
      .then(function(res){ return res.json(); })
      .then(function(data){
        if(!appliedCoupon || !appliedCoupon.auto) return;
        if(data && data.ok && data.eligible === false){
          appliedCoupon = null;
          showCouponNote('Ya registramos un pedido con estos datos: el 10% de primera compra no aplica.', 'error');
        } else {
          appliedCoupon.verified = true;
        }
        render();
      })
      .catch(function(){
        if(appliedCoupon && appliedCoupon.auto) appliedCoupon.verified = true;
      });
    welcomeCheck = { key: key, promise: promise };
    return promise;
  }
  window.__apexVerifyWelcome = verifyAutoWelcome;

  function maybeVerifyWelcome(){
    if(!(appliedCoupon && appliedCoupon.auto && !appliedCoupon.verified)) return;
    const nameEl = document.getElementById('checkout-name');
    const phoneEl = document.getElementById('checkout-phone');
    const name = nameEl ? nameEl.value.trim() : '';
    const phone = phoneEl ? phoneEl.value.trim() : '';
    if(name && phone) verifyAutoWelcome(name, phone);
  }
  ['checkout-name', 'checkout-phone'].forEach(function(id){
    const el = document.getElementById(id);
    if(el) el.addEventListener('change', maybeVerifyWelcome);
  });

  initDeliveryType();
  initPhoneMask();
  initCheckoutButton();
  render();
}

/* ---------- Teléfono con formato +58 414 1234567 ----------
   Un número venezolano se muestra siempre como "+58 AAA NNNNNNN", sin importar
   cómo lo escriban o lo peguen (0414…, 414…, 58414…, +58414…). Un número de
   otro país (+1 305…) se deja solo con dígitos para no deformarlo. */
function formatPhone(raw){
  const text = String(raw || '').trim();
  const digits = text.replace(/\D/g, '');
  if(!digits) return text.charAt(0) === '+' ? '+' : '';

  let national;
  if(text.charAt(0) === '+'){
    if(digits.length === 1) return '+' + digits; // falta el 2.º dígito del código de país
    if(digits.slice(0, 2) !== '58') return '+' + digits.slice(0, 15);
    national = digits.slice(2);
  } else if(digits.charAt(0) === '0'){
    national = digits.slice(1);
  } else if(digits.charAt(0) === '5'){
    if(digits.length === 1) return digits;
    if(digits.slice(0, 2) !== '58') return digits.slice(0, 15);
    national = digits.slice(2);
  } else if(digits.charAt(0) === '2' || digits.charAt(0) === '4'){
    national = digits;
  } else {
    return digits.slice(0, 15);
  }

  if(national.charAt(0) === '0') national = national.slice(1); // "+58 0414…"
  national = national.slice(0, 10);
  let out = '+58';
  if(national) out += ' ' + national.slice(0, 3);
  if(national.length > 3) out += ' ' + national.slice(3);
  return out;
}

// Un número +58 está completo con 10 dígitos después del código de país
// (área de 3 + 7); otro país: entre 7 y 15 dígitos en total.
function isPhoneComplete(value){
  const digits = String(value || '').replace(/\D/g, '');
  if(String(value || '').indexOf('+58') === 0) return digits.length === 12;
  return digits.length >= 7 && digits.length <= 15;
}

function initPhoneMask(){
  const input = document.getElementById('checkout-phone');
  if(!input) return;
  let digitCountBeforeEdit = 0;

  function apply(event){
    let raw = input.value;
    const caret = input.selectionStart === null ? raw.length : input.selectionStart;
    const digitsAfterCaret = raw.slice(caret).replace(/\D/g, '').length;

    // Borrar un espacio no quita ningún dígito: el formato lo volvería a poner
    // y el cursor no avanzaría nunca. En ese caso se borra el dígito anterior.
    if(event && event.inputType === 'deleteContentBackward' && caret > 0 &&
       raw.replace(/\D/g, '').length === digitCountBeforeEdit){
      let i = caret - 1;
      while(i >= 0 && !/\d/.test(raw.charAt(i))) i--;
      if(i >= 0) raw = raw.slice(0, i) + raw.slice(i + 1);
    }

    const formatted = formatPhone(raw);
    if(formatted !== input.value) input.value = formatted;

    // Deja el cursor con los mismos dígitos a su derecha (sirve al editar a la mitad).
    if(document.activeElement === input && input.setSelectionRange){
      let pos = formatted.length;
      let seen = 0;
      while(pos > 0 && seen < digitsAfterCaret){
        pos--;
        if(/\d/.test(formatted.charAt(pos))) seen++;
      }
      input.setSelectionRange(pos, pos);
    }
  }

  input.addEventListener('beforeinput', function(){ digitCountBeforeEdit = input.value.replace(/\D/g, '').length; });
  input.addEventListener('input', apply);
  input.addEventListener('change', function(){ apply(); }); // autocompletar del navegador
  if(input.value) apply();
}

/* ---------- Identificadores de GA4 del visitante ----------
   Se mandan con el pedido para que, cuando se confirme la venta en el panel de pedidos, el
   Worker la atribuya a la sesión y a la fuente de tráfico de este visitante en GA4. Se leen de las
   cookies de GA4 (_ga y _ga_<ID>); si están bloqueadas, quedan vacíos y el pedido sigue igual. */
function readCookie(name){
  const parts = document.cookie ? document.cookie.split('; ') : [];
  for(let i = 0; i < parts.length; i++){
    const eq = parts[i].indexOf('=');
    if(parts[i].slice(0, eq) === name) return decodeURIComponent(parts[i].slice(eq + 1));
  }
  return '';
}

function getGaIds(){
  const ids = { gaClientId: '', gaSessionId: '' };
  try {
    // _ga = GA1.1.<número>.<marca de tiempo>  ->  client_id = "<número>.<marca de tiempo>"
    const ga = readCookie('_ga').split('.');
    if(ga.length >= 4) ids.gaClientId = ga.slice(2).join('.');
    // _ga_<ID> = GS2.1.s<sesión>$o1$g1...  (o el formato viejo GS1.1.<sesión>.1.1...)
    // La sesión que importa es la del flujo que recibe los datos (G-CKJ8VQSLLE); la otra etiqueta, de respaldo.
    const gs = readCookie('_ga_CKJ8VQSLLE') || readCookie('_ga_8QH40K8HJK');
    const match = gs.match(/\.s(\d+)/) || gs.match(/^GS1\.\d+\.(\d+)/);
    if(match) ids.gaSessionId = match[1];
  } catch(e){ /* sin cookies: no es crítico */ }
  return ids;
}

/* ---------- Botón "Continuar con el pago" -> WhatsApp ---------- */
function initCheckoutButton(){
  const btn = document.getElementById('checkout-whatsapp');
  const nameInput = document.getElementById('checkout-name');
  const phoneInput = document.getElementById('checkout-phone');
  const zoneInput = document.getElementById('checkout-zone');
  const stateSelect = document.getElementById('checkout-state');
  const ciInput = document.getElementById('checkout-ci');
  const mrwAddressInput = document.getElementById('checkout-mrw-address');
  const errorEl = document.getElementById('checkout-error');
  if(!btn) return;

  /* El mensaje de error se muestra debajo del campo que falta, y el campo
     queda marcado (aria-invalid) hasta que el cliente lo corrige. */
  function clearFieldError(){
    document.querySelectorAll('.checkout-fields [aria-invalid]').forEach(function(el){
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    });
  }
  const fieldsWrap = document.querySelector('.checkout-fields');
  if(fieldsWrap){
    ['input', 'change'].forEach(function(type){
      fieldsWrap.addEventListener(type, function(e){
        if(e.target.getAttribute && e.target.getAttribute('aria-invalid') === 'true'){
          clearFieldError();
          if(errorEl) errorEl.hidden = true;
        }
      });
    });
  }

  btn.addEventListener('click', function(){
    const cart = getCart();
    if(cart.length === 0) return;
    clearFieldError();

    const deliveryCtx = getDeliveryContext();
    const isMrw = deliveryCtx.type === 'delivery' && !deliveryCtx.isCaracas;
    const customerName = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const location = zoneInput ? zoneInput.value.trim() : '';
    const ci = ciInput ? ciInput.value.trim() : '';
    const mrwAddress = mrwAddressInput ? mrwAddressInput.value.trim() : '';

    let missingMsg = '';
    let focusEl = null;
    if(!customerName){ missingMsg = 'Por favor completa tu nombre.'; focusEl = nameInput; }
    else if(!phone){ missingMsg = 'Por favor completa tu teléfono.'; focusEl = phoneInput; }
    else if(!isPhoneComplete(phone)){ missingMsg = 'Revisa tu teléfono: debe verse así +58 414 1234567.'; focusEl = phoneInput; }
    else if(deliveryCtx.type === 'delivery' && !deliveryCtx.state){ missingMsg = 'Por favor selecciona tu estado.'; focusEl = stateSelect; }
    else if(deliveryCtx.type === 'delivery' && !location){ missingMsg = deliveryCtx.isCaracas ? 'Por favor completa tu zona de despacho.' : 'Por favor completa tu dirección de envío.'; focusEl = zoneInput; }
    else if(isMrw && !ci){ missingMsg = 'Por favor completa tu cédula de identidad.'; focusEl = ciInput; }
    else if(isMrw && !mrwAddress){ missingMsg = 'Por favor completa la dirección de la agencia ' + deliveryCtx.carrier + '.'; focusEl = mrwAddressInput; }

    if(missingMsg){
      if(errorEl){
        const field = focusEl ? focusEl.closest('.checkout-field') : null;
        if(field) field.appendChild(errorEl);
        errorEl.textContent = missingMsg;
        errorEl.hidden = false;
      }
      if(focusEl){
        focusEl.setAttribute('aria-invalid', 'true');
        focusEl.setAttribute('aria-describedby', 'checkout-error');
        focusEl.focus();
      }
      return;
    }
    if(errorEl) errorEl.hidden = true;

    if(appliedCoupon && appliedCoupon.auto && !appliedCoupon.verified && window.__apexVerifyWelcome){
      btn.disabled = true;
      window.__apexVerifyWelcome(customerName, phone).then(function(){
        btn.disabled = false;
        placeOrder();
      });
      return;
    }
    placeOrder();

    function placeOrder(){
    // Precio final por unidad ya con el descuento por volumen aplicado
    // (sumando sabores de la misma familia de producto) — esto es lo que
    // se cobra de verdad y lo que se registra en el pedido.
    const pricedCart = applyFamilyPricing(cart);

    const subtotal = cartSubtotal(pricedCart);
    // El envío gratis se decide sobre el subtotal real (sin descuento), para
    // que el 10% de bienvenida no le haga perder a nadie el envío gratis.
    let shipping = 0;
    if(deliveryCtx.type === 'pickup') shipping = 0;
    else if(deliveryCtx.isCaracas) shipping = subtotal >= FREE_SHIPPING_AT ? 0 : SHIPPING_COST;
    else shipping = null; // MRW o Zoom, pago a destino
    const effCoupon = couponForCart(pricedCart, appliedCoupon);
    const discount = cartDiscount(pricedCart, effCoupon);
    const discountedSubtotal = subtotal - discount;
    const total = discountedSubtotal + (shipping || 0);

    // El descuento se reparte proporcionalmente en el precio unitario de
    // cada línea, para que el total que se guarda en el pedido
    // sea exactamente lo que el cliente debe pagar.
    const items = pricedCart.map(function(item){
      return { brand: item.brand, product: item.name + (item.kit && item.variant ? ' (' + item.variant + ')' : ''), unitPrice: item.unitPrice * (1 - discountRateForItem(effCoupon, item)), quantity: item.quantity };
    });

    const orderPayload = {
      customerName: customerName,
      phone: phone,
      location: deliveryCtx.type === 'pickup' ? 'Pickup' : location,
      deliveryType: deliveryCtx.type,
      state: deliveryCtx.state,
      total: total,
      items: items
    };
    if(isMrw){
      orderPayload.ci = ci;
      orderPayload.mrwAddress = '[' + deliveryCtx.carrier + '] ' + mrwAddress;   // el panel lee la empresa de este prefijo
    }
    const gaIds = getGaIds();
    if(gaIds.gaClientId) orderPayload.gaClientId = gaIds.gaClientId;
    if(gaIds.gaSessionId) orderPayload.gaSessionId = gaIds.gaSessionId;

    // 1) Registrar el pedido en segundo plano — sendBeacon sigue funcionando aunque la página navegue a WhatsApp.
    try {
      navigator.sendBeacon('/api/submit-order', JSON.stringify(orderPayload));
    } catch(e){
      console.error('No se pudo registrar el pedido en segundo plano: ' + e);
    }

    // 2) Abrir WhatsApp de inmediato, sin esperar la respuesta del registro.
    // Cada producto con descuento muestra su precio original tachado y el nuevo al lado. El tachado es el de WhatsApp (~texto~):
    // una línea real sobre el precio una vez enviado el mensaje (se prueba con el carácter Unicode U+0336 y se ve mal en los teléfonos).
    const strike = function(txt){ return '~' + txt + '~'; };
    const lines = pricedCart.map(function(item){
      const original = item.unitPrice * item.quantity;
      const rate = discountRateForItem(effCoupon, item);
      const base = '• ' + item.name + ' x' + item.quantity + ' — ';
      return rate > 0 ? base + strike(formatPrice(original)) + ' ' + formatPrice(original * (1 - rate)) : base + formatPrice(original);
    });
    const bsSuffix = function(usd){
      const bs = formatBsNumber(usd);
      return bs ? ' (Bs ' + bs + ')' : '';
    };
    const shippingLine = deliveryCtx.type === 'pickup'
      ? 'Retiro en tienda (sin costo de envío)'
      : (shipping === null ? 'Pago a destino (' + deliveryCtx.carrier + ')' : (shipping === 0 ? 'Gratis' : formatPrice(shipping) + bsSuffix(shipping)));
    const deliveryLine = deliveryCtx.type === 'pickup'
      ? '\n\nTipo de entrega: Pickup\nUbicación: https://maps.app.goo.gl/TbLsaqxRNXJYe4zb9'
      : '\n\nTipo de entrega: Delivery' +
        '\nEstado: ' + deliveryCtx.state +
        '\n' + (deliveryCtx.isCaracas ? 'Zona' : 'Dirección') + ': ' + location +
        (isMrw ? '\nEmpresa de envío: ' + deliveryCtx.carrier + '\nC.I.: ' + ci + '\nAgencia ' + deliveryCtx.carrier + ': ' + mrwAddress : '');

    const paymentLine = '\n\nDatos para pago móvil:' +
      '\nBanco: Banesco' +
      '\nTeléfono: 0414-2333620' +
      '\nC.I.: 9879375';

    const message = 'Hola, quiero hacer este pedido:\n\n' +
      lines.join('\n') +
      '\n\nEnvío: ' + shippingLine +
      '\nTotal: ' + formatPrice(total) + bsSuffix(total) + (shipping === null ? ' + envío (pago a destino)' : '') +
      (bcvRate != null ? '\n\nTasa BCV: Bs ' + formatBsNumber(1) : '') +
      '\n\nNombre: ' + customerName +
      '\nTeléfono: ' + phone +
      deliveryLine +
      paymentLine;

    // transport_type:'beacon' porque la página se va a WhatsApp en la línea siguiente; sin esto GA4 perdía el evento.
    trackEvent('begin_checkout', { currency: 'USD', value: total, coupon: appliedCoupon ? appliedCoupon.code : undefined, transport_type: 'beacon' });

    const waUrl = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
    window.location.href = waUrl;

    // El código de bienvenida ya se usó en este navegador — no se vuelve a ofrecer.
    if(appliedCoupon) markWelcomeCouponUsed();

    // Vaciar el carrito ya que el pedido quedó "enviado" hacia WhatsApp.
    saveCart([]);
    }
  });
}

/* ---------- Carrusel del héroe ---------- */
function initHeroCarousel(){
  const root = document.querySelector('.hero-carousel');
  if(!root) return;

  const slides = Array.from(root.querySelectorAll('.hero-slide'));
  const dotsWrap = root.querySelector('.carousel-dots');
  const prevBtn = root.querySelector('.carousel-arrow--prev');
  const nextBtn = root.querySelector('.carousel-arrow--next');
  const pauseBtn = root.querySelector('.carousel-pause');

  /* Con una sola diapositiva no hay nada que recorrer: se ocultan flechas y puntos. */
  if(slides.length <= 1){
    if(dotsWrap) dotsWrap.hidden = true;
    if(prevBtn) prevBtn.hidden = true;
    if(nextBtn) nextBtn.hidden = true;
  }

  const AUTOPLAY_MS = 3500;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = slides.findIndex(function(s){ return s.classList.contains('active'); });
  if(index < 0) index = 0;
  let timer = null;
  let userPaused = false;

  /* Sin autoplay (una sola diapositiva o movimiento reducido) no hay nada que pausar. */
  if(pauseBtn && (slides.length < 2 || reduceMotion)) pauseBtn.hidden = true;

  /* Medición de banners (GA4 ecommerce): view_promotion la primera vez que
     cada banner se muestra en esta visita a la página, select_promotion en
     cada clic dentro del banner. Los datos salen de data-promo-* del HTML. */
  const viewedPromos = {};
  function promoParams(slide, creative){
    const params = {
      promotion_id: slide.dataset.promoId,
      promotion_name: slide.dataset.promoName,
      creative_slot: slide.dataset.promoSlot,
      creative_name: creative || 'banner'
    };
    params.items = [{ item_name: params.promotion_name, promotion_id: params.promotion_id, promotion_name: params.promotion_name, creative_slot: params.creative_slot, creative_name: params.creative_name }];
    return params;
  }
  function trackPromoView(slide){
    if(!slide.dataset.promoId || viewedPromos[slide.dataset.promoId]) return;
    viewedPromos[slide.dataset.promoId] = true;
    trackEvent('view_promotion', promoParams(slide));
  }
  slides.forEach(function(slide){
    if(!slide.dataset.promoId) return;
    slide.addEventListener('click', function(e){
      const link = e.target.closest('a');
      if(!link) return;
      trackEvent('select_promotion', promoParams(slide, link.dataset.promoCreative));
    });
  });

  /* Reinicia la entrada animada de los productos (.is-entering en styles.css). */
  function playEntrance(slide){
    slide.classList.remove('is-entering');
    void slide.offsetWidth;
    slide.classList.add('is-entering');
  }

  // El banner que se ve al cargar la página NO se anima: su foto es el LCP del
  // inicio y ya está pintada antes de que corra este JS (animarla la haría
  // desaparecer y volver a caer). La entrada corre en cada cambio posterior.
  let firstRender = true;
  function render(){
    slides.forEach(function(s, i){ s.classList.toggle('active', i === index); });
    if(!firstRender) playEntrance(slides[index]);
    firstRender = false;
    trackPromoView(slides[index]);
    if(dotsWrap){
      Array.from(dotsWrap.children).forEach(function(d, i){
        d.classList.toggle('active', i === index);
        if(i === index) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
      });
    }
  }

  function go(i){
    index = (i + slides.length) % slides.length;
    render();
  }

  function stopAutoplay(){
    if(timer){ clearInterval(timer); timer = null; }
  }

  function startAutoplay(){
    if(reduceMotion || slides.length < 2 || userPaused) return;
    stopAutoplay();
    timer = setInterval(function(){ go(index + 1); }, AUTOPLAY_MS);
  }

  function goManual(i){
    go(i);
    startAutoplay();
  }

  if(dotsWrap){
    slides.forEach(function(_, i){
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'carousel-dot';
      dot.setAttribute('aria-label', 'Ir a la diapositiva ' + (i + 1));
      dot.addEventListener('click', function(){ goManual(i); });
      dotsWrap.appendChild(dot);
    });
  }
  if(pauseBtn) pauseBtn.addEventListener('click', function(){
    userPaused = !userPaused;
    if(userPaused) stopAutoplay(); else startAutoplay();
    pauseBtn.setAttribute('aria-label', userPaused ? 'Reanudar carrusel' : 'Pausar carrusel');
    const pauseIcon = pauseBtn.querySelector('.icon-pause');
    const playIcon = pauseBtn.querySelector('.icon-play');
    if(pauseIcon) pauseIcon.hidden = userPaused;
    if(playIcon) playIcon.hidden = !userPaused;
  });
  if(prevBtn) prevBtn.addEventListener('click', function(){ goManual(index - 1); });
  if(nextBtn) nextBtn.addEventListener('click', function(){ goManual(index + 1); });

  root.addEventListener('mouseenter', stopAutoplay);
  root.addEventListener('mouseleave', startAutoplay);
  root.addEventListener('focusin', stopAutoplay);
  root.addEventListener('focusout', startAutoplay);
  document.addEventListener('visibilitychange', function(){
    if(document.hidden) stopAutoplay(); else startAutoplay();
  });

  render();
  startAutoplay();
}

/* ---------- Formulario real de calificación y reseña de producto ----------
   Reemplaza los ratings/reseñas inventados. Cada envío se manda a /api/submit-review (el Worker),
   que lo guarda en Supabase — no se muestra en el sitio todavía. */
function initReviewForm(){
  document.querySelectorAll('[data-review-form]').forEach(function(form){
    const starButtons = Array.from(form.querySelectorAll('.star-btn'));
    const ratingInput = form.querySelector('[data-star-value-input]');
    const successEl = form.querySelector('[data-review-success]');
    const errorEl = form.querySelector('[data-review-error]');
    const submitBtn = form.querySelector('[data-review-submit]');

    /* role="radiogroup" en el HTML: cada estrella es un radio, con
       aria-checked y flechas del teclado como un grupo de radios nativo. */
    function setRating(value){
      ratingInput.value = value || '';
      starButtons.forEach(function(btn, i){
        const v = Number(btn.dataset.starValue);
        btn.classList.toggle('active', v <= value);
        btn.setAttribute('aria-checked', String(v === value));
        btn.tabIndex = (value ? v === value : i === 0) ? 0 : -1;
      });
    }

    starButtons.forEach(function(btn, i){
      btn.setAttribute('role', 'radio');
      btn.addEventListener('click', function(){ setRating(Number(btn.dataset.starValue)); });
      btn.addEventListener('keydown', function(e){
        let next;
        if(e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(starButtons.length - 1, i + 1);
        else if(e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, i - 1);
        else return;
        e.preventDefault();
        setRating(Number(starButtons[next].dataset.starValue));
        starButtons[next].focus();
      });
    });
    setRating(Number(ratingInput.value) || 0);

    form.addEventListener('submit', function(e){
      e.preventDefault();
      if(successEl) successEl.hidden = true;
      if(errorEl) errorEl.hidden = true;

      const rating = Number(ratingInput.value);
      const nameInput = form.querySelector('input[name="name"]');
      const nameValue = nameInput ? nameInput.value.trim() : '';

      if(!rating){
        if(errorEl){
          errorEl.textContent = 'Selecciona una calificación de estrellas.';
          errorEl.hidden = false;
        }
        return;
      }
      if(!nameValue){
        if(errorEl){
          errorEl.textContent = 'Escribe tu nombre para poder enviar la reseña.';
          errorEl.hidden = false;
        }
        if(nameInput) nameInput.focus();
        return;
      }

      const titleEl = document.getElementById('pdp-main-title');
      const brandEl = document.querySelector('.pdp-brand');
      const reviewInput = form.querySelector('textarea[name="review"]');

      const payload = {
        product: titleEl ? titleEl.textContent.trim() : document.title,
        brand: brandEl ? brandEl.textContent.trim() : '',
        rating: rating,
        review: reviewInput ? reviewInput.value.trim() : '',
        name: nameValue,
        url: window.location.href
      };

      if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Enviando…'; }

      fetch('/api/submit-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function(res){
          return res.json().catch(function(){ return {}; }).then(function(data){ return { ok: res.ok, data: data }; });
        })
        .then(function(result){
          if(!result.ok || result.data.ok === false){ throw new Error((result.data && result.data.error) || 'Error de envío'); }
          if(successEl) successEl.hidden = false;
          form.reset();
          setRating(0);
        })
        .catch(function(err){
          console.error('[review-form] ' + err);
          if(errorEl) errorEl.hidden = false;
        })
        .finally(function(){
          if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = 'Enviar calificación'; }
        });
    });
  });
}

function trackPdpViewItem(){
  const titleEl = document.getElementById('pdp-main-title');
  const priceEl = document.getElementById('pdp-price');
  const brandEl = document.querySelector('.pdp-brand');
  if(!titleEl) return;
  trackEvent('view_item', {
    currency: 'USD',
    value: priceEl ? parsePriceText(priceEl.textContent) || undefined : undefined,
    items: [{ item_name: titleEl.textContent.trim(), item_brand: brandEl ? brandEl.textContent.trim() : '' }]
  });
}

/* ---------- Botón flotante de WhatsApp (ficha de producto) ----------
   Antes la única salida a WhatsApp era el botón de pedido del carrito:
   quien tenía una duda sobre el producto no tenía a quién preguntarle.
   El mensaje sale prellenado con el nombre del producto. */
function initPdpWhatsAppButton(){
  const titleEl = document.getElementById('pdp-main-title');
  if(!titleEl) return;
  const productName = titleEl.textContent.trim();
  const message = 'Hola, tengo una pregunta sobre ' + productName + ' (' + location.href.split('?')[0] + ')';

  const link = document.createElement('a');
  link.className = 'wa-float';
  link.href = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute('aria-label', 'Preguntar por WhatsApp');
  link.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>' +
    '<span>¿Dudas? Escríbenos</span>';
  link.addEventListener('click', function(){
    trackEvent('whatsapp_click', { location: 'pdp_float', item_name: productName });
  });
  document.body.appendChild(link);
}

/* ---------- Reseñas ya publicadas (ficha de producto) ----------
   Antes solo se podían ESCRIBIR reseñas, nunca se mostraban las que ya
   existían — un cliente nuevo no veía ninguna prueba social. Si el producto
   todavía no tiene reseñas, esto no cambia nada visible (se queda igual que
   antes, sin bloque vacío). */
const STAR_PATH = '<polygon points="12 2 15 9 22 9.5 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.5 9 9"/>';
function renderStars(rating){
  const rounded = Math.round(rating);
  let out = '';
  for(let i = 1; i <= 5; i++){
    const filled = i <= rounded;
    out += '<svg viewBox="0 0 24 24" fill="' + (filled ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="' + (filled ? '0' : '1.5') + '" class="' + (filled ? 'star-filled' : 'star-empty') + '">' + STAR_PATH + '</svg>';
  }
  return out;
}

function initProductReviews(){
  const titleEl = document.getElementById('pdp-main-title');
  const summaryEl = document.getElementById('pdp-rating-summary');
  const starsEl = document.getElementById('pdp-rating-stars');
  const textEl = document.getElementById('pdp-rating-text');
  const listEl = document.getElementById('reviews-list');
  if(!titleEl) return;

  fetch('/api/get-reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: titleEl.textContent.trim() })
  })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if(!data || !data.ok || !Array.isArray(data.reviews) || data.reviews.length === 0) return;
      const reviews = data.reviews;
      const avg = reviews.reduce(function(sum, r){ return sum + (r.rating || 0); }, 0) / reviews.length;

      if(summaryEl && starsEl && textEl){
        starsEl.innerHTML = renderStars(avg);
        textEl.textContent = RATING_FORMAT.format(avg) + ' · ' + reviews.length + (reviews.length === 1 ? ' reseña' : ' reseñas');
        summaryEl.hidden = false;
      }

      if(listEl){
        listEl.innerHTML = reviews.map(function(r){
          return '<div class="review-card">' +
            '<div class="review-card-head">' +
              '<span class="review-card-stars">' + renderStars(r.rating) + '</span>' +
              '<span class="review-card-name">' + escapeHtml(r.name || 'Cliente') + '</span>' +
              (r.date ? '<span class="review-card-date">' + escapeHtml(r.date) + '</span>' : '') +
            '</div>' +
            (r.review ? '<p class="review-card-text">' + escapeHtml(r.review) + '</p>' : '') +
          '</div>';
        }).join('');
        listEl.hidden = false;
      }
    })
    .catch(function(){ /* si falla, la ficha se ve igual que antes de este cambio */ });
}

document.addEventListener('DOMContentLoaded', function(){
  initLiveRegion();
  initAnnounceBar();
  initWelcomeCopy();
  initCartCount();
  initMegaMenu();
  initMobileMenu();
  initNewsletterForms();
  initNewsletterFloat();
  initAddToCartButtons();
  initFeatureAddToCart();
  initCardAddToCartButtons();
  initFiltersToggle();
  initCategoryFilters();
  initPillGroups();
  initFlavorSliders();
  initBoxFlavorBuilder();
  initPdpFlavorSelector();
  initPdpGallery();
  initPdpPhotoGallery();
  initPdpPresentationSelector();
  trackPdpViewItem();
  initPdpWhatsAppButton();
  initProductReviews();
  initQuantitySteppers();
  initArticleFilter();
  initArticleToc();
  initCartPage();
  initBagPromoBadges();
  initBlackFridayPrices();
  initOffersPage();
  initKitRecharge();
  initGiftOffer();
  initHeroCarousel();
  initReviewForm();

  refreshPromos();
  fetchBcvRate().then(function(){
    injectProductCardBsPrices();
    injectPdpBsPrice();
    injectKitRechargeBs();
    injectGiftBs();
    if(typeof window.__apexCartRerender === 'function') window.__apexCartRerender();
  });
});
