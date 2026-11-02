/* ==========================================================================
   Calculadora APEX — interfaz de calculadora.html
   Lee el formulario, llama al motor (motor.js) y pinta el resultado. El kit
   del evento y el kit de la semana se agregan con addItemToCart de app.js,
   así el carrito aplica sus descuentos por caja y el pedido sale por el
   WhatsApp de siempre. El botón del carrito vive en una barra fija abajo.
   ========================================================================== */
(function(){
  const M = window.CalcMotor;
  const P = M.P;
  const $ = function(id){ return document.getElementById(id); };
  const form = $('calc-form');
  if(!form) return;
  const packForm = $('calc-pack-form');
  const DESCUENTO = typeof CALC_DESCUENTO_PACK !== 'undefined' ? CALC_DESCUENTO_PACK : 0;

  let started = false;          // después del primer "Calcular", el plan se actualiza solo
  let weekBuilt = false;        // si armó el kit de la semana, el botón de la barra compra ese kit
  const flavors = {};           // sabores elegidos por producto (uno o varios), en el kit y el kit de la semana

  const NUM = function(x, d){ return Number(x).toLocaleString('es-VE', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  const usd = function(x){ return typeof formatPrice === 'function' ? formatPrice(x) : '$' + NUM(x, 2); };
  const hours = function(min){ return (min / 60).toLocaleString('es-VE', { maximumFractionDigits: 2 }); };
  const hm = function(m){ m = Math.round(m); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
  const dot = function(k){ return '<span class="calc-dot calc-dot--' + P[k].brand + '" aria-hidden="true"></span>'; };
  // Foto del sabor elegido (tienda.fotos en productos.js): [foto para el carrito, foto chica]
  const elegidos = function(k){ return flavors[k] && flavors[k].length ? flavors[k] : P[k].tienda.sabores.slice(0, 1); };
  const fotoSabor = function(k){ const f = P[k].tienda.fotos, sab = elegidos(k)[0]; return f && f[sab] ? f[sab] : [P[k].tienda.foto, P[k].mini]; };
  const mini = function(k, size){ const src = fotoSabor(k)[1]; return src ? '<img src="' + src + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" data-mini="' + k + '">' : dot(k); };
  const isSoon = function(k){ return typeof isComingSoonItem === 'function' && isComingSoonItem({ brand: P[k].tienda.marca, name: P[k].name }); };
  const soonTag = function(k){ return isSoon(k) ? ' <span class="calc-soon">Próximamente</span>' : ''; };
  const num = function(id){ const v = parseFloat(($(id).value || '').replace(',', '.')); return isNaN(v) ? 0 : v; };
  const radio = function(name){ const el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : null; };

  /* ---------- Píldoras de una sola opción (deporte, intensidad, clima) ---------- */
  const pillValue = {};
  document.querySelectorAll('[data-pills]').forEach(function(group){
    const name = group.dataset.pills;
    const active = group.querySelector('.pill--active');
    pillValue[name] = active ? active.dataset.value : null;
    group.addEventListener('click', function(e){
      const btn = e.target.closest('.pill'); if(!btn) return;
      group.querySelectorAll('.pill').forEach(function(p){
        const on = p === btn; p.classList.toggle('pill--active', on); p.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      pillValue[name] = btn.dataset.value;
      onChange();
    });
  });

  function readInp(){
    return {
      sport: pillValue.sport, min: num('calc-hh') * 60 + num('calc-mm'), w: num('calc-w'),
      intens: pillValue.intens, clima: pillValue.clima, sweat: num('calc-sweat'), dist: pillValue.sport === 'carrera' ? num('calc-dist') : 0,
      salty: $('calc-salty').checked, gut: $('calc-gut').checked, drinkTrained: $('calc-drinkTrained').checked, caf: $('calc-caf').checked,
      drink: radio('drink') || 'auto', gelPref: radio('gelPref') || 'hs_gel_fruta'
    };
  }
  function readTr(){
    const largo = parseInt(pillValue.lmin, 10) || 0;
    return { days: parseInt(pillValue.days, 10) || 5, normalMin: parseInt(pillValue.nmin, 10) || 60,
      hasLong: largo > 0, longMin: largo, gutBlock: $('calc-gutblock').checked };
  }
  function exclusions(){ return form.querySelectorAll('input[name="excl"]:checked').length > 0; }

  /* Campos que dependen de otros */
  function syncFields(){
    const inp = readInp();
    document.querySelectorAll('[data-only-sport]').forEach(function(el){ el.hidden = el.dataset.onlySport !== inp.sport; });
    // Bloque de entrenamiento intestinal: solo si la carrera dura más de 2.5 h y no entrena comiendo
    $('calc-gutblock-field').hidden = !(inp.min > 150 && !inp.gut);
  }

  /* ---------- Guardar datos (Etapa 5): solo con consentimiento ----------
     Va a /api/calculadora (worker/index.js), que lo guarda en la base D1.
     Sin nombre ni teléfono: solo un identificador al azar por visita (el campo
     de código de atleta se quitó el 2026-11-02). Si falla, la calculadora sigue igual. */
  const VERSION = 'calc-2026-11-02';
  const sesion = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
  function guardar(tipo, resultado){
    if(!$('calc-consent').checked) return;
    const respuestas = Object.assign({}, readInp(), { entrenamiento: readTr() });
    try {
      fetch('/api/calculadora', {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true, sesion: sesion, tipo: tipo, version: VERSION, respuestas: respuestas, resultado: resultado })
      }).catch(function(){});
    } catch(e){ /* sin conexión o navegador viejo: no es crítico */ }
  }

  function validate(inp){
    const err = $('calc-error'); let msg = '', field = null;
    ['calc-hh', 'calc-w'].forEach(function(id){ $(id).removeAttribute('aria-invalid'); });
    if(!(inp.min > 0)){ msg = 'Escribe cuánto dura tu evento.'; field = $('calc-hh'); }
    else if(!(inp.w >= 35 && inp.w <= 150)){ msg = 'Escribe tu peso en kilos (entre 35 y 150).'; field = $('calc-w'); }
    if(field){ field.setAttribute('aria-invalid', 'true'); err.textContent = msg; err.hidden = false; }
    else err.hidden = true;
    return !field;
  }

  /* ---------- Calculadora de tasa de sudor ---------- */
  function sweatHelper(){
    const a = num('calc-s1'), b = num('calc-s2'), c = num('calc-s3'), d = num('calc-s4'), h = num('calc-s5');
    const out = $('calc-sres');
    if(a > 0 && b > 0 && h > 0){
      const s = ((a - b) + c - d) / h;
      if(s <= 0){ out.textContent = 'Revisa los datos: el resultado da cero o menos.'; return; }
      out.innerHTML = 'Tu tasa de sudor: <strong>' + NUM(s, 2) + ' L/h</strong>. <button type="button" class="calc-linkbtn" id="calc-use-sweat">Usar este valor</button>';
      $('calc-use-sweat').addEventListener('click', function(){ $('calc-sweat').value = s.toFixed(2); onChange(); });
    } else out.textContent = 'Completa los datos para ver tu tasa de sudor.';
  }

  /* ---------- Resultado ---------- */
  function why(text){ return '<details class="calc-why"><summary>¿Por qué?</summary><p>' + text + '</p></details>'; }

  function goalsHtml(pl){
    let carb;
    if(pl.ct.band === '<45') carb = '<div class="calc-num">0<small>g/h</small></div><p class="calc-sub">En menos de 45 minutos no hace falta.</p>';
    else if(pl.ct.band === 'opc') carb = '<div class="calc-num">Opcional</div><p class="calc-sub">Enjuaga la boca con bebida deportiva o toma 1 ' + P[pl.opcional].serv + ' de ' + P[pl.opcional].name + '.</p>';
    else carb = '<div class="calc-num">' + NUM(pl.ct.g) + '<small>g/h</small></div><p class="calc-sub">Tu plan aporta ' + NUM(pl.carbs) + ' g por hora.</p>';
    const water = '<div class="calc-num">' + NUM(pl.V, 2) + '<small>L/h</small></div><p class="calc-sub">Rango: ' + NUM(pl.floor, 2) + ' a ' + NUM(Math.min(pl.S, pl.VCAP), 2) + ' L/h. Bebe según tu sed dentro de este rango.</p>';
    const na = pl.naT != null
      ? '<div class="calc-num">' + NUM(Math.round(pl.naT / 10) * 10) + '<small>mg/h</small></div><p class="calc-sub">Tu plan aporta ' + NUM(pl.naSum) + ' mg por hora.</p>'
      : '<div class="calc-num">—</div><p class="calc-sub">No necesitas sodio extra: alcanza con el de tus productos.</p>';
    return '<div class="calc-goals">' +
      '<div class="calc-goal"><p class="eyebrow">Energía</p>' + carb + why(pl.porque.carb) + '</div>' +
      '<div class="calc-goal"><p class="eyebrow">Hidratación</p>' + water + why(pl.porque.agua) + '</div>' +
      '<div class="calc-goal"><p class="eyebrow">Sodio</p>' + na + why(pl.porque.sodio) + '</div>' +
      '</div>';
  }

  // Nombre corto para los pasos de la línea de tiempo
  const CORTO = { going_hidr: 'Hidratante', skratch: 'Skratch', going_gel: 'Gel Café', hs_gel_fruta: 'Gel', hs_gel_gold: 'Gel Gold',
    hs_gel_cafe: 'Gel con cafeína', hs_gomitas: 'Gomitas', probar_bolt: 'Bolt', hs_waffle: 'Waffle', ss_chews: 'FastChews', ss_caps: 'Cápsula de sal' };

  function groupByTime(ev){
    const out = [];
    ev.forEach(function(e){ const last = out[out.length - 1]; if(last && last.t === e.t) last.ev.push(e); else out.push({ t: e.t, ev: [e] }); });
    return out;
  }
  // Junta las unidades iguales de una misma toma: 2 waffles = { k: 'hs_waffle', n: 2 }
  function sumar(evs){
    const out = [];
    evs.forEach(function(e){ const f = out.find(function(x){ return x.k === e.k; }); if(f) f.n += e.n; else out.push({ k: e.k, n: e.n, drink: e.drink }); });
    return out;
  }
  function texto(x){
    if(x.drink) return (x.n > 1 ? x.n + ' botellas' : '1 botella') + ' de ' + P[x.k].name + ' (' + P[x.k].serv + '), a sorbos según tu sed';
    return (x.n > 1 ? x.n + ' × ' : '') + P[x.k].name + ' (' + P[x.k].serv + ')';
  }

  /* Línea de tiempo: una "hora tipo" (todas las horas se repiten) dibujada
     como pasos: minuto, foto (con ×N si son varias unidades) y nombre corto.
     Debajo, solo lo que cambia: la cafeína al final y la última hora si no es
     completa. El detalle de todo el evento queda plegado. */
  function timelineHtml(pl, kit, inp){
    const ev = M.schedule(pl, kit, inp.min);
    if(!ev.length) return '';
    const pasos = groupByTime(ev.filter(function(e){ return e.t < 60; }).map(function(e){
      return e.k === 'hs_gel_cafe' ? Object.assign({}, e, { k: 'hs_gel_fruta' }) : e;   // la hora tipo, sin cafeína
    })).map(function(g){ return { t: g.t, items: sumar(g.ev) }; });

    let html = '<div class="calc-tl"><h3 class="calc-section-title">' + (inp.min > 60 ? 'Tu hora tipo' : 'Tu evento, paso a paso') + '</h3>' +
      (inp.min > 60 ? '<p class="calc-tl-sub">Repite esta hora durante todo el evento (' + hours(inp.min) + ' h).</p>' : '') +
      '<ol class="calc-steps" style="--n:' + pasos.length + '">' +
      pasos.map(function(g){
        const nombre = g.items.map(function(x){ return CORTO[x.k] || P[x.k].name; }).join(' + ');
        const detalle = g.items.map(texto).join(' + ');
        return '<li class="calc-step"><span class="calc-step-min">' + Math.round(g.t) + '′</span>' +
          '<span class="calc-step-pics" aria-hidden="true">' + g.items.map(function(x){
            return '<span class="calc-step-pic">' + mini(x.k, 48) + (x.n > 1 ? '<span class="calc-step-x">×' + x.n + '</span>' : '') + '</span>';
          }).join('') + '</span>' +
          '<span class="calc-step-name">' + nombre + '</span><span class="visually-hidden">: ' + detalle + '</span></li>';
      }).join('') + '</ol>';

    const notas = [];
    const caf = ev.filter(function(e){ return e.k === 'hs_gel_cafe'; });
    if(caf.length) notas.push('<b>Desde ' + hm(caf[0].t) + ':</b> los geles son ' + P.hs_gel_cafe.name + '.');
    const rest = inp.min % 60;
    if(inp.min > 60 && rest > 0){
      const ultima = sumar(ev.filter(function(e){ return e.t >= inp.min - rest - 1e-9 && !e.drink; }));
      notas.push('<b>Últimos ' + Math.round(rest) + ' min:</b> ' + (ultima.length ? ultima.map(function(x){ return (x.n > 1 ? x.n + ' × ' : '') + (CORTO[x.k] || P[x.k].name); }).join(' + ') : 'solo bebida') + '.');
    }
    if(notas.length) html += '<ul class="calc-tl-notes">' + notas.map(function(n){ return '<li>' + n + '</li>'; }).join('') + '</ul>';
    html += '<details class="calc-details"><summary>' + (inp.min > 60 ? 'Ver todo el evento' : 'Ver detalle') + '</summary><ul class="calc-timeline">' +
      groupByTime(ev).map(function(g){ return '<li><b>' + hm(g.t) + '</b><span>' + sumar(g.ev).map(texto).join(' + ') + '</span></li>'; }).join('') + '</ul></details>';
    return html + '</div>';
  }

  function planHtml(pl, kit, inp){
    const keys = Object.keys(pl.items);
    let html = '<section class="calc-card"><h2 class="calc-section-title">Tu plan por hora</h2>';
    if(keys.length){
      html += '<div class="calc-table-wrap"><table class="calc-table"><thead><tr><th>Producto</th><th>Cantidad</th><th class="n">Energía</th><th class="n">Sodio</th></tr></thead><tbody>' +
        keys.map(function(k){ const p = P[k], n = pl.items[k];
          return '<tr><td><span class="calc-prod">' + mini(k, 32) + p.name + '</span>' + soonTag(k) + '</td><td>' + NUM(n) + ' × ' + p.serv + '</td><td class="n">' + NUM(n * p.carb) + ' g</td><td class="n">' + NUM(n * p.na) + ' mg</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><td>Total</td><td></td><td class="n">' + NUM(pl.carbs) + ' g</td><td class="n">' + NUM(pl.naSum) + ' mg</td></tr></tfoot></table></div>';
    } else html += '<p>Con este evento basta con agua.</p>';
    if(pl.drink === 'agua') html += '<p class="calc-help">Bebe ' + NUM(pl.V, 2) + ' L de agua por hora.</p>';
    else if(pl.waterExtra > 0.04) html += '<p class="calc-help">Además, bebe ' + NUM(pl.waterExtra, 2) + ' L de agua sola por hora.</p>';
    if(pl.alternativaBebida) html += '<p class="calc-help">¿Prefieres Skratch Hydration? <button type="button" class="calc-linkbtn" data-set-drink="skratch">Usar Skratch en vez de Going</button></p>';
    pl.notas.forEach(function(n){ html += '<p class="calc-help">' + n + '</p>'; });
    if(pl.medirSudor) html += '<p class="calc-help">Usamos una tasa de sudor de ' + NUM(pl.S, 1) + ' L/h. Mide tu sudor para un cálculo exacto.</p>';
    html += timelineHtml(pl, kit, inp);
    if(pl.avisoAgua){
      html += '<div class="calc-notice"><p><strong>Sudas más de lo que el estómago suele tolerar beber.</strong> No recomendamos más de ' +
        (inp.drinkTrained ? '1,25' : '1') + ' L por hora' + (inp.drinkTrained ? '' : ' (1,25 L si entrenas bebiendo más de 1 L por hora)') +
        '. Con este plan podrías perder cerca de ' + NUM(pl.avisoAgua.perdida, 1) + ' % de tu peso. Mide tu sudor en un entrenamiento, practica beber más de forma gradual y consulta a un profesional antes de una carrera larga.</p></div>';
    }
    return html + '</section>';
  }

  /* Reparte las unidades entre los sabores elegidos: 7 sobres en Uva y Coco = 4 Uva + 3 Coco */
  function reparto(k, q){
    const sab = elegidos(k); const out = [];
    sab.forEach(function(f, i){ const n = Math.floor(q / sab.length) + (i < q % sab.length ? 1 : 0); if(n > 0) out.push([f, n]); });
    return out;
  }
  // "¿Qué sabores quieres?": se marcan uno o varios; siempre queda al menos uno
  function flavorPicker(k, q){
    const s = P[k].tienda.sabores;
    if(s.length < 2) return s.length ? '<div class="calc-help">Sabor: ' + s[0] + '</div>' : '';
    const sel = elegidos(k);
    const rep = reparto(k, q);
    return '<div class="calc-flavors" role="group" aria-label="Sabores de ' + P[k].name + '"><span class="calc-flavors-q">¿Qué sabores quieres?</span>' +
      s.map(function(f){ const on = sel.indexOf(f) !== -1;
        return '<button type="button" class="calc-flavor' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-flavor-k="' + k + '" data-flavor-v="' + f + '">' + f + '</button>';
      }).join('') +
      (rep.length > 1 ? '<span class="calc-flavors-split">' + rep.map(function(x){ return x[1] + ' ' + x[0]; }).join(' · ') + '</span>' : '') + '</div>';
  }

  function soonNote(keys){
    return keys.some(isSoon) ? '<p class="calc-help">Honey Stinger llega pronto: por ahora esos productos no se agregan al carrito. El resto sí.</p>' : '';
  }

  function kitHtml(kit, pk){
    const keys = Object.keys(kit.serv);
    if(!keys.length) return '';
    let html = '<section class="calc-card"><h2 class="calc-section-title">Tu kit para el evento</h2><div class="calc-table-wrap"><table class="calc-table"><thead><tr><th>Producto</th><th class="n calc-col-porc">Porciones</th><th>Compras</th><th class="n">Precio</th></tr></thead><tbody>' +
      keys.map(function(k){ const p = P[k];
        return '<tr><td><span class="calc-prod">' + mini(k, 32) + p.name + '</span>' + soonTag(k) + flavorPicker(k, pk.units[k]) + '</td><td class="n calc-col-porc">' + NUM(kit.serv[k]) + '</td><td>' + NUM(pk.units[k]) + ' × ' + p.sell + '</td><td class="n">' + usd(pk.lineas[k]) + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="calc-col-porc"></td><td></td><td class="n">' + usd(pk.total) + '</td></tr></tfoot></table></div>';
    html += '<p class="calc-help">' + (pk.fijadoPorApex ? 'Precio del kit fijado por APEX.' : 'Precio con el descuento por caja del sitio.') + ' El 10% de primera compra y las promociones se aplican en el carrito.</p>';
    if(kit.caf > 0) html += '<p class="calc-help">' + kit.porque + ' La cafeína va en la segunda mitad del evento. Si terminas de noche, puede afectar tu sueño.</p>';
    if(kit.cafNote) html += '<p class="calc-help">' + kit.cafNote + '</p>';
    return html + soonNote(keys) + '</section>';
  }

  function weekHtml(w, tr){
    const keys = Object.keys(w.units);
    let html = '<section class="calc-card"><h2 class="calc-section-title">Tu kit de la semana</h2>';
    if(!keys.length) return html + '<p>Con tus sesiones actuales no necesitas productos: basta con agua.</p></section>';
    html += '<div class="calc-table-wrap"><table class="calc-table"><thead><tr><th>Producto</th><th class="n calc-col-porc">Porciones</th><th>Compras</th><th class="n">Precio</th></tr></thead><tbody>' +
      keys.map(function(k){ const p = P[k];
        return '<tr><td><span class="calc-prod">' + mini(k, 32) + p.name + '</span>' + soonTag(k) + flavorPicker(k, w.units[k]) + '</td><td class="n calc-col-porc">' + NUM(w.week[k]) + '</td><td>' + NUM(w.units[k]) + ' × ' + p.sell + '</td><td class="n">' + usd(w.lineas[k]) + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="calc-col-porc"></td><td></td><td class="n">' + usd(w.total) + '</td></tr></tfoot></table></div>';
    html += '<p class="calc-help">Calculado con las mismas reglas del plan: ' + w.nNormal + ' sesion' + (w.nNormal === 1 ? '' : 'es') + ' de ' + hours(tr.normalMin) + ' h' +
      (tr.hasLong ? ' y 1 sesión larga de ' + hours(tr.longMin) + ' h' : '') + '.' +
      (w.gutBlock ? ' Es una semana de práctica: en las sesiones de 1 h o más comes lo mismo que en la carrera.' : '') +
      (w.fijadoPorApex ? ' Precio fijado por APEX.' : ' Si sumas 6 o más de un producto, el carrito aplica el precio por caja.') + '</p>';
    return html + soonNote(keys) + '</section>';
  }

  function noticesHtml(inp){
    return '<div class="calc-notice calc-notice--info"><p><strong>Antes de usarlo en competencia</strong></p><ul>' +
      '<li>Prueba este plan en tus entrenamientos antes de competir.</li>' +
      '<li>Empieza a hidratarte desde temprano: si te deshidratas, tu estómago vacía más lento lo que tomes (Neufer 1989).</li>' +
      (inp.intens === 'alta' ? '<li>A intensidad alta el estómago vacía más lento: puede que no toleres todo el líquido del plan (Maughan y Rehrer 1994).</li>' : '') +
      '<li>No tomes ni consumas de más para “evitar calambres”: no sirve para eso y puede ser peligroso.</li>' +
      '<li>Si tienes dolor de cabeza, vómito, confusión o hinchazón con aumento de peso durante el ejercicio, deja de beber y busca atención médica.</li>' +
      '<li>Esta calculadora orienta: no reemplaza a un nutricionista ni a un médico.</li></ul></div>';
  }

  /* ---------- Banner del kit de la semana ----------
     Solo promete un descuento si APEX lo fijó (CALC_DESCUENTO_PACK en productos.js). */
  function promo(){
    if(DESCUENTO > 0){
      const pct = Math.round(DESCUENTO * 100) + '%';
      $('calc-promo-eyebrow').textContent = pct + ' de descuento';
      $('calc-pack-title').textContent = 'Obtén ' + pct + ' armando tu kit de la semana';
    }
  }

  /* ---------- Barra fija con el botón del carrito ---------- */
  function bar(){
    const b = $('calc-bar');
    const on = !!(current && Object.keys(current.kit).length);
    b.hidden = !on;
    document.body.classList.toggle('calc-bar-on', on);
    if(!on) return;
    const semana = !!(weekBuilt && current.week && Object.keys(current.week).length);
    $('calc-bar-name').textContent = semana ? 'Agregar kit de la semana' : 'Agregar kit del evento';
    $('calc-bar-price').textContent = usd(semana ? current.weekTotal : current.kitTotal);
  }

  let current = null;   // último resultado, para los botones de agregar
  function render(){
    const out = $('calc-out');
    $('calc-bar-msg').textContent = '';
    const stop = exclusions();
    $('calc-stop').hidden = !stop;
    if(stop){
      // Sin cifras: el aviso va arriba de todo (#calc-stop) y no se muestra ningún plan
      current = null;
      out.innerHTML = '';
      $('calc-pack').hidden = true; $('calc-notices').innerHTML = ''; bar();
      return;
    }
    const inp = readInp();
    if(!validate(inp)){ current = null; $('calc-pack').hidden = true; bar(); return; }
    const pl = M.plan(inp); const kit = M.kitFromPlan(pl, inp); const pk = M.precioKit(kit);
    current = { kit: pk.units, kitTotal: pk.total, week: null, weekTotal: 0 };
    // Lo que se guarda del plan (si hay consentimiento)
    current.resumen = {
      carbMeta: pl.ct.g, carbPlan: pl.carbs, aguaLh: pl.V, aguaMin: pl.floor, sudorLh: pl.S, sudorFuente: pl.sweatSrc,
      sodioMeta: pl.naT != null ? Math.round(pl.naT) : null, sodioPlan: pl.naSum, porHora: pl.items,
      perdidaPct: pl.avisoAgua ? Math.round(pl.avisoAgua.perdida * 10) / 10 : null,
      kitPorciones: kit.serv, cafeinaMg: kit.caf, kitPrecio: Math.round(pk.total * 100) / 100
    };
    out.innerHTML = goalsHtml(pl) + planHtml(pl, kit, inp) + kitHtml(kit, pk);
    $('calc-pack').hidden = false;
    renderWeek(inp);
    $('calc-notices').innerHTML = noticesHtml(inp);
    bar();
  }

  function renderWeek(inp){
    $('calc-week-start').hidden = weekBuilt;
    packForm.hidden = !weekBuilt;
    if(!weekBuilt){ current.week = null; $('calc-pack-out').innerHTML = ''; return; }
    const tr = readTr();
    const w = M.weekPack(inp, tr);
    current.week = w.units; current.weekTotal = w.total;
    current.resumen.semana = w.week; current.resumen.semanaPrecio = Math.round(w.total * 100) / 100;
    $('calc-pack-out').innerHTML = weekHtml(w, tr) +
      '<p class="calc-week-back"><button type="button" class="calc-linkbtn" id="calc-week-stop">Prefiero solo el kit del evento</button></p>';
  }

  /* ---------- Agregar al carrito (addItemToCart de app.js) ---------- */
  function addToCart(units, which){
    let added = 0, skipped = 0;
    Object.keys(units).forEach(function(k){
      const p = P[k], q = units[k]; if(!(q > 0)) return;
      if(isSoon(k)){ skipped++; return; }
      const tiers = p.boxes ? [{ units: 1, unitPrice: p.price }].concat([6, 12, 24].map(function(n){ return { units: n, unitPrice: p.boxes[n] / n }; })) : null;
      // Una línea por sabor; las del mismo producto comparten "family", así el precio por caja suma todos los sabores
      (p.tienda.sabores.length ? reparto(k, q) : [['', q]]).forEach(function(x){
        const f = P[k].tienda.fotos && P[k].tienda.fotos[x[0]];
        addItemToCart({
          name: p.tienda.titulo.replace('{sabor}', x[0]).replace(/\s+/g, ' ').trim(), brand: p.tienda.marca, photo: f ? f[0] : p.tienda.foto,
          variant: tiers ? x[1] + ' unidad' + (x[1] === 1 ? '' : 'es') : '',
          unitPrice: p.price, quantity: x[1],
          family: tiers ? p.tienda.pagina : null, tiers: tiers
        });
      });
      added++;
    });
    $('calc-bar-msg').innerHTML = (added ? (which === 'kit' ? 'Kit del evento agregado ✓' : 'Kit de la semana agregado ✓') + ' <a href="carrito.html">Ver carrito</a>' : 'No se agregó nada.') +
      (skipped ? ' Honey Stinger quedó fuera por ahora.' : '');
    if(typeof trackEvent === 'function') trackEvent('calculadora_agregar', { tipo: which });
    if(added) guardar(which === 'kit' ? 'kit' : 'pack', Object.assign({}, current.resumen, { unidadesAgregadas: units, sabores: flavors, honeyFuera: skipped > 0 }));
  }

  document.addEventListener('click', function(e){
    const add = e.target.closest('[data-add]');
    if(add && current){
      const semana = weekBuilt && current.week;
      addToCart(semana ? current.week : current.kit, semana ? 'pack' : 'kit');
    }
    if(e.target.closest('#calc-week-start') || e.target.closest('#calc-week-stop')){
      weekBuilt = !!e.target.closest('#calc-week-start');
      render();
      if(weekBuilt){ guardar('plan', current.resumen); const f = packForm.querySelector('.pill--active'); if(f) f.focus({ preventScroll: true }); }
      else $('calc-week-start').focus({ preventScroll: true });
    }
    const fl = e.target.closest('[data-flavor-k]');
    if(fl){
      const k = fl.dataset.flavorK, v = fl.dataset.flavorV;
      const sel = elegidos(k).slice(); const i = sel.indexOf(v);
      if(i === -1) sel.push(v); else if(sel.length > 1) sel.splice(i, 1);
      flavors[k] = P[k].tienda.sabores.filter(function(f){ return sel.indexOf(f) !== -1; });
      const y = window.scrollY; render(); window.scrollTo(0, y);   // se redibuja con el nuevo reparto, sin mover la página
      const again = document.querySelector('[data-flavor-k="' + k + '"][data-flavor-v="' + v + '"]'); if(again) again.focus({ preventScroll: true });
    }
    const drink = e.target.closest('[data-set-drink]');
    if(drink){ const r = form.querySelector('input[name="drink"][value="' + drink.dataset.setDrink + '"]'); if(r){ r.checked = true; onChange(); } }
  });
  function onChange(){
    syncFields();
    if(started) render();
  }
  form.addEventListener('input', function(e){
    if(/^calc-s[1-5]$/.test(e.target.id)){ sweatHelper(); return; }
    onChange();
  });
  form.addEventListener('change', onChange);
  form.addEventListener('submit', function(e){
    e.preventDefault();
    started = true; syncFields(); render();
    if(exclusions()){
      // Llevar al atleta arriba, al aviso de "No te damos cifras"
      const stop = $('calc-stop');
      // Salto directo (sin animación): en algunos celulares el scroll suave se cortaba a mitad de camino
      stop.focus({ preventScroll: true });
      window.scrollTo(0, Math.max(0, stop.getBoundingClientRect().top + window.scrollY - 120));
      return;
    }
    if(!$('calc-error').hidden){ const bad = form.querySelector('[aria-invalid="true"]'); if(bad) bad.focus(); return; }
    if(current) guardar('plan', current.resumen);
    if(window.matchMedia('(max-width: 1024px)').matches) $('calc-out').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });

  // Kit de la semana: los botones de días y horas ya redibujan todo (onChange); aquí solo la casilla de práctica
  packForm.addEventListener('change', onChange);
  packForm.addEventListener('submit', function(e){ e.preventDefault(); });

  promo();
  syncFields();
})();
