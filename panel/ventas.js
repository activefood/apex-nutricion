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

  // Las filas de la distribución (las 10 primeras y "Otros"): las usan la pantalla y la imagen para compartir. null si no hay ventas.
  function filasDistribucion(){
    const lista = grupo === 'marca' ? (data.marcas || []) : (data.productos || []);
    const total = lista.reduce(function(s, x){ return s + Number(x.ventas); }, 0);
    if(!lista.length || total <= 0) return null;
    const top = lista.slice(0, 10);
    const resto = lista.slice(10);
    if(resto.length){
      top.push({ producto: 'Otros (' + resto.length + ')', marca: 'Otros (' + resto.length + ')', unidades: resto.reduce(function(s, x){ return s + Number(x.unidades); }, 0), ventas: resto.reduce(function(s, x){ return s + Number(x.ventas); }, 0) });
    }
    return { top: top, total: total };
  }
  function nombreFila(x){ return grupo === 'marca' ? (x.marca.indexOf('Otros') === 0 ? x.marca : marcaNombre(x.marca)) : x.producto; }
  function detalleFila(x, total){ return entero(x.unidades) + (Number(x.unidades) === 1 ? ' unidad' : ' unidades') + ' · ' + (Math.round(Number(x.ventas) / total * 1000) / 10).toString().replace('.', ',') + '% de las ventas'; }

  function pintarDistribucion(){
    const box = $('v-dist'); box.textContent = '';
    const f = filasDistribucion();
    if(!f){ box.appendChild(el('p', 'v-vacio', 'Todavía no hay ventas en este periodo.')); return; }
    const top = f.top, total = f.total;
    top.forEach(function(x){
      const pct = Number(x.ventas) / total * 100;
      const row = el('div', 'v-row');
      row.appendChild(el('b', null, nombreFila(x)));
      row.appendChild(el('span', null, usd(x.ventas)));
      row.appendChild(el('small', null, detalleFila(x, total)));
      const m = el('div', 'v-meter'); const i = el('i'); i.style.width = Math.max(1, pct) + '%'; m.appendChild(i); row.appendChild(m);
      box.appendChild(row);
    });
  }

  /* ---------- Compartir gráficas ----------
     El botón "Compartir" de cada gráfica pregunta primero ("Vas a compartir la gráfica de … ¿Estás seguro?", Sí / No). Con el Sí, la gráfica se vuelve una imagen PNG
     (título, periodo, la gráfica y la marca de Apex) y se abre el menú de compartir del teléfono; si el navegador no puede compartir archivos, se descarga la imagen.
     La imagen se prepara mientras la persona lee la pregunta, para que compartir ocurra justo después de tocar "Sí" (Safari lo exige). Solo lleva cifras de ventas. */
  function fechaCorta(s){ const p = partes(s); return String(p.d).padStart(2, '0') + '/' + String(p.m).padStart(2, '0') + '/' + p.y; }
  function periodoTexto(){ const a = data && data.actual; return a && a.desde && a.hasta ? 'del ' + fechaCorta(a.desde) + ' al ' + fechaCorta(a.hasta) : ''; }
  function nombreGrafica(tipo){ return tipo === 'dist' ? 'Distribución de productos ' + (grupo === 'marca' ? 'por marca' : 'por producto') : $('v-titulo').textContent; }
  function avisar(msg, error){
    const t = $('toast'); if(!t) return;
    t.textContent = msg; t.classList.toggle('is-error', !!error); t.hidden = false;
    clearTimeout(avisar.t); avisar.t = setTimeout(function(){ t.hidden = true; }, 4200);
  }

  // Copia los estilos que dan el aspecto (colores, líneas, letra) a cada elemento de la gráfica: una imagen SVG no ve el CSS de la página.
  const PROPS_ESTILO = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'paint-order', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'opacity'];
  function inlinarEstilos(origen, copia){
    const cs = getComputedStyle(origen);
    PROPS_ESTILO.forEach(function(p){ const v = cs.getPropertyValue(p); if(v) copia.style.setProperty(p, v); });
    for(let i = 0; i < origen.children.length && i < copia.children.length; i++) inlinarEstilos(origen.children[i], copia.children[i]);
  }
  function texto(x, y, t, attrs){ const n = svg('text', Object.assign({ x: x, y: y }, attrs || {})); n.textContent = t; return n; }
  function partirLineas(t, max){
    const out = []; let linea = '';
    String(t).split(/\s+/).forEach(function(w){ if((linea + ' ' + w).trim().length > max){ out.push(linea); linea = w; } else linea = (linea + ' ' + w).trim(); });
    if(linea) out.push(linea);
    return out;
  }
  function recortar(t, max){ t = String(t); return t.length > max ? t.slice(0, max - 1) + '…' : t; }

  // Tarjeta completa: barra de tinta, título, periodo, contenido (nodo SVG de ancho W y alto H), nota opcional y pie con la marca.
  function armarTarjeta(titulo, periodo, W, H, contenido, nota){
    const M = 24, OW = W + M * 2;
    const lineasTitulo = partirLineas(titulo, 46).slice(0, 2);
    const extra = lineasTitulo.length > 1 ? 24 : 0;   // un segundo renglón de título empuja todo hacia abajo
    const lineasNota = nota ? partirLineas(nota, 100) : [];
    const yContenido = 100 + extra, yNota = yContenido + H + 24;
    const OH = yNota + (lineasNota.length ? lineasNota.length * 19 + 6 : 0) + 56;
    const s = svg('svg', { xmlns: svgNs, width: OW, height: OH, viewBox: '0 0 ' + OW + ' ' + OH });
    s.appendChild(svg('rect', { x: 0, y: 0, width: OW, height: OH, fill: '#FFFFFF' }));
    s.appendChild(svg('rect', { x: 0, y: 0, width: OW, height: 10, fill: '#14120F' }));
    s.appendChild(svg('rect', { x: 0, y: 10, width: OW, height: 5, fill: '#D8F24C' }));
    lineasTitulo.forEach(function(l, i){ s.appendChild(texto(M, 52 + i * 28, l, { 'font-family': 'Arial, Helvetica, sans-serif', 'font-size': 25, 'font-weight': 800, fill: '#14120F' })); });
    if(periodo) s.appendChild(texto(M, 80 + extra, periodo, { 'font-family': 'Courier New, monospace', 'font-size': 15, 'font-weight': 700, fill: '#726E67' }));
    const g = svg('g', { transform: 'translate(' + M + ',' + yContenido + ')' });
    g.appendChild(contenido);
    s.appendChild(g);
    lineasNota.forEach(function(l, i){ s.appendChild(texto(M, yNota + 12 + i * 19, l, { 'font-family': 'Arial, Helvetica, sans-serif', 'font-size': 14, fill: '#514D48' })); });
    s.appendChild(svg('line', { x1: M, x2: OW - M, y1: OH - 40, y2: OH - 40, stroke: '#E4DFD5', 'stroke-width': 1 }));
    s.appendChild(texto(M, OH - 16, 'Apex Nutrición · apexnutricionve.com', { 'font-family': 'Arial, Helvetica, sans-serif', 'font-size': 14, 'font-weight': 700, fill: '#14120F' }));
    s.appendChild(texto(OW - M, OH - 16, 'Generado el ' + fechaCorta(hoyCaracas()), { 'font-family': 'Courier New, monospace', 'font-size': 13, fill: '#726E67', 'text-anchor': 'end' }));
    return { nodo: s, ancho: OW, alto: OH };
  }

  function tarjetaGrafica(nombre, periodo){
    const orig = $('v-chart').querySelector('svg');
    if(!orig) return null;
    const vb = orig.viewBox.baseVal;
    const clon = orig.cloneNode(true);
    inlinarEstilos(orig, clon);
    clon.querySelectorAll('title').forEach(function(t){ t.remove(); });
    clon.removeAttribute('role'); clon.removeAttribute('aria-label');
    clon.setAttribute('width', vb.width); clon.setAttribute('height', vb.height);
    const ley = $('v-leyenda');
    return armarTarjeta(nombre, periodo, vb.width, vb.height, clon, ley.hidden ? '' : ley.textContent.trim());
  }
  function tarjetaDistribucion(nombre, periodo){
    const f = filasDistribucion(); if(!f) return null;
    const W = 720, FILA = 58;
    const g = svg('g');
    f.top.forEach(function(x, i){
      const y = i * FILA, pct = Number(x.ventas) / f.total * 100;
      g.appendChild(texto(0, y + 18, recortar(nombreFila(x), 52), { 'font-family': 'Arial, Helvetica, sans-serif', 'font-size': 16, 'font-weight': 700, fill: '#14120F' }));
      g.appendChild(texto(W, y + 18, usd(x.ventas), { 'font-family': 'Courier New, monospace', 'font-size': 16, 'font-weight': 700, fill: '#14120F', 'text-anchor': 'end' }));
      g.appendChild(texto(0, y + 36, detalleFila(x, f.total), { 'font-family': 'Arial, Helvetica, sans-serif', 'font-size': 13, fill: '#726E67' }));
      g.appendChild(svg('rect', { x: 0, y: y + 42, width: W, height: 8, fill: '#EFEBE3' }));
      g.appendChild(svg('rect', { x: 0, y: y + 42, width: Math.max(2, W * pct / 100), height: 8, fill: '#14120F' }));
    });
    return armarTarjeta(nombre, periodo, W, f.top.length * FILA, g, '');
  }

  // SVG -> imagen PNG (el doble de tamaño para que se lea nítida en el teléfono)
  function aPng(t){
    const xml = new XMLSerializer().serializeToString(t.nodo);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    return new Promise(function(resolve, reject){
      const img = new Image();
      img.onload = function(){
        const k = 2, c = document.createElement('canvas'); c.width = t.ancho * k; c.height = t.alto * k;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function(b){ b ? resolve(b) : reject(new Error('png')); }, 'image/png');
      };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('imagen')); };
      img.src = url;
    });
  }
  function construirImagen(tipo, nombre, periodo){
    const t = tipo === 'dist' ? tarjetaDistribucion(nombre, periodo) : tarjetaGrafica(nombre, periodo);
    return t ? aPng(t) : Promise.reject(new Error('vacía'));
  }
  function nombreArchivo(nombre, periodo){
    const a = data && data.actual;
    return ('apex-' + nombre + (a ? '-' + a.desde + '-' + a.hasta : '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
  }
  async function enviarImagen(blob, nombre, periodo){
    const archivo = new File([blob], nombreArchivo(nombre, periodo), { type: 'image/png' });
    if(navigator.canShare && navigator.canShare({ files: [archivo] })){
      try { await navigator.share({ files: [archivo], title: nombre, text: nombre + (periodo ? ' ' + periodo : '') }); return 'compartida'; }
      catch(e){ if(e && e.name === 'AbortError') return 'cancelada'; }   // si falla por otra razón, se descarga
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = archivo.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
    return 'descargada';
  }

  function preguntarCompartir(tipo, disparador){
    if(!data || document.getElementById('compartir-dialog')) return;
    const nombre = nombreGrafica(tipo), periodo = periodoTexto();
    const listo = construirImagen(tipo, nombre, periodo).catch(function(){ return null; });   // se prepara mientras lee la pregunta
    const pregunta = 'Vas a compartir la gráfica de ' + nombre + (periodo ? ' (' + periodo + ')' : '') + '. ¿Estás seguro?';
    const overlay = el('div', 'dialog-overlay'); overlay.id = 'compartir-dialog';
    const box = el('div', 'dialog'); box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'compartir-titulo'); box.setAttribute('aria-describedby', 'compartir-texto');
    const titulo = el('h2', 'dialog-title', 'Compartir gráfica'); titulo.id = 'compartir-titulo';
    const parrafo = el('p', 'dialog-text', pregunta); parrafo.id = 'compartir-texto';
    const acts = el('div', 'dialog-actions');
    function cerrar(){ overlay.remove(); document.removeEventListener('keydown', onKey); if(disparador && document.body.contains(disparador)) disparador.focus(); }
    function onKey(e){ if(e.key === 'Escape') cerrar(); }
    const no = el('button', 'btn', 'No'); no.type = 'button'; no.addEventListener('click', cerrar);
    const si = el('button', 'btn btn--primary', 'Sí'); si.type = 'button';
    si.addEventListener('click', async function(){
      cerrar();
      const blob = await listo;
      if(!blob){ avisar('Esta gráfica no se pudo convertir en imagen. Intenta otra vez.', true); return; }
      const r = await enviarImagen(blob, nombre, periodo);
      if(r === 'descargada') avisar('Listo: se descargó la imagen de la gráfica. Compártela desde tus descargas.');
      else if(r === 'compartida') avisar('Gráfica compartida.');
    });
    acts.appendChild(no); acts.appendChild(si);
    box.appendChild(titulo); box.appendChild(parrafo); box.appendChild(acts);
    overlay.appendChild(box);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) cerrar(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    no.focus();   // por defecto el foco queda en "No": un toque suelto no comparte nada
  }
  sec.querySelectorAll('[data-compartir]').forEach(function(b){
    b.addEventListener('click', function(){
      const tipo = b.dataset.compartir;
      const hay = tipo === 'dist' ? !!(data && filasDistribucion()) : !!$('v-chart').querySelector('svg');
      if(!hay){ avisar('Todavía no hay una gráfica para compartir en este periodo.', true); return; }
      preguntarCompartir(tipo, b);
    });
  });

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
