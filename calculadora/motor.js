/* ==========================================================================
   Calculadora APEX — motor de cálculo (Reglas 1 a 6 de calculadora-apex/PROMPT.md)

   Basado en el motor del prototipo (calculadora-apex/referencia/motor/engine.js),
   con los cambios aprobados por el dueño el 2026-10-27:
   - Gel Going Café con 12,5 mg de cafeína: cuenta dentro del tope de 6 mg/kg
     y no se usa si el atleta no quiere cafeína.
   - Geles Honey Stinger separados (Fruit Smoothie/Acai, Gold, Strawberry
     Kiwi) y con precio por caja.
   - Waffle Honey Stinger como formato de energía, solo a intensidad baja o moderada.

   No cambies ningún número sin aprobación del dueño: cada uno tiene su fuente
   en calculadora-apex/REFERENCIAS.md. Los datos de productos están en productos.js.

   Cada número del resultado va acompañado de su explicación ("porque"), que
   la interfaz muestra en el botón "¿por qué?".
   ========================================================================== */
(function(root){
  const P = typeof CALC_PRODUCTOS !== 'undefined' ? CALC_PRODUCTOS : require('./productos.js').CALC_PRODUCTOS;
  const config = typeof CALC_PRECIO_KIT !== 'undefined'
    ? { kit: CALC_PRECIO_KIT, pack: CALC_PRECIO_PACK }
    : (function(){ const d = require('./productos.js'); return { kit: d.CALC_PRECIO_KIT, pack: d.CALC_PRECIO_PACK }; })();

  const GEL_BASE = 'hs_gel_fruta';      // formato de energía por defecto
  const GEL_CAFEINA = 'hs_gel_cafe';    // Strawberry Kiwi, 32 mg
  const CAF_TOPE_MG_KG = 6;             // Guest 2021 (ISSN)
  // Decimales con coma, como se escriben en Venezuela (textos del "¿por qué?")
  const dec = function(x, d){ return x.toFixed(d).replace('.', ','); };

  /* ---------- Regla 2: tabla de sudor en carrera (Sawka 2007) ---------- */
  const SWEAT = {
    fresco:   { 50: [0.43, 0.53, 0.69, 0.86], 70: [0.65, 0.79, 1.02, 1.25], 90: [0.86, 1.04, 1.34, 1.64] },
    caluroso: { 50: [0.52, 0.62, 0.79, 0.96], 70: [0.75, 0.89, 1.12, 1.36], 90: [0.97, 1.15, 1.46, 1.76] }
  };
  const SPEEDS = [8.5, 10, 12.5, 15];

  function interp1(xs, ys, x){
    if(x <= xs[0]) return ys[0];
    if(x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for(let i = 0; i < xs.length - 1; i++){
      if(x >= xs[i] && x <= xs[i + 1]){ const t = (x - xs[i]) / (xs[i + 1] - xs[i]); return ys[i] + t * (ys[i + 1] - ys[i]); }
    }
  }
  function sweatRun(w, speed, clima){
    const tb = SWEAT[clima]; const ws = [50, 70, 90];
    return interp1(ws, ws.map(function(k){ return interp1(SPEEDS, tb[k], speed); }), w);
  }

  /* ---------- Regla 1: carbohidrato por hora ---------- */
  function carbTarget(min, intens, gut){
    let g, band = '', why;
    if(min < 45){ g = 0; band = '<45'; why = 'Menos de 45 min: no hace falta carbohidrato (ACSM 2016, p. 555).'; }
    else if(min <= 75){ g = 0; band = 'opc'; why = '45–75 min: enjuague bucal o cantidades pequeñas, sin meta por hora (Jeukendrup 2014, Fig. 1).'; }
    else if(min <= 120){ g = 30; why = '1–2 h: 30 g por hora (Jeukendrup 2014, Fig. 1).'; }
    else if(min <= 150){ g = 60; why = '2–2,5 h: 60 g por hora (Jeukendrup 2014, Fig. 1).'; }
    else {
      g = gut ? 90 : 60;
      why = gut
        ? 'Más de 2,5 h con estómago entrenado: 90 g por hora, solo con mezclas de glucosa y fructosa (Jeukendrup 2014, Fig. 1).'
        : 'Más de 2,5 h sin estómago entrenado: tope de 60 g por hora (decisión de diseño basada en Costa 2017).';
    }
    if(intens === 'baja' && g > 30){ g = g === 90 ? 60 : 30; why += ' Intensidad baja: se baja un nivel (Jeukendrup 2014, pp. S29–S30; el ajuste es decisión de diseño).'; }
    if(!gut && g > 60) g = 60;
    return { g: g, band: band, why: why };
  }

  /* Formato de energía que se puede usar con este perfil. */
  function resolvePref(inp, notas){
    let pref = inp.gelPref || GEL_BASE;
    if(pref === 'going_gel' && !inp.caf){
      pref = GEL_BASE;
      notas.push('El gel Going Café trae cafeína y marcaste que no quieres: usamos geles Honey Stinger.');
    }
    if(P[pref].soloIntensidad && P[pref].soloIntensidad.indexOf(inp.intens) === -1){
      pref = GEL_BASE;
      notas.push('Los waffles son para intensidad baja o moderada: a intensidad alta usamos geles Honey Stinger.');
    }
    return pref;
  }

  /* ---------- Reglas 1 a 5: plan por hora ---------- */
  function plan(inp, opt){
    opt = opt || {};
    const h = inp.min / 60;
    const notas = [];
    const ct = opt.carbOverride != null
      ? { g: opt.carbOverride, band: '', why: 'Bloque de práctica: se usa la meta de la carrera.' }
      : carbTarget(inp.min, inp.intens, inp.gut);

    // Regla 2: líquido
    let S, sweatSrc;
    if(inp.sweat > 0){ S = inp.sweat; sweatSrc = 'medida'; }
    else if(inp.sport === 'carrera'){ const sp = inp.dist > 0 ? inp.dist / h : 10; S = sweatRun(inp.w, sp, inp.clima); sweatSrc = 'estimada (tabla de Sawka 2007 para carrera)'; }
    else { S = inp.clima === 'caluroso' ? 0.8 : 0.6; sweatSrc = 'estimada (sin medición; mide tu sudor para un cálculo exacto)'; }
    const medirSudor = !(inp.sweat > 0) && inp.sport !== 'carrera';
    const floor = Math.max(0, S - 0.02 * inp.w / h);
    // Tope de líquido: ~1.05 L/h tolerado 3 h con calor (Ryan 1989); 1.25 solo si entrena bebiendo (Rehrer 2001; Neufer 1989)
    const VCAP = inp.drinkTrained ? 1.25 : 1.0;
    const capHit = S > VCAP; const Seff = Math.min(S, VCAP); const floorEff = Math.min(floor, VCAP);
    const mid = (floorEff + Seff) / 2; let V = null;
    for(let x = Math.ceil(floorEff * 4 - 1e-9) / 4; x <= Seff + 1e-9; x += 0.25){
      if(x > 0 && (V == null || Math.abs(x - mid) < Math.abs(V - mid))) V = x;
    }
    if(V == null) V = Math.max(0.05, Math.round(mid * 20) / 20);
    const perdida = Math.max(0, (S - V) * h / inp.w * 100);
    const avisoAgua = (capHit || V < floor - 0.01) ? { perdida: perdida, tope: VCAP } : null;

    // Regla 3: sodio
    const trig = [];
    if(S > 1.2) trig.push('sudas más de 1,2 L/h');
    if(inp.salty) trig.push('eres sudador salado');
    if(h > 2) trig.push('el evento dura más de 2 h');
    const conc = inp.salty ? 30 : 20;
    const naT = trig.length ? V * conc * 23 : null;

    const items = {};
    const add = function(k, n){ if(n > 0) items[k] = (items[k] || 0) + n; };

    // Regla 5.1: bebida
    let dk = inp.drink || 'auto'; if(dk === 'auto') dk = trig.length ? 'going_hidr' : 'agua';
    let dCarb = 0, dNa = 0, waterExtra = V;
    if(dk !== 'agua'){
      const d = P[dk]; let n = Math.floor((V + 0.1) / d.vol + 1e-9);
      while(n > 0 && n * d.vol > S + 1e-9) n--;                 // nunca más líquido que el sudor
      if(ct.g > 0) while(n > 0 && n * d.carb > ct.g) n--;        // la bebida no pasa la meta de carbohidrato
      if(n === 0 && d.vol <= S + 1e-9 && V >= d.vol * 0.5) n = 1;
      if(naT != null) while(n > 0 && n * d.na > naT + 150) n--;  // ni pasa la meta de sodio por más de 150 mg
      add(dk, n); dCarb = n * d.carb; dNa = n * d.na;
      waterExtra = Math.max(0, Math.round((V - n * d.vol) * 20) / 20);
    }

    // Regla 5.3: carbohidrato restante
    const hardCap = inp.gut ? 90 : 60;
    let carbs = dCarb, fruCarb = (dk !== 'agua' && P[dk].fru) ? dCarb : 0, naSum = dNa;
    const pref = resolvePref(inp, notas);
    // Gel Going: no más unidades de las que caben en el tope de cafeína de todo el evento
    const goingMax = Math.floor(Math.floor(CAF_TOPE_MG_KG * inp.w / P.going_gel.caf) / h + 1e-9);
    let opcional = null;
    if(ct.band === 'opc') opcional = pref;
    if(ct.g > 0){
      const fill = function(key, limit, strict){
        const p = P[key];
        let n = Math.max(0, (strict ? Math.floor : Math.round)((limit - carbs) / p.carb + 1e-9));
        while(n > 0 && carbs + n * p.carb > hardCap) n--;
        // ningún producto sin fructosa lleva el carbohidrato sin fructosa por encima de 60 g/h
        if(!p.fru) while(n > 0 && carbs - fruCarb + n * p.carb > 60) n--;
        if(key === 'going_gel') n = Math.min(n, goingMax - (items.going_gel || 0));
        add(key, n); carbs += n * p.carb; naSum += n * p.na; if(p.fru) fruCarb += n * p.carb;
      };
      if(ct.g > 60 && !P[pref].fru){ fill(pref, 60, true); fill(GEL_BASE, ct.g); }
      else fill(pref, ct.g);
      if(!P[pref].fru && carbs < ct.g) fill(GEL_BASE, ct.g);  // lo que no cupo por cafeína o por la regla de fructosa
      // Completar: si faltan 15 g o más, la unidad que más acerque a la meta sin pasar el tope ni la regla de fructosa
      const gap = ct.g - carbs;
      if(gap >= 15){
        const nonFru = carbs - fruCarb; let best = null;
        [pref, GEL_BASE, 'going_gel', 'probar_bolt', 'hs_gomitas'].forEach(function(key){
          const p = P[key];
          if(key === 'going_gel' && (!inp.caf || (items.going_gel || 0) + 1 > goingMax)) return;
          if(carbs + p.carb > hardCap) return;
          if(!p.fru && nonFru + p.carb > 60) return;
          const err = Math.abs(ct.g - (carbs + p.carb));
          if(err < gap && (best == null || err < best.err)) best = { key: key, err: err };
        });
        if(best){ const p = P[best.key]; add(best.key, 1); carbs += p.carb; naSum += p.na; if(p.fru) fruCarb += p.carb; }
      }
    }

    // Regla 5.4: sodio restante
    if(naT != null){
      const rem = naT - naSum;
      if(rem > 0){
        const nChews = Math.round(rem / 100); const chewsCarb = nChews * P.ss_chews.carb;
        // Los FastChews traen 2 g de carbohidrato sin fructosa: si pasarían el tope de carbohidrato
        // o el de 60 g/h sin fructosa, se usan cápsulas (0 g).
        const chewsOk = carbs + chewsCarb <= hardCap && carbs - fruCarb + chewsCarb <= 60;
        if(rem < 150 && chewsOk){ add('ss_chews', nChews); naSum += nChews * 100; carbs += chewsCarb; }
        else { const n = Math.round(rem / 215); add('ss_caps', n); naSum += n * 215; }
      }
    }

    const porque = {
      carb: ct.why + (carbs > 60 ? ' Por encima de 60 g/h, el exceso viene de productos con fructosa (Jeukendrup 2014).' : ''),
      agua: 'Tu tasa de sudor es de unos ' + dec(S, 2) + ' L/h, ' + sweatSrc + '. El mínimo evita perder más del 2 % de tu peso (Sawka 2007). ' +
        'El máximo es lo que sudas: beber más que eso puede causar hiponatremia (Hew-Butler 2015). Además, no recomendamos más de ' +
        (inp.drinkTrained ? '1,25' : '1') + ' L por hora: es lo que el estómago suele vaciar durante el ejercicio (Ryan 1989; Neufer 1989).',
      sodio: naT != null
        ? 'Te damos sodio porque ' + trig.join(', ') + ' (ACSM 2016). La cantidad sale de tu agua por hora con una concentración de ' + conc +
          ' mEq/L (Sawka 2007). El sodio no previene calambres (Hoffman 2015; Schwellnus 2009).'
        : 'Solo agregamos sodio si sudas más de 1,2 L/h, si eres sudador salado o si el evento dura más de 2 h (ACSM 2016).'
    };

    return {
      h: h, ct: ct, S: S, sweatSrc: sweatSrc, medirSudor: medirSudor, floor: floor, V: V, VCAP: VCAP, capHit: capHit, avisoAgua: avisoAgua,
      trig: trig, conc: conc, naT: naT, items: items, carbs: carbs, fruCarb: fruCarb, naSum: naSum,
      drink: dk, alternativaBebida: dk === 'going_hidr' ? 'skratch' : null, waterExtra: waterExtra,
      pref: pref, opcional: opcional, notas: notas, porque: porque
    };
  }

  /* ---------- Regla 5.6 y Regla 4: kit del evento ---------- */
  function kitFromPlan(pl, inp){
    const serv = {};
    for(const k in pl.items) serv[k] = Math.ceil(pl.items[k] * pl.h - 1e-9);
    const cafGoing = (serv.going_gel || 0) * P.going_gel.caf;
    let cafHs = 0, cafNote = '';
    if(inp.caf && serv[GEL_BASE]){
      // Strawberry Kiwi en la segunda mitad, sin pasar 6 mg/kg contando la cafeína del gel Going
      const cap = Math.floor((CAF_TOPE_MG_KG * inp.w - cafGoing) / P[GEL_CAFEINA].caf);
      const n = Math.max(0, Math.min(Math.floor(serv[GEL_BASE] / 2), cap));
      serv[GEL_BASE] -= n; if(serv[GEL_BASE] === 0) delete serv[GEL_BASE];
      if(n > 0) serv[GEL_CAFEINA] = n;
      cafHs = n * P[GEL_CAFEINA].caf;
    } else if(inp.caf && !serv.going_gel){
      cafNote = 'Para incluir cafeína elige geles Honey Stinger o el gel Going Café.';
    }
    const caf = cafGoing + cafHs;
    const porque = caf > 0
      ? 'Cafeína total: ' + String(caf).replace('.', ',') + ' mg (' + dec(caf / inp.w, 1) + ' mg/kg). Tope: ' + CAF_TOPE_MG_KG + ' mg/kg (Guest 2021).'
      : '';
    return { serv: serv, caf: caf, cafNote: cafNote, porque: porque };
  }

  /* Unidades que se compran para cubrir unas porciones (ej. FastChews: sobres de 10 = 5 porciones). */
  function sellUnits(k, servings){ return Math.ceil(servings / P[k].perSell - 1e-9); }

  /* Precio como lo cobra el carrito del sitio (applyFamilyPricing en app.js): las
     unidades de una misma ficha se suman entre sabores y, si llegan a 6/12/24,
     todas pagan el precio por unidad de esa caja. units: { id: unidades }. */
  function precioTienda(units){
    const porPagina = {};
    for(const k in units){ const pg = P[k].tienda.pagina; porPagina[pg] = (porPagina[pg] || 0) + units[k]; }
    const lineas = {}; let total = 0;
    for(const k in units){
      const p = P[k]; const tot = porPagina[p.tienda.pagina]; let unit = p.price;
      if(p.boxes) [6, 12, 24].forEach(function(n){ if(tot >= n) unit = p.boxes[n] / n; });
      lineas[k] = units[k] * unit; total += lineas[k];
    }
    return { lineas: lineas, total: total };
  }

  function precioKit(kit){
    const units = {};
    for(const k in kit.serv) units[k] = sellUnits(k, kit.serv[k]);
    const pr = precioTienda(units);
    return { units: units, lineas: pr.lineas, total: config.kit != null ? config.kit : pr.total, fijadoPorApex: config.kit != null };
  }

  /* ---------- Regla 6: pack mensual ---------- */
  function boxCombo(k, units){
    const p = P[k]; if(!p.boxes) return { combo: [[1, units]], leftover: 0, units: units };
    let best = null;
    for(let a = 0; a <= Math.ceil(units / 24) + 1; a++) for(let b = 0; b <= 2; b++) for(let c = 0; c <= 2; c++){
      const tot = a * 24 + b * 12 + c * 6; if(tot < units) continue;
      const left = tot - units; const nb = a + b + c;
      if(!best || left < best.left || (left === best.left && nb < best.nb)) best = { a: a, b: b, c: c, left: left, nb: nb };
    }
    const combo = [];
    if(best.a) combo.push([24, best.a]); if(best.b) combo.push([12, best.b]); if(best.c) combo.push([6, best.c]);
    return { combo: combo, leftover: best.left, units: units + best.left };
  }

  function monthPack(inp, tr){
    const normalMin = tr.normalMin, longMin = tr.hasLong ? tr.longMin : 0;
    const nNormal = Math.max(0, tr.days - (tr.hasLong ? 1 : 0));
    const week = {}; const addS = function(o, f){ for(const k in o) week[k] = (week[k] || 0) + o[k] * f; };
    const train = Object.assign({}, inp, { caf: false });  // sin Strawberry Kiwi en entrenamientos
    const pn = normalMin > 0 ? plan(Object.assign({}, inp, { min: normalMin })) : null;
    const kn = pn ? kitFromPlan(pn, train) : { serv: {} };
    addS(kn.serv, nNormal);
    let pl = null;
    if(tr.hasLong && longMin > 0){ pl = plan(Object.assign({}, inp, { min: longMin })); addS(kitFromPlan(pl, train).serv, 1); }
    const month = {}; for(const k in week) month[k] = week[k] * 4;
    let gutExtra = null;
    if(tr.gutBlock && !inp.gut && normalMin >= 60){
      const raceT = carbTarget(inp.min, inp.intens, false).g;
      if(raceT > 0){
        const kg = kitFromPlan(plan(Object.assign({}, inp, { min: normalMin }), { carbOverride: raceT }), train);
        gutExtra = {};
        for(const k in kg.serv){ const d = (kg.serv[k] - (kn.serv[k] || 0)) * nNormal * 2; if(d > 0){ gutExtra[k] = d; month[k] = (month[k] || 0) + d; } }
      }
    }
    const compra = {}; const units = {};
    for(const k in month){ compra[k] = boxCombo(k, sellUnits(k, month[k])); units[k] = compra[k].units; }
    const pr = precioTienda(units);
    return {
      week: week, month: month, gutExtra: gutExtra, pn: pn, pl: pl, nNormal: nNormal, compra: compra,
      lineas: pr.lineas, total: config.pack != null ? config.pack : pr.total, fijadoPorApex: config.pack != null
    };
  }

  /* ---------- Regla 5.5: línea de tiempo ----------
     Tomas cada 20 min si hay 3 o más unidades en la hora, si no cada 30 min.
     Si hay más unidades que tomas, en una toma van juntas (ej. gel + FastChews).
     La bebida se empieza al inicio de cada hora. Los geles con cafeína van al final. */
  function schedule(pl, kit, min){
    const ev = []; const hours = Math.ceil(min / 60 - 1e-9);
    const left = {}; for(const k in pl.items) left[k] = kit.serv[k] || 0;
    if(kit.serv[GEL_CAFEINA]) left[GEL_BASE] = (left[GEL_BASE] || 0) + kit.serv[GEL_CAFEINA];
    for(let i = 0; i < hours; i++){
      const t0 = i * 60; const len = Math.min(60, min - t0);
      const solids = [];
      for(const k in pl.items){
        const p = P[k];
        if(p.role === 'drink'){ if(left[k] > 0){ ev.push({ t: t0, k: k, n: pl.items[k], drink: true }); left[k] -= pl.items[k]; } continue; }
        const n = Math.min(pl.items[k], left[k]); left[k] -= n;
        for(let j = 0; j < n; j++) solids.push(k);
      }
      if(!solids.length) continue;
      const step = solids.length >= 3 ? 20 : 30;
      // tomas a mitad de cada intervalo (10, 30, 50 o 15, 45): así no cae ninguna en la meta
      const slots = []; for(let t = step / 2; t < len - 1e-9; t += step) slots.push(t0 + t);
      if(!slots.length) slots.push(t0 + len / 2);
      solids.forEach(function(k, j){ ev.push({ t: slots[Math.min(slots.length - 1, Math.floor(j * slots.length / solids.length))], k: k, n: 1 }); });
    }
    ev.sort(function(a, b){ return a.t - b.t; });
    let caf = kit.serv[GEL_CAFEINA] || 0;
    for(let i = ev.length - 1; i >= 0 && caf > 0; i--) if(ev[i].k === GEL_BASE){ ev[i].k = GEL_CAFEINA; caf--; }
    return ev;
  }

  const api = { P: P, carbTarget: carbTarget, plan: plan, kitFromPlan: kitFromPlan, sellUnits: sellUnits, boxCombo: boxCombo,
    monthPack: monthPack, precioTienda: precioTienda, precioKit: precioKit, schedule: schedule, CAF_TOPE_MG_KG: CAF_TOPE_MG_KG };
  if(typeof module !== 'undefined') module.exports = api; else root.CalcMotor = api;
})(this);
