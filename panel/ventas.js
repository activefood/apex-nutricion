/* Tablero de ventas del panel (botón "Ventas"): por defecto el mes actual en vivo; filtro Este mes / Mes anterior / Histórico / Fechas;
   gráfica de ventas por día (por mes si el rango es largo), distribución por producto o marca y comparativo en % con el periodo anterior.
   Habla solo con el Worker (/api/panel/ventas), que exige la sesión del panel. Sin librerías: las gráficas son SVG dibujado aquí.
   Modo demostración (?demo=1, solo en localhost): datos de mentira. */
(function(){
  'use strict';
  const $ = function(id){ return document.getElementById(id); };
  const DEMO = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && new URLSearchParams(location.search).has('demo');
  const REFRESH_MS = 20000;
  const btn = $('tool-ventas'), sec = $('ventas');
  if(!btn || !sec) return;

  let periodo = 'mes', grupo = 'producto', metrica = 'pedidos', data = null, timer = null, visible = false, cargando = false;

  /* ---------- Fechas (siempre en hora de Caracas) ---------- */
  function hoyCaracas(){ return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }); }
  function partes(s){ const p = s.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function iso(y, m, d){ return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function ultimoDia(y, m){ return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function sumarDias(s, n){ const p = partes(s); const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function diasEntre(a, b){ const pa = partes(a), pb = partes(b); return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000); }
  function mesAnterior(y, m){ return m === 1 ? { y: y - 1, m: 12 } : { y: y, m: m - 1 }; }

  /* Rango pedido y rango con el que se compara (null = sin comparación) */
  function rangos(){
    const hoy = hoyCaracas(), t = partes(hoy);
    if(periodo === 'mes'){
      const a = mesAnterior(t.y, t.m);
      return { desde: iso(t.y, t.m, 1), hasta: hoy, cdesde: iso(a.y, a.m, 1), chasta: iso(a.y, a.m, Math.min(t.d, ultimoDia(a.y, a.m))), etiqueta: 'vs mes anterior' };
    }
    if(periodo === 'anterior'){
      const a = mesAnterior(t.y, t.m), b = mesAnterior(a.y, a.m);
      return { desde: iso(a.y, a.m, 1), hasta: iso(a.y, a.m, ultimoDia(a.y, a.m)), cdesde: iso(b.y, b.m, 1), chasta: iso(b.y, b.m, ultimoDia(b.y, b.m)), etiqueta: 'vs mes previo' };
    }
    if(periodo === 'historico') return { desde: null, hasta: hoy, cdesde: null, chasta: null, etiqueta: '' };
    const d = $('v-desde').value, h = $('v-hasta').value;
    if(!d || !h || h < d) return null;
    const largo = diasEntre(d, h) + 1;
    return { desde: d, hasta: h, cdesde: sumarDias(d, -largo), chasta: sumarDias(d, -1), etiqueta: 'vs periodo anterior' };
  }

  /* ---------- Formato ---------- */
  const usd = function(n){ return '$' + (Math.round(Number(n) * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const entero = function(n){ return Number(n).toLocaleString('es-VE'); };
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const etiquetaDia = function(s){ const p = partes(s); return p.d + ' ' + MESES[p.m - 1]; };
  const etiquetaMes = function(s){ const p = partes(s + '-01'); return MESES[p.m - 1] + ' ' + String(p.y).slice(2); };

  const MARCAS = { 'GOING': 'Going', 'GOING NUTRICIÓN': 'Going', 'SKRATCH': 'Skratch Labs', 'SKRATCH LABS': 'Skratch Labs', 'SALTSTICK': 'SaltStick', 'PROBAR': 'Probar', 'HONEY STINGER': 'Honey Stinger' };
  const marcaNombre = function(m){ const k = String(m || '').trim().toUpperCase(); return MARCAS[k] || (k ? k.charAt(0) + k.slice(1).toLowerCase() : 'Sin marca'); };

  function el(tag, cls, text){ const n = document.createElement(tag); if(cls) n.className = cls; if(text != null) n.textContent = text; return n; }
  const svgNs = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs){ const n = document.createElementNS(svgNs, tag); Object.keys(attrs || {}).forEach(function(k){ n.setAttribute(k, attrs[k]); }); return n; }

  /* ---------- Red ---------- */
  async function pedir(r){
    if(DEMO) return demoData(r);
    const q = new URLSearchParams();
    if(r.desde) q.set('desde', r.desde);
    q.set('hasta', r.hasta);
    if(r.cdesde){ q.set('cdesde', r.cdesde); q.set('chasta', r.chasta); }
    const res = await fetch('/api/panel/ventas?' + q.toString(), { credentials: 'same-origin' });
    if(res.status === 401){ location.reload(); throw { auth: true }; }
    let j = null;
    try { j = await res.json(); } catch(e){}
    if(!res.ok || !j || j.ok === false) throw { message: (j && j.error) || 'No se pudieron leer las ventas.' };
    return j;
  }

  async function cargar(){
    if(cargando) return;
    const r = rangos();
    const err = $('ventas-error');
    if(!r){ err.hidden = false; err.textContent = 'Elige las dos fechas (la final no puede ser antes de la inicial).'; return; }
    cargando = true;
    try {
      data = await pedir(r);
      data._etiqueta = r.etiqueta;
      err.hidden = true;
      pintar();
      $('ventas-live').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' }) + (periodo === 'mes' ? ' · en vivo' : '');
    } catch(e){
      if(!e.auth){ err.hidden = false; err.textContent = e.message || 'No se pudieron leer las ventas.'; }
    }
    cargando = false;
  }

  /* ---------- Pintar ---------- */
  function delta(actual, previo, etiqueta){
    if(previo == null) return null;
    const box = el('span', 'delta');
    if(previo === 0){ box.textContent = actual > 0 ? 'Nuevo · sin ventas antes' : 'Sin cambio'; return box; }
    const pct = (actual - previo) / previo * 100;
    const r = Math.round(pct * 10) / 10;
    box.className = 'delta ' + (r > 0 ? 'delta--up' : r < 0 ? 'delta--down' : '');
    box.textContent = (r > 0 ? '▲ +' : r < 0 ? '▼ ' : '= ') + String(r).replace('.', ',') + '% ' + etiqueta;
    return box;
  }

  function kpi(titulo, valor, clase, d){
    const k = el('div', 'kpi' + (clase ? ' ' + clase : ''));
    k.appendChild(el('small', null, titulo));
    k.appendChild(el('strong', null, valor));
    if(d) k.appendChild(d);
    return k;
  }

  function pintar(){
    const a = data.actual, c = data.comparacion;
    const k = $('v-kpis'); k.textContent = '';
    const tickets = a.pedidos ? a.ventas / a.pedidos : 0;
    const tprev = c && c.pedidos ? c.ventas / c.pedidos : (c ? 0 : null);
    k.appendChild(kpi('Ventas', usd(a.ventas), 'kpi--main', c ? delta(a.ventas, c.ventas, data._etiqueta) : null));
    k.appendChild(kpi('Pedidos', entero(a.pedidos), '', c ? delta(a.pedidos, c.pedidos, data._etiqueta) : null));
    k.appendChild(kpi('Ticket promedio', usd(tickets), '', c ? delta(tickets, tprev, data._etiqueta) : null));
    pintarGrafica();
    pintarDistribucion();
  }

  /* Métricas de la gráfica mensual del Histórico (una sola gráfica; el filtro cambia lo que se ve) */
  const METRICAS = {
    pedidos:  { titulo: 'Pedidos por mes',          unidad: 'pedidos',  valor: function(m){ return m.pedidos; },  fmt: function(v){ return entero(v); },                     eje: function(v){ return String(Math.round(v)); }, delta: function(d){ return entero(Math.abs(d)) + (Math.abs(Math.round(d)) === 1 ? ' pedido' : ' pedidos'); } },
    ventas:   { titulo: 'Vendido por mes ($)',      unidad: 'ventas',   valor: function(m){ return m.ventas; },   fmt: function(v){ return '$' + Math.round(v).toLocaleString('es-VE'); }, eje: function(v){ return '$' + (v >= 1000 ? Math.round(v / 100) / 10 + 'k' : Math.round(v)); }, delta: function(d){ return '$' + Math.round(Math.abs(d)).toLocaleString('es-VE'); } },
    ticket:   { titulo: 'Ticket promedio por mes',  unidad: 'ticket',   valor: function(m){ return m.pedidos ? m.ventas / m.pedidos : 0; }, fmt: function(v){ return '$' + (Math.round(v * 10) / 10).toString().replace('.', ','); }, eje: function(v){ return '$' + Math.round(v); }, delta: function(d){ return '$' + (Math.round(Math.abs(d) * 10) / 10).toString().replace('.', ','); } },
    unidades: { titulo: 'Unidades vendidas por mes', unidad: 'unidades', valor: function(m){ return m.unidades; }, fmt: function(v){ return entero(v); },                     eje: function(v){ return String(Math.round(v)); }, delta: function(d){ return entero(Math.abs(d)) + (Math.abs(Math.round(d)) === 1 ? ' unidad' : ' unidades'); } }
  };

  // Recta de tendencia (mínimos cuadrados) sobre los puntos { x, y }. Devuelve { a, b } con y = a + b·x, o null si hay menos de 2 puntos.
  function tendencia(pts){
    const n = pts.length; if(n < 2) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    pts.forEach(function(p){ sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
    const den = n * sxx - sx * sx; if(!den) return null;
    const b = (n * sxy - sx * sy) / den;
    return { a: (sy - b * sx) / n, b: b };
  }

  function pintarGrafica(){
    const box = $('v-chart'); box.textContent = '';
    const dias = (data.dias || []).map(function(d){ return { clave: d.dia, ventas: Number(d.ventas) || 0, pedidos: Number(d.pedidos) || 0, unidades: Number(d.unidades) || 0 }; });
    const porMes = dias.length > 62;
    $('v-metricas').hidden = !porMes;
    const ley = $('v-leyenda'); ley.hidden = true; ley.textContent = '';
    if(!porMes) return pintarGraficaDiaria(dias, box);

    /* ----- Histórico: una barra por mes ----- */
    const meses = {};
    dias.forEach(function(p){ const k = p.clave.slice(0, 7); const m = meses[k] = meses[k] || { clave: k, ventas: 0, pedidos: 0, unidades: 0 }; m.ventas += p.ventas; m.pedidos += p.pedidos; m.unidades += p.unidades; });
    let pts = Object.keys(meses).sort().map(function(k){ return meses[k]; });
    // El primer y el último mes pueden estar a medias; los meses sin ningún pedido al inicio no se dibujan
    while(pts.length && !pts[0].pedidos) pts.shift();
    const M = METRICAS[metrica];
    $('v-titulo').textContent = M.titulo;
    if(metrica === 'unidades' && !(data.dias || []).some(function(d){ return d.unidades !== undefined; })){
      box.appendChild(el('p', 'v-vacio', 'Las unidades por mes se activan cuando se actualice la base de datos (pendiente).')); return;
    }
    const mesActual = hoyCaracas().slice(0, 7);
    const vals = pts.map(function(p){ return M.valor(p); });
    if(!pts.length || !vals.some(function(v){ return v > 0; })){ box.appendChild(el('p', 'v-vacio', 'Todavía no hay ventas para graficar.')); return; }

    const W = 720, H = 300, L = 62, R = 12, T = 26, B = 40;
    const max = Math.max.apply(null, vals);
    const paso = (function(){ const g = Math.pow(10, Math.floor(Math.log10(max))); const f = max / g; return (f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * g; })();
    const tope = Math.ceil(max / paso) * paso;
    const yDe = function(v){ return T + (H - T - B) * (1 - v / tope); };
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': M.titulo + ': ' + pts.map(function(p, i){ return etiquetaMes(p.clave) + ' ' + M.fmt(vals[i]); }).join(', ') });
    for(let v = 0; v <= tope + 0.001; v += paso){
      const y = yDe(v);
      s.appendChild(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
      const t = svg('text', { x: L - 8, y: y + 6, 'text-anchor': 'end' }); t.textContent = M.eje(v); s.appendChild(t);
    }
    const ancho = (W - L - R) / pts.length, bw = Math.max(8, Math.min(70, ancho * 0.62));
    const centro = function(i){ return L + ancho * i + ancho / 2; };
    pts.forEach(function(p, i){
      const enCurso = p.clave === mesActual;
      const h = (H - T - B) * (vals[i] / tope);
      const r = svg('rect', { x: centro(i) - bw / 2, y: H - B - h, width: bw, height: Math.max(vals[i] > 0 ? 2 : 0, h), class: 'bar' + (enCurso ? ' bar--curso' : '') });
      const t = svg('title'); t.textContent = etiquetaMes(p.clave) + (enCurso ? ' (mes en curso)' : '') + ': ' + M.fmt(vals[i]) + ' · ' + entero(p.pedidos) + (p.pedidos === 1 ? ' pedido' : ' pedidos') + ' · ' + usd(p.ventas) + ' · ' + entero(p.unidades) + ' unidades'; r.appendChild(t);
      s.appendChild(r);
      if(pts.length <= 14){ const v = svg('text', { x: centro(i), y: H - B - h - 7, 'text-anchor': 'middle', class: 'valor' }); v.textContent = M.fmt(vals[i]); s.appendChild(v); }
      const tx = svg('text', { x: centro(i), y: H - 14, 'text-anchor': 'middle' }); tx.textContent = etiquetaMes(p.clave) + (enCurso ? '*' : ''); s.appendChild(tx);
    });

    /* ----- Línea de tendencia: solo con meses completos (el mes en curso está a medias y la bajaría) ----- */
    const completos = pts.map(function(p, i){ return { x: i, y: vals[i], curso: p.clave === mesActual }; }).filter(function(p){ return !p.curso; });
    const tr = tendencia(completos);
    if(tr){
      const x0 = centro(0), x1 = centro(pts.length - 1);
      const y0 = yDe(Math.max(0, tr.a)), y1 = yDe(Math.max(0, tr.a + tr.b * (pts.length - 1)));
      s.appendChild(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'tendencia' }));
      const sube = tr.b > 0, plano = Math.abs(tr.b) < (Math.max.apply(null, completos.map(function(p){ return p.y; })) || 1) * 0.02;
      ley.hidden = false;
      const nota = pts.some(function(p){ return p.clave === mesActual; }) ? ' El mes en curso (*) va a medias y no cuenta para la tendencia.' : '';
      ley.appendChild(document.createTextNode('Línea punteada: tendencia. '));
      if(plano) ley.appendChild(el('b', null, 'Se mantiene estable'));
      else { const f = el('span', sube ? 'sube' : 'baja', (sube ? '▲ Sube ' : '▼ Baja ') + M.delta(tr.b) + ' por mes'); ley.appendChild(f); }
      ley.appendChild(document.createTextNode('.' + nota));
    } else {
      ley.hidden = false; ley.textContent = 'La línea de tendencia aparece cuando hay al menos 2 meses completos.';
    }
    box.appendChild(s);
  }

  function pintarGraficaDiaria(dias, box){
    $('v-titulo').textContent = 'Ventas por día';
    const pts = dias.map(function(d){ return { clave: d.clave, ventas: d.ventas, pedidos: d.pedidos }; });
    const total = pts.reduce(function(s, p){ return s + p.ventas; }, 0);
    if(!pts.length || total <= 0){ box.appendChild(el('p', 'v-vacio', 'Todavía no hay ventas en este periodo.')); return; }
    const W = 720, H = 280, L = 62, R = 8, T = 14, B = 38;
    const max = Math.max.apply(null, pts.map(function(p){ return p.ventas; }));
    const paso = (function(){ const g = Math.pow(10, Math.floor(Math.log10(max))); const f = max / g; return (f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * g; })();
    const tope = Math.ceil(max / paso) * paso;
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Gráfica de ventas por día: total ' + usd(total) });
    for(let v = 0; v <= tope + 0.001; v += paso){
      const y = T + (H - T - B) * (1 - v / tope);
      s.appendChild(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
      const t = svg('text', { x: L - 8, y: y + 6, 'text-anchor': 'end' }); t.textContent = '$' + (v >= 1000 ? Math.round(v / 100) / 10 + 'k' : Math.round(v)); s.appendChild(t);
    }
    const ancho = (W - L - R) / pts.length, bw = Math.max(2, Math.min(40, ancho * 0.7));
    const hoy = hoyCaracas();
    const cada = Math.max(1, Math.ceil(pts.length / 6));
    pts.forEach(function(p, i){
      const x = L + ancho * i + (ancho - bw) / 2;
      const h = (H - T - B) * (p.ventas / tope);
      const r = svg('rect', { x: x, y: H - B - h, width: bw, height: Math.max(p.ventas > 0 ? 2 : 0, h), class: 'bar' + (p.clave === hoy ? ' bar--hoy' : '') });
      const t = svg('title'); t.textContent = etiquetaDia(p.clave) + ': ' + usd(p.ventas) + ' · ' + p.pedidos + (p.pedidos === 1 ? ' pedido' : ' pedidos'); r.appendChild(t);
      s.appendChild(r);
      if(i % cada === 0){
        const tx = svg('text', { x: x + bw / 2, y: H - 12, 'text-anchor': 'middle' });
        tx.textContent = etiquetaDia(p.clave); s.appendChild(tx);
      }
    });
    box.appendChild(s);
  }

  function pintarDistribucion(){
    const box = $('v-dist'); box.textContent = '';
    const lista = grupo === 'marca' ? (data.marcas || []) : (data.productos || []);
    const total = lista.reduce(function(s, x){ return s + Number(x.ventas); }, 0);
    if(!lista.length || total <= 0){ box.appendChild(el('p', 'v-vacio', 'Todavía no hay ventas en este periodo.')); return; }
    const top = lista.slice(0, 10);
    const resto = lista.slice(10);
    if(resto.length){
      top.push({ producto: 'Otros (' + resto.length + ')', marca: 'Otros (' + resto.length + ')', unidades: resto.reduce(function(s, x){ return s + Number(x.unidades); }, 0), ventas: resto.reduce(function(s, x){ return s + Number(x.ventas); }, 0) });
    }
    top.forEach(function(x){
      const pct = Number(x.ventas) / total * 100;
      const row = el('div', 'v-row');
      row.appendChild(el('b', null, grupo === 'marca' ? (x.marca.indexOf('Otros') === 0 ? x.marca : marcaNombre(x.marca)) : x.producto));
      row.appendChild(el('span', null, usd(x.ventas)));
      row.appendChild(el('small', null, entero(x.unidades) + (Number(x.unidades) === 1 ? ' unidad' : ' unidades') + ' · ' + (Math.round(pct * 10) / 10).toString().replace('.', ',') + '% de las ventas'));
      const m = el('div', 'v-meter'); const i = el('i'); i.style.width = Math.max(1, pct) + '%'; m.appendChild(i); row.appendChild(m);
      box.appendChild(row);
    });
  }

  /* ---------- Controles ---------- */
  function mostrar(v){
    visible = v;
    sec.hidden = !v;
    const board = document.querySelector('.board');
    if(board) board.hidden = v;
    btn.textContent = v ? 'Volver a Pedidos' : 'Dashboard de Ventas';
    btn.setAttribute('aria-pressed', String(v));
    clearInterval(timer);
    if(v){
      cargar();
      timer = setInterval(function(){ if(!document.hidden && periodo === 'mes') cargar(); }, REFRESH_MS);
      window.scrollTo(0, 0);
    }
  }
  btn.addEventListener('click', function(){ mostrar(!visible); });

  sec.querySelectorAll('[data-periodo]').forEach(function(b){
    b.addEventListener('click', function(){
      periodo = b.dataset.periodo;
      sec.querySelectorAll('[data-periodo]').forEach(function(x){ const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
      $('ventas-fechas').hidden = periodo !== 'fechas';
      if(periodo === 'fechas'){
        if(!$('v-hasta').value) $('v-hasta').value = hoyCaracas();
        if(!$('v-desde').value) $('v-desde').value = sumarDias(hoyCaracas(), -6);
      }
      cargar();
    });
  });
  $('ventas-fechas').addEventListener('submit', function(e){ e.preventDefault(); cargar(); });
  sec.querySelectorAll('[data-metrica]').forEach(function(b){
    b.addEventListener('click', function(){
      metrica = b.dataset.metrica;
      sec.querySelectorAll('[data-metrica]').forEach(function(x){ const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
      if(data) pintarGrafica();
    });
  });
  sec.querySelectorAll('[data-grupo]').forEach(function(b){
    b.addEventListener('click', function(){
      grupo = b.dataset.grupo;
      sec.querySelectorAll('[data-grupo]').forEach(function(x){ const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
      if(data) pintarDistribucion();
    });
  });

  /* ---------- Demostración (solo localhost con ?demo=1) ---------- */
  function demoData(r){
    return new Promise(function(resolve){
      setTimeout(function(){
        const desde = r.desde || '2026-06-01';
        const dias = []; let ventas = 0, pedidos = 0;
        for(let d = desde, i = 0; d <= r.hasta && i < 400; d = sumarDias(d, 1), i++){
          const n = (i * 7 + d.charCodeAt(9)) % 5; const crecimiento = 1 + (partes(d).m - 6) * 0.16; const v = n === 0 ? 0 : (n * 14.5 + (i % 3) * 6) * crecimiento;
          dias.push({ dia: d, ventas: v, pedidos: n === 0 ? 0 : Math.ceil(n / 2), unidades: n === 0 ? 0 : Math.ceil(n / 2) * 3 + (i % 2) }); ventas += v; pedidos += n === 0 ? 0 : Math.ceil(n / 2);
        }
        const prods = [['Hidratante Uva Going', 'Going Nutrición', 0.22], ['Gel Energético Café Going', 'Going Nutrición', 0.14], ['Proteína en Polvo Chocolate — 600 g Going', 'Going Nutrición', 0.18], ['Sport Hydration Drink Mix Fresa Limonada — Bolsa 440 g Skratch Labs', 'Skratch Labs', 0.16], ['FastChews Naranja SaltStick', 'SaltStick', 0.1], ['Barra de Proteína Cookie Dough Probar', 'Probar', 0.12], ['Gel Orgánico Gold Honey Stinger', 'Honey Stinger', 0.08]];
        const productos = prods.map(function(p){ return { producto: p[0], marca: p[1], unidades: Math.round(ventas * p[2] / 4), ventas: Math.round(ventas * p[2] * 100) / 100 }; });
        const marcas = {}; productos.forEach(function(p){ marcas[p.marca] = marcas[p.marca] || { marca: p.marca, unidades: 0, ventas: 0 }; marcas[p.marca].unidades += p.unidades; marcas[p.marca].ventas += p.ventas; });
        resolve({ ok: true, actual: { desde: desde, hasta: r.hasta, pedidos: pedidos, ventas: Math.round(ventas * 100) / 100 }, comparacion: r.cdesde ? { desde: r.cdesde, hasta: r.chasta, pedidos: Math.round(pedidos * 0.85), ventas: Math.round(ventas * 0.85 * 100) / 100 } : null, dias: dias, productos: productos, marcas: Object.keys(marcas).map(function(k){ return marcas[k]; }) });
      }, 250);
    });
  }
})();
