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

  let periodo = 'mes', grupo = 'producto', data = null, timer = null, visible = false, cargando = false;

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

  function pintarGrafica(){
    const box = $('v-chart'); box.textContent = '';
    let pts = (data.dias || []).map(function(d){ return { clave: d.dia, ventas: Number(d.ventas) || 0, pedidos: d.pedidos }; });
    const porMes = pts.length > 62;
    $('v-unidad').textContent = porMes ? 'mes' : 'día';
    if(porMes){
      const m = {};
      pts.forEach(function(p){ const k = p.clave.slice(0, 7); m[k] = m[k] || { clave: k, ventas: 0, pedidos: 0 }; m[k].ventas += p.ventas; m[k].pedidos += p.pedidos; });
      pts = Object.keys(m).sort().map(function(k){ return m[k]; });
    }
    const total = pts.reduce(function(s, p){ return s + p.ventas; }, 0);
    if(!pts.length || total <= 0){ box.appendChild(el('p', 'v-vacio', 'Todavía no hay ventas en este periodo.')); return; }
    const W = 720, H = 280, L = 62, R = 8, T = 14, B = 38;
    const max = Math.max.apply(null, pts.map(function(p){ return p.ventas; }));
    const paso = (function(){ const g = Math.pow(10, Math.floor(Math.log10(max))); const f = max / g; return (f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * g; })();
    const tope = Math.ceil(max / paso) * paso;
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Gráfica de ventas por ' + (porMes ? 'mes' : 'día') + ': total ' + usd(total) });
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
      const r = svg('rect', { x: x, y: H - B - h, width: bw, height: Math.max(p.ventas > 0 ? 2 : 0, h), class: 'bar' + (!porMes && p.clave === hoy ? ' bar--hoy' : '') });
      const t = svg('title'); t.textContent = (porMes ? etiquetaMes(p.clave) : etiquetaDia(p.clave)) + ': ' + usd(p.ventas) + ' · ' + p.pedidos + (p.pedidos === 1 ? ' pedido' : ' pedidos'); r.appendChild(t);
      s.appendChild(r);
      if(i % cada === 0){
        const tx = svg('text', { x: x + bw / 2, y: H - 12, 'text-anchor': 'middle' });
        tx.textContent = porMes ? etiquetaMes(p.clave) : etiquetaDia(p.clave); s.appendChild(tx);
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
          const n = (i * 7 + d.charCodeAt(9)) % 5; const v = n === 0 ? 0 : n * 14.5 + (i % 3) * 6;
          dias.push({ dia: d, ventas: v, pedidos: n === 0 ? 0 : Math.ceil(n / 2) }); ventas += v; pedidos += n === 0 ? 0 : Math.ceil(n / 2);
        }
        const prods = [['Hidratante Uva Going', 'Going Nutrición', 0.22], ['Gel Energético Café Going', 'Going Nutrición', 0.14], ['Proteína en Polvo Chocolate — 600 g Going', 'Going Nutrición', 0.18], ['Sport Hydration Drink Mix Fresa Limonada — Bolsa 440 g Skratch Labs', 'Skratch Labs', 0.16], ['FastChews Naranja SaltStick', 'SaltStick', 0.1], ['Barra de Proteína Cookie Dough Probar', 'Probar', 0.12], ['Gel Orgánico Gold Honey Stinger', 'Honey Stinger', 0.08]];
        const productos = prods.map(function(p){ return { producto: p[0], marca: p[1], unidades: Math.round(ventas * p[2] / 4), ventas: Math.round(ventas * p[2] * 100) / 100 }; });
        const marcas = {}; productos.forEach(function(p){ marcas[p.marca] = marcas[p.marca] || { marca: p.marca, unidades: 0, ventas: 0 }; marcas[p.marca].unidades += p.unidades; marcas[p.marca].ventas += p.ventas; });
        resolve({ ok: true, actual: { desde: desde, hasta: r.hasta, pedidos: pedidos, ventas: Math.round(ventas * 100) / 100 }, comparacion: r.cdesde ? { desde: r.cdesde, hasta: r.chasta, pedidos: Math.round(pedidos * 0.85), ventas: Math.round(ventas * 0.85 * 100) / 100 } : null, dias: dias, productos: productos, marcas: Object.keys(marcas).map(function(k){ return marcas[k]; }) });
      }, 250);
    });
  }
})();
