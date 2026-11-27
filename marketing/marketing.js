/* Panel de marketing (marketing.html): visitas, orígenes, dispositivos, páginas y recorrido hacia la compra (Google Analytics vía Windsor,
   guardado en Supabase por el Worker). Habla solo con /api/marketing/*, que exige su propio código. No hay ventas ni dinero aquí.
   Sin librerías: las gráficas son SVG dibujado en esta página. Modo demostración (?demo=1, solo en localhost): datos de mentira. */
(function(){
  'use strict';
  const $ = function(id){ return document.getElementById(id); };
  const DEMO = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && new URLSearchParams(location.search).has('demo');
  const REFRESH_MS = 5 * 60 * 1000;
  let periodo = '7', data = null, timer = null, cargando = false;

  /* ---------- Fechas (hora de Caracas) ---------- */
  function hoyCaracas(){ return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }); }
  function partes(s){ const p = s.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function iso(y, m, d){ return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function ultimoDia(y, m){ return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function sumarDias(s, n){ const p = partes(s); const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function diasEntre(a, b){ const pa = partes(a), pb = partes(b); return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000); }
  function mesAnterior(y, m){ return m === 1 ? { y: y - 1, m: 12 } : { y: y, m: m - 1 }; }

  function rangos(){
    const hoy = hoyCaracas(), t = partes(hoy);
    if(periodo === '7') return { desde: sumarDias(hoy, -6), hasta: hoy, cdesde: sumarDias(hoy, -13), chasta: sumarDias(hoy, -7), etiqueta: 'vs 7 días antes', nombre: 'los últimos 7 días' };
    if(periodo === '30') return { desde: sumarDias(hoy, -29), hasta: hoy, cdesde: sumarDias(hoy, -59), chasta: sumarDias(hoy, -30), etiqueta: 'vs 30 días antes', nombre: 'los últimos 30 días' };
    if(periodo === 'mes'){
      const a = mesAnterior(t.y, t.m);
      return { desde: iso(t.y, t.m, 1), hasta: hoy, cdesde: iso(a.y, a.m, 1), chasta: iso(a.y, a.m, Math.min(t.d, ultimoDia(a.y, a.m))), etiqueta: 'vs mes anterior', nombre: 'este mes' };
    }
    if(periodo === 'anterior'){
      const a = mesAnterior(t.y, t.m), b = mesAnterior(a.y, a.m);
      return { desde: iso(a.y, a.m, 1), hasta: iso(a.y, a.m, ultimoDia(a.y, a.m)), cdesde: iso(b.y, b.m, 1), chasta: iso(b.y, b.m, ultimoDia(b.y, b.m)), etiqueta: 'vs mes previo', nombre: 'el mes anterior' };
    }
    const d = $('mk-desde').value, h = $('mk-hasta').value;
    if(!d || !h || h < d) return null;
    const largo = diasEntre(d, h) + 1;
    return { desde: d, hasta: h, cdesde: sumarDias(d, -largo), chasta: sumarDias(d, -1), etiqueta: 'vs periodo anterior', nombre: 'el periodo elegido' };
  }

  /* ---------- Formato ---------- */
  const entero = function(n){ return Math.round(Number(n) || 0).toLocaleString('es-VE'); };
  const decimal = function(n){ return (Math.round(Number(n) * 10) / 10).toString().replace('.', ','); };
  const pct = function(a, b){ return b > 0 ? Math.round(a / b * 1000) / 10 : 0; };
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const etiquetaDia = function(s){ const p = partes(s); return p.d + ' ' + MESES[p.m - 1]; };
  function duracion(seg){
    seg = Math.round(Number(seg) || 0);
    if(seg < 60) return seg + ' s';
    return Math.floor(seg / 60) + ' min ' + String(seg % 60).padStart(2, '0') + ' s';
  }
  function el(tag, cls, text){ const n = document.createElement(tag); if(cls) n.className = cls; if(text != null) n.textContent = text; return n; }
  const svgNs = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs){ const n = document.createElementNS(svgNs, tag); Object.keys(attrs || {}).forEach(function(k){ n.setAttribute(k, attrs[k]); }); return n; }

  /* Nombres entendibles */
  function nombreFuente(f, m){
    const s = String(f || '').toLowerCase(), med = String(m || '').toLowerCase();
    if(s === '(direct)' || (s === '(not set)' && med === '(none)')) return 'Directo (sin referencia)';
    if(/instagram|^ig$|l\.instagram/.test(s)) return 'Instagram';
    if(/facebook|^fb$|l\.facebook|m\.facebook/.test(s)) return 'Facebook';
    if(s === 'google' && med === 'organic') return 'Google (búsqueda normal)';
    if(s === 'google' && /cpc|paid/.test(med)) return 'Google (anuncios)';
    if(/whatsapp/.test(s)) return 'WhatsApp';
    if(/t\.co|twitter|^x$/.test(s)) return 'X (Twitter)';
    if(/tiktok/.test(s)) return 'TikTok';
    return f + (med && med !== '(none)' ? ' / ' + m : '');
  }
  const NOMBRE_DISP = { mobile: 'Celular', desktop: 'Computadora', tablet: 'Tablet', 'smart tv': 'Televisor' };
  function nombrePagina(ruta){
    const fijas = { '/': 'Inicio', '/index.html': 'Inicio', '/carrito.html': 'Carrito', '/ofertas.html': 'Ofertas', '/categoria.html': 'Categorías', '/marcas.html': 'Todas las marcas', '/marca.html': 'Marca', '/producto.html': 'Producto', '/calculadora.html': 'Calculadora', '/busqueda.html': 'Búsqueda', '/guias.html': 'Guías', '/articulo.html': 'Artículo' };
    if(fijas[ruta]) return fijas[ruta];
    let r = String(ruta || '').replace(/^\//, '').replace(/\.html$/, '');
    let pre = '';
    if(r.indexOf('producto-') === 0){ pre = 'Producto: '; r = r.slice(9); }
    else if(r.indexOf('marca-') === 0){ pre = 'Marca: '; r = r.slice(6); }
    else if(r.indexOf('articulo-') === 0){ pre = 'Artículo: '; r = r.slice(9); }
    r = r.replace(/-/g, ' ');
    return pre + r.charAt(0).toUpperCase() + r.slice(1);
  }

  /* ---------- Red ---------- */
  async function api(ruta, opciones){
    const res = await fetch('/api/marketing/' + ruta, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opciones || {}));
    let j = null;
    try { j = await res.json(); } catch(e){}
    if(res.status === 401){ throw { auth: true }; }
    if(res.status === 429) throw { message: 'Demasiados intentos. Espera un minuto y vuelve a probar.' };
    if(res.status === 503) throw { message: 'El panel todavía no está configurado.' };
    if(!res.ok || !j || j.ok === false) throw { message: (j && j.error) || 'Algo salió mal. Intenta otra vez.' };
    return j;
  }
  function pedir(r){
    if(DEMO) return demoData(r);
    const q = new URLSearchParams({ desde: r.desde, hasta: r.hasta, cdesde: r.cdesde, chasta: r.chasta });
    return api('datos?' + q.toString());
  }

  /* ---------- Entrada ---------- */
  function mostrarLogin(msg){
    $('app').hidden = true; $('login').hidden = false;
    clearInterval(timer);
    const e = $('login-error'); e.hidden = !msg; e.textContent = msg || '';
    $('login-code').focus();
  }
  function mostrarApp(){ $('login').hidden = true; $('app').hidden = false; cargar(); clearInterval(timer); timer = setInterval(function(){ if(!document.hidden) cargar(true); }, REFRESH_MS); }
  $('login-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const b = $('login-btn'); b.disabled = true;
    try {
      if(!DEMO) await api('login', { method: 'POST', body: JSON.stringify({ code: $('login-code').value }) });
      $('login-code').value = '';
      mostrarApp();
    } catch(err){
      mostrarLogin(err.auth ? 'Código incorrecto.' : (err.message || 'No se pudo entrar. Intenta otra vez.'));
    }
    b.disabled = false;
  });

  /* ---------- Cargar ---------- */
  function toast(msg, malo){
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (malo ? ' is-error' : ''); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function(){ t.hidden = true; }, 6000);
  }
  async function cargar(silencioso){
    if(cargando) return;
    const r = rangos(), err = $('mk-error');
    if(!r){ err.hidden = false; err.textContent = 'Elige las dos fechas (la final no puede ser antes de la inicial).'; return; }
    cargando = true;
    try {
      data = await pedir(r);
      data._r = r;
      err.hidden = true;
      pintar();
      cargarIg(r);
      cargarNews(r);
      cargarRepo();
      setLive(true, 'Al día');
    } catch(e){
      if(e.auth){ mostrarLogin(silencioso ? 'La sesión se cerró. Entra otra vez.' : ''); }
      else { err.hidden = false; err.textContent = e.message || 'No se pudieron leer los datos.'; setLive(false, 'Sin conexión'); }
    }
    cargando = false;
  }
  /* ---------- Instagram (sección aparte: si falla, el resto del portal sigue igual) ---------- */
  let dataIg = null;
  function pedirIg(r){
    if(DEMO) return demoIg(r);
    return api('instagram?' + new URLSearchParams({ desde: r.desde, hasta: r.hasta, cdesde: r.cdesde, chasta: r.chasta }).toString());
  }
  async function cargarIg(r){
    const err = $('ig-error');
    try {
      dataIg = await pedirIg(r);
      dataIg._r = r; err.hidden = true;
      pintarIg();
    } catch(e){
      if(e.auth) return;
      err.hidden = false; err.textContent = e.message || 'No se pudieron leer los datos de Instagram.';
    }
  }
  const NOMBRE_TIPO = { video: 'Videos y reels', imagen: 'Fotos', carrusel: 'Carruseles' };
  function pintarIg(){
    const a = dataIg.actual || {}, c = dataIg.comparacion, r = dataIg._r;
    const hayComp = c && c.publicaciones > 0;
    $('ig-live').textContent = '@' + dataIg.usuario + ' · actualizado ' + haceCuanto(dataIg.actualizado);
    const aviso = $('ig-aviso'); aviso.textContent = '';
    const ul = dataIg.ultima_sync;
    clearTimeout(pintarIg.espera);
    function boton(txt, fn){ const x = el('button', 'linkbtn', txt); x.type = 'button'; x.addEventListener('click', fn); return x; }
    aviso.hidden = false;
    if(ul && ul.estado === 'pendiente'){
      aviso.appendChild(document.createTextNode('Trayendo el historial de Instagram (hasta 100 publicaciones). Tarda unos minutos; esta pantalla se actualiza sola. '));
      aviso.appendChild(boton('Revisar ahora', function(){ cargarIg(dataIg._r); }));
      pintarIg.espera = setTimeout(function(){ if(dataIg) cargarIg(dataIg._r); }, 30000);
    } else if(!dataIg.actualizado){
      aviso.appendChild(document.createTextNode('Todavía no hay datos de Instagram. '));
      aviso.appendChild(boton('Traer Instagram ahora', function(){ actualizarIg(0); }));
      if(ul && ul.estado === 'error') aviso.appendChild(document.createTextNode(' Último intento: ' + ul.detalle));
    } else {
      if(ul && ul.estado === 'error') aviso.appendChild(document.createTextNode('La última actualización de Instagram falló (' + ul.detalle + '). Los números pueden estar atrasados. '));
      else aviso.appendChild(document.createTextNode('Se actualiza solo cada día. '));
      aviso.appendChild(boton('Actualizar Instagram ahora', function(){ actualizarIg(0); }));
      aviso.appendChild(document.createTextNode(' · '));
      aviso.appendChild(boton('Traer historial (100 publicaciones, una sola vez)', function(){ actualizarIg(100); }));
    }
    const n = a.publicaciones || 0, conMg = a.con_me_gusta || 0;
    const mgProm = conMg ? a.me_gusta / conMg : 0, cmProm = n ? a.comentarios / n : 0;
    const pMg = hayComp && c.con_me_gusta ? c.me_gusta / c.con_me_gusta : (hayComp ? 0 : null), pCm = hayComp ? c.comentarios / c.publicaciones : null;
    const inter = a.seguidores && n ? (mgProm + cmProm) / a.seguidores * 100 : 0;
    const k = $('ig-kpis'); k.textContent = '';
    const seg = a.seguidores != null ? entero(a.seguidores) : '—';
    const crec = (a.seguidores != null && a.seguidores_inicio != null) ? a.seguidores - a.seguidores_inicio : null;
    const dSeg = crec === null ? null : (function(){ const b = el('span', 'delta ' + (crec > 0 ? 'delta--up' : crec < 0 ? 'delta--down' : '')); b.textContent = (crec > 0 ? '▲ +' : crec < 0 ? '▼ ' : '= ') + entero(crec) + ' en el periodo'; return b; })();
    k.appendChild(kpi('Seguidores', seg, dSeg, 'Cuántas personas siguen la cuenta hoy.'));
    k.appendChild(kpi('Publicaciones', entero(n), hayComp ? delta(n, c.publicaciones, r.etiqueta) : null));
    k.appendChild(kpi('Me gusta por publicación', decimal(mgProm), pMg === null ? null : delta(mgProm, pMg, r.etiqueta), 'Promedio. No cuenta las publicaciones que ocultan los me gusta.'));
    k.appendChild(kpi('Comentarios por publicación', decimal(cmProm), pCm === null ? null : delta(cmProm, pCm, r.etiqueta)));
    k.appendChild(kpi('Interacción por publicación', decimal(inter) + '%', null, 'Me gusta + comentarios de una publicación promedio, entre los seguidores.'));
    k.appendChild(kpi('Vistas de videos', entero(a.vistas || 0), hayComp ? delta(a.vistas || 0, c.vistas || 0, r.etiqueta) : null));

    const tp = $('ig-tipos'); tp.textContent = '';
    const tipos = dataIg.tipos || [];
    if(!tipos.length) tp.appendChild(el('p', 'v-vacio', 'Sin publicaciones en este periodo.'));
    else {
      const maxI = Math.max.apply(null, tipos.map(function(t){ return (Number(t.me_gusta_prom) || 0) + (Number(t.comentarios_prom) || 0); })) || 1;
      tipos.slice().sort(function(x, y){ return ((+y.me_gusta_prom || 0) + (+y.comentarios_prom || 0)) - ((+x.me_gusta_prom || 0) + (+x.comentarios_prom || 0)); }).forEach(function(t){
        const inter = (Number(t.me_gusta_prom) || 0) + (Number(t.comentarios_prom) || 0);
        const row = el('div', 'v-row');
        row.appendChild(el('b', null, NOMBRE_TIPO[t.tipo] || t.tipo));
        row.appendChild(el('span', null, decimal(inter)));
        row.appendChild(el('small', null, entero(t.publicaciones) + (t.publicaciones === 1 ? ' publicación' : ' publicaciones') + ' · ' + decimal(t.me_gusta_prom || 0) + ' me gusta y ' + decimal(t.comentarios_prom || 0) + ' comentarios en promedio'));
        const m = el('div', 'v-meter'); const f = el('i'); f.style.width = Math.max(2, inter / maxI * 100) + '%'; m.appendChild(f); row.appendChild(m);
        tp.appendChild(row);
      });
    }
    const tt = $('ig-top'); tt.textContent = '';
    const top = dataIg.top || [];
    if(!top.length) tt.appendChild(el('p', 'v-vacio', 'Sin publicaciones en este periodo.'));
    else top.forEach(function(p){
      const it = el('div', 'mk-top-item');
      it.appendChild(el('b', null, (p.texto || '(sin texto)').replace(/\s+/g, ' ')));
      const meta = el('small', null, etiquetaDia(p.dia) + ' · ' + (NOMBRE_TIPO[p.tipo] || p.tipo) + ' · ' + (p.me_gusta == null ? 'me gusta ocultos' : entero(p.me_gusta) + ' me gusta') + ' · ' + entero(p.comentarios) + ' comentarios' + (p.vistas ? ' · ' + entero(p.vistas) + ' vistas' : ''));
      it.appendChild(meta);
      if(p.url && /^https:\/\/(www\.)?instagram\.com\//.test(p.url)){ const a2 = el('a', null, 'Ver en Instagram'); a2.href = p.url; a2.target = '_blank'; a2.rel = 'noopener noreferrer'; it.appendChild(a2); }
      tt.appendChild(it);
    });
  }
  async function actualizarIg(limite){
    toast(limite ? 'Iniciando la carga del historial…' : 'Trayendo Instagram… puede tardar hasta 2 minutos.');
    try {
      if(DEMO) await new Promise(function(ok){ setTimeout(ok, 600); });
      else await api('instagram-actualizar', { method: 'POST', body: JSON.stringify(limite ? { limite: limite } : {}) });
      toast(limite ? 'Listo, se inició. Tarda unos minutos y esta pantalla se actualiza sola.' : 'Listo, Instagram actualizado.');
      if(dataIg) await cargarIg(dataIg._r);
    } catch(e){
      if(e.auth) mostrarLogin('La sesión se cerró. Entra otra vez.');
      else toast(e.message || 'No se pudo actualizar Instagram.', true);
    }
  }

  /* ---------- Newsletter (sección aparte: si falla, el resto del portal sigue igual). Solo cantidades; no muestra correos. ---------- */
  let dataNews = null;
  async function cargarNews(r){
    const err = $('news-error');
    try {
      dataNews = DEMO ? demoNews() : await api('newsletter?' + new URLSearchParams({ desde: r.desde, hasta: r.hasta }).toString());
      dataNews._r = r; err.hidden = true; pintarNews();
    } catch(e){
      if(e.auth) return;
      err.hidden = false; err.textContent = e.message || 'No se pudieron leer los datos del newsletter.';
    }
  }
  function pintarNews(){
    const d = dataNews, r = d._r;
    $('news-live').textContent = d.ultimo_aviso ? 'Último aviso enviado ' + haceCuanto(d.ultimo_aviso) : 'Todavía no se ha enviado ningún aviso';
    const av = $('news-aviso'); av.hidden = false; av.textContent = d.avisos_activos
      ? 'Los avisos por correo están ACTIVOS: cada día a las 10:00 (Caracas) se le manda a cada suscriptor, como máximo una vez por semana, el producto que más vio.'
      : 'Los avisos por correo están APAGADOS. Los suscriptores y lo que miran sí se guardan; no se manda ningún correo hasta que se active.';
    const k = $('news-kpis'); k.textContent = '';
    k.appendChild(kpi('Suscriptores activos', entero(d.activos), null, 'Personas suscritas hoy que no se han dado de baja.'));
    k.appendChild(kpi('Nuevos en el periodo', entero(d.nuevos), null));
    k.appendChild(kpi('Se dieron de baja', entero(d.bajas), null, 'Total, de siempre.'));
    k.appendChild(kpi('Suscriptores que miraron productos', entero(d.con_vistas), null, 'En el periodo elegido.'));
    k.appendChild(kpi('Páginas miradas por suscriptores', entero(d.vistas), null));
    k.appendChild(kpi('Descuentos de 10% usados', entero(d.descuentos_usados), null, 'Clientes que ya compraron con su 10%, en el periodo.'));
    k.appendChild(kpi('Avisos enviados', entero(d.avisos), null, 'Correos de "el producto que viste" en el periodo.'));
    const box = $('news-top'); box.textContent = '';
    const top = d.top || [];
    if(!top.length){ box.appendChild(el('p', 'v-vacio', 'Todavía no hay páginas miradas por suscriptores.')); return; }
    const max = Math.max.apply(null, top.map(function(t){ return t.vistas; })) || 1;
    top.forEach(function(t){
      const row = el('div', 'v-row');
      row.appendChild(el('b', null, t.titulo || nombrePagina(String(t.ruta).split('?')[0])));
      row.appendChild(el('span', null, entero(t.vistas)));
      row.appendChild(el('small', null, entero(t.suscriptores) + (t.suscriptores === 1 ? ' suscriptor' : ' suscriptores') + ' · ' + (t.vistas === 1 ? '1 vista' : entero(t.vistas) + ' vistas')));
      const m = el('div', 'v-meter'); const f = el('i'); f.style.width = Math.max(2, t.vistas / max * 100) + '%'; m.appendChild(f); row.appendChild(m);
      box.appendChild(row);
    });
  }
  $('news-prueba-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const em = $('news-prueba-email').value.trim(), b = $('news-prueba-btn');
    if(!em || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em)){ toast('Escribe un correo válido.', true); return; }
    b.disabled = true;
    try {
      if(DEMO) await new Promise(function(ok){ setTimeout(ok, 500); });
      else await api('newsletter-prueba', { method: 'POST', body: JSON.stringify({ email: em, tipo: ($('news-prueba-tipo') || {}).value || 'semana' }) });
      toast('Listo, revisa tu correo (y la carpeta de spam).');
    } catch(err){
      if(err.auth) mostrarLogin('La sesión se cerró. Entra otra vez.');
      else toast(err.message || 'No se pudo enviar la prueba.', true);
    }
    b.disabled = false;
  });

  /* ---------- Reposición: cuántos clientes están ligados a un pedido, a cuántos se les puede escribir y el envío ---------- */
  let dataRepo = null;
  async function cargarRepo(){
    const err = $('repo-error');
    try {
      dataRepo = DEMO ? { ok: true, ligados: 12, con_carrito: 9, listos: 7, enviados_30d: 0, abiertos_30d: 0 } : await api('reposicion');
      err.hidden = true; pintarRepo();
    } catch(e){
      if(e.auth) return;
      err.hidden = false; err.textContent = e.message || 'No se pudieron leer los datos de reposición.';
    }
  }
  function pintarRepo(){
    const d = dataRepo;
    $('repo-live').textContent = d.enviados_30d ? 'Enviados en 30 días: ' + entero(d.enviados_30d) + ' · abiertos: ' + entero(d.abiertos_30d) : 'Todavía no se ha enviado ninguna reposición';
    const av = $('repo-aviso'); av.hidden = false;
    av.textContent = d.ligados ? 'Los clientes se ligan solos: cuando un suscriptor compra, o cuando alguien escribe su correo y marca la casilla en el carrito, queda ligado a ese pedido.' : 'Todavía no hay clientes ligados a un pedido. Se irán ligando solos: cuando un suscriptor compra, o cuando alguien escribe su correo y marca la casilla en el carrito.';
    const k = $('repo-kpis'); k.textContent = '';
    k.appendChild(kpi('Clientes ligados a un pedido', entero(d.ligados), null, 'Suscriptores activos de los que sabemos cuál fue su compra.'));
    k.appendChild(kpi('Con su carrito guardado', entero(d.con_carrito), null, 'Solo se puede rearmar el carrito de pedidos hechos desde que existe esta función.'));
    k.appendChild(kpi('Listos para recibir el correo', entero(d.listos), null, 'Con pedido confirmado y sin reposición en los últimos 14 días.'));
    k.appendChild(kpi('Correos enviados (30 días)', entero(d.enviados_30d), null));
    k.appendChild(kpi('Abrieron su carrito', entero(d.abiertos_30d), null, 'Entraron con el botón del correo.'));
    const b = $('repo-enviar'); b.disabled = !d.listos; b.textContent = d.listos ? 'Enviar reposición a ' + entero(d.listos) + (d.listos === 1 ? ' persona' : ' personas') : 'No hay a quién enviar todavía';
  }
  $('repo-enviar').addEventListener('click', async function(){
    const n = dataRepo ? dataRepo.listos : 0; if(!n) return;
    if(!window.confirm('Se le mandará el correo "Ya tenemos tu reposición hecha" a ' + n + (n === 1 ? ' persona' : ' personas') + '. ¿Enviar ahora?')) return;
    const b = this; b.disabled = true; toast('Enviando…');
    try {
      const r = DEMO ? { enviados: n, fallos: 0 } : await api('reposicion-enviar', { method: 'POST', body: JSON.stringify({ confirmar: true }) });
      toast('Listo: ' + r.enviados + ' enviados' + (r.fallos ? ' y ' + r.fallos + ' con error' : '') + '.', !!r.fallos);
      await cargarRepo();
    } catch(e){
      if(e.auth) mostrarLogin('La sesión se cerró. Entra otra vez.'); else toast(e.message || 'No se pudo enviar.', true);
      b.disabled = false;
    }
  });
  $('repo-prueba-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const em = $('repo-prueba-email').value.trim(), b = $('repo-prueba-btn');
    if(!em || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em)){ toast('Escribe un correo válido.', true); return; }
    b.disabled = true;
    try {
      if(DEMO) await new Promise(function(ok){ setTimeout(ok, 500); });
      else await api('reposicion-prueba', { method: 'POST', body: JSON.stringify({ email: em }) });
      toast('Listo, revisa tu correo (y la carpeta de spam).');
    } catch(err){
      if(err.auth) mostrarLogin('La sesión se cerró. Entra otra vez.'); else toast(err.message || 'No se pudo enviar la prueba.', true);
    }
    b.disabled = false;
  });

  function setLive(ok, txt){ $('live').className = 'live ' + (ok ? 'is-ok' : 'is-bad'); $('live-text').textContent = txt; }

  function haceCuanto(iso){
    if(!iso) return 'nunca';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if(min < 2) return 'hace un momento';
    if(min < 60) return 'hace ' + min + ' min';
    const h = Math.round(min / 60);
    if(h < 24) return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
    const d = Math.round(h / 24);
    return 'hace ' + d + (d === 1 ? ' día' : ' días');
  }

  /* ---------- Pintar ---------- */
  function delta(actual, previo, etiqueta){
    if(previo == null) return null;
    const box = el('span', 'delta');
    if(!previo){ box.textContent = actual > 0 ? 'Sin datos antes' : 'Sin cambio'; return box; }
    const r = Math.round((actual - previo) / previo * 1000) / 10;
    box.className = 'delta ' + (r > 0 ? 'delta--up' : r < 0 ? 'delta--down' : '');
    box.textContent = (r > 0 ? '▲ +' : r < 0 ? '▼ ' : '= ') + String(r).replace('.', ',') + '% ' + etiqueta;
    return box;
  }
  function kpi(titulo, valor, d, ayuda){
    const k = el('div', 'kpi');
    k.appendChild(el('small', null, titulo));
    k.appendChild(el('strong', null, valor));
    if(d) k.appendChild(d);
    if(ayuda) k.title = ayuda;
    return k;
  }

  function pintar(){
    const a = data.actual, c = data.comparacion, r = data._r;
    const hayComp = c && c.dias_con_datos > 0;
    const interA = pct(a.sesiones_activas, a.sesiones), interC = c ? pct(c.sesiones_activas, c.sesiones) : 0;
    $('mk-live').textContent = 'Datos de Google Analytics · actualizado ' + haceCuanto(data.actualizado);

    const aviso = $('mk-aviso');
    const esperados = diasEntre(r.desde, r.hasta) + 1;
    aviso.textContent = '';
    if(!a.dias_con_datos){
      aviso.hidden = false;
      aviso.appendChild(document.createTextNode('Todavía no hay datos guardados para este periodo. '));
      const b = el('button', 'linkbtn', 'Traer los últimos 90 días'); b.type = 'button'; b.addEventListener('click', function(){ actualizar(90); });
      aviso.appendChild(b);
    } else if(a.dias_con_datos < esperados - 1){
      aviso.hidden = false;
      aviso.appendChild(document.createTextNode('Faltan datos de ' + (esperados - a.dias_con_datos) + ' días de este periodo. '));
      const b = el('button', 'linkbtn', 'Traer los últimos 90 días'); b.type = 'button'; b.addEventListener('click', function(){ actualizar(90); });
      aviso.appendChild(b);
    } else if(data.ultima_sync && data.ultima_sync.estado === 'error'){
      aviso.hidden = false; aviso.textContent = 'La última actualización automática falló. Los números pueden estar atrasados; prueba "Actualizar ahora".';
    } else aviso.hidden = true;

    const k = $('mk-kpis'); k.textContent = '';
    const dp = function(x, y){ return hayComp ? delta(x, y, r.etiqueta) : null; };
    k.appendChild(kpi('Visitas', entero(a.sesiones), dp(a.sesiones, c && c.sesiones), 'Cada vez que alguien entra al sitio cuenta como una visita.'));
    k.appendChild(kpi('Personas por día', entero(a.usuarios_dia), dp(a.usuarios_dia, c && c.usuarios_dia), 'Promedio de personas distintas que entran cada día.'));
    k.appendChild(kpi('Personas nuevas', entero(a.nuevos), dp(a.nuevos, c && c.nuevos), 'Entraron por primera vez al sitio.'));
    k.appendChild(kpi('Páginas vistas', entero(a.paginas_vistas), dp(a.paginas_vistas, c && c.paginas_vistas)));
    k.appendChild(kpi('Tiempo por visita', duracion(a.duracion_prom), dp(a.duracion_prom, c && c.duracion_prom)));
    k.appendChild(kpi('Visitas con interacción', decimal(interA) + '%', dp(interA, interC), 'Visitas en las que la persona se quedó o hizo algo más que entrar y salir.'));

    pintarResumen(a, hayComp ? c : null, r);
    pintarGrafica();
    pintarEmbudo(a, hayComp ? c : null);
    pintarLista('mk-fuentes', agrupar(data.fuentes, function(x){ return nombreFuente(x.fuente, x.medio); }, 'sesiones'), 'sesiones', 'visitas', 8);
    pintarLista('mk-disp', agrupar(data.dispositivos, function(x){ return NOMBRE_DISP[String(x.dispositivo).toLowerCase()] || x.dispositivo; }, 'sesiones'), 'sesiones', 'visitas', 6);
    pintarLista('mk-paginas', agrupar(data.paginas, function(x){ return nombrePagina(x.ruta); }, 'vistas'), 'vistas', 'vistas', 10);
    pintarLista('mk-ciudades', agrupar(data.ciudades, function(x){ return x.ciudad === '(not set)' || x.ciudad === '(desconocida)' ? 'Sin identificar' : x.ciudad + (x.pais && x.pais !== 'Venezuela' ? ' (' + x.pais + ')' : ''); }, 'sesiones'), 'sesiones', 'visitas', 8);
  }

  function agrupar(filas, nombre, campo){
    const m = {};
    (filas || []).forEach(function(x){ const n = nombre(x); m[n] = (m[n] || 0) + (Number(x[campo]) || 0); });
    return Object.keys(m).map(function(n){ return { nombre: n, valor: m[n] }; }).sort(function(a, b){ return b.valor - a.valor; });
  }

  function pintarLista(id, lista, _campo, unidad, max){
    const box = $(id); box.textContent = '';
    const total = lista.reduce(function(s, x){ return s + x.valor; }, 0);
    if(!lista.length || total <= 0){ box.appendChild(el('p', 'v-vacio', 'Sin datos en este periodo.')); return; }
    lista.slice(0, max).forEach(function(x){
      const p = x.valor / total * 100;
      const row = el('div', 'v-row');
      row.appendChild(el('b', null, x.nombre));
      row.appendChild(el('span', null, entero(x.valor)));
      row.appendChild(el('small', null, decimal(p) + '% de las ' + unidad));
      const m = el('div', 'v-meter'); const i = el('i'); i.style.width = Math.max(1, p) + '%'; m.appendChild(i); row.appendChild(m);
      box.appendChild(row);
    });
  }

  function pintarEmbudo(a, c){
    const box = $('mk-embudo'); box.textContent = '';
    if(!a.sesiones){ box.appendChild(el('p', 'v-vacio', 'Sin datos en este periodo.')); return; }
    const pasos = [
      { t: 'Entraron al sitio', v: a.sesiones, pv: c && c.sesiones, base: a.sesiones },
      { t: 'Agregaron un producto al carrito', v: a.add_carrito, pv: c && c.add_carrito, base: a.sesiones },
      { t: 'Empezaron a pagar', v: a.inicia_compra, pv: c && c.inicia_compra, base: a.sesiones }
    ];
    pasos.forEach(function(p, i){
      const por100 = Math.round(p.v / p.base * 1000) / 10;
      const row = el('div', 'v-row');
      row.appendChild(el('b', null, p.t));
      row.appendChild(el('span', null, entero(p.v)));
      row.appendChild(el('small', null, i === 0 ? 'Punto de partida: 100 por cada 100 visitas' : decimal(por100) + ' por cada 100 visitas'));
      const m = el('div', 'v-meter'); const f = el('i'); f.style.width = Math.max(1, Math.min(100, por100)) + '%'; m.appendChild(f); row.appendChild(m);
      box.appendChild(row);
    });
  }

  function pintarGrafica(){
    const box = $('mk-chart'); box.textContent = '';
    const pts = (data.dias || []).map(function(d){ return { clave: d.dia, v: Number(d.sesiones) || 0, vistas: Number(d.paginas_vistas) || 0 }; });
    const total = pts.reduce(function(s, p){ return s + p.v; }, 0);
    if(!pts.length || total <= 0){ box.appendChild(el('p', 'v-vacio', 'Todavía no hay visitas guardadas en este periodo.')); return; }
    const W = 720, H = 260, L = 46, R = 8, T = 14, B = 38;
    const max = Math.max.apply(null, pts.map(function(p){ return p.v; }));
    const paso = (function(){ const g = Math.pow(10, Math.floor(Math.log10(max))); const f = max / g; return (f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * g; })();
    const tope = Math.ceil(max / paso) * paso;
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Gráfica de visitas por día: total ' + entero(total) });
    for(let v = 0; v <= tope + 0.001; v += paso){
      const y = T + (H - T - B) * (1 - v / tope);
      s.appendChild(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
      const t = svg('text', { x: L - 8, y: y + 6, 'text-anchor': 'end' }); t.textContent = String(Math.round(v)); s.appendChild(t);
    }
    const ancho = (W - L - R) / pts.length, bw = Math.max(2, Math.min(40, ancho * 0.7));
    const hoy = hoyCaracas(), cada = Math.max(1, Math.ceil(pts.length / 7));
    pts.forEach(function(p, i){
      const x = L + ancho * i + (ancho - bw) / 2, h = (H - T - B) * (p.v / tope);
      const r = svg('rect', { x: x, y: H - B - h, width: bw, height: Math.max(p.v > 0 ? 2 : 0, h), class: 'bar' + (p.clave === hoy ? ' bar--hoy' : '') });
      const t = svg('title'); t.textContent = etiquetaDia(p.clave) + ': ' + entero(p.v) + ' visitas · ' + entero(p.vistas) + ' páginas vistas'; r.appendChild(t);
      s.appendChild(r);
      if(i % cada === 0){ const tx = svg('text', { x: x + bw / 2, y: H - 12, 'text-anchor': 'middle' }); tx.textContent = etiquetaDia(p.clave); s.appendChild(tx); }
    });
    box.appendChild(s);
  }

  /* Resumen en lenguaje normal, armado con los mismos números de abajo */
  function pintarResumen(a, c, r){
    const ul = $('mk-resumen'); ul.textContent = '';
    function linea(partesTxt){
      const li = el('li');
      partesTxt.forEach(function(p){ if(typeof p === 'string') li.appendChild(document.createTextNode(p)); else li.appendChild(el('b', null, p.b)); });
      ul.appendChild(li);
    }
    if(!a.sesiones){ linea(['Todavía no hay visitas guardadas para ', r.nombre, '.']); return; }
    const cambio = function(x, y){ if(!y) return ''; const q = Math.round((x - y) / y * 100); return q === 0 ? ' (igual que ' + r.etiqueta.replace('vs ', '') + ')' : ' (' + (q > 0 ? 'subió ' : 'bajó ') + Math.abs(q) + '% ' + r.etiqueta + ')'; };
    linea(['En ', r.nombre, ' el sitio tuvo ', { b: entero(a.sesiones) + ' visitas' }, ' de ', { b: entero(a.nuevos) + ' personas nuevas' }, cambio(a.sesiones, c && c.sesiones), '.']);
    const fuentes = agrupar(data.fuentes, function(x){ return nombreFuente(x.fuente, x.medio); }, 'sesiones');
    const totF = fuentes.reduce(function(s, x){ return s + x.valor; }, 0);
    if(fuentes.length && totF > 0) linea(['La principal puerta de entrada es ', { b: fuentes[0].nombre.split(' (')[0] }, ', con el ', { b: decimal(fuentes[0].valor / totF * 100) + '%' }, ' de las visitas.']);
    const pags = agrupar(data.paginas, function(x){ return nombrePagina(x.ruta); }, 'vistas').filter(function(x){ return x.nombre !== 'Inicio'; });
    if(pags.length) linea(['Fuera del inicio, lo más visto es ', { b: pags[0].nombre }, ' (', entero(pags[0].valor), ' vistas).']);
    const disp = agrupar(data.dispositivos, function(x){ return NOMBRE_DISP[String(x.dispositivo).toLowerCase()] || x.dispositivo; }, 'sesiones');
    const totD = disp.reduce(function(s, x){ return s + x.valor; }, 0);
    if(disp.length && totD > 0) linea([{ b: decimal(disp[0].valor / totD * 100) + '%' }, ' de las visitas vienen de ', { b: disp[0].nombre.toLowerCase() }, '.']);
    linea(['Por cada 100 visitas, ', { b: decimal(pct(a.add_carrito, a.sesiones)) }, ' agregan algo al carrito y ', { b: decimal(pct(a.inicia_compra, a.sesiones)) }, ' empiezan a pagar.']);
    linea(['Cada visita dura en promedio ', { b: duracion(a.duracion_prom) }, ' y el ', { b: decimal(pct(a.sesiones_activas, a.sesiones)) + '%' }, ' de las visitas interactúa con el sitio.']);
  }

  /* ---------- Acciones ---------- */
  async function actualizar(dias){
    const b = $('btn-actualizar'); b.disabled = true;
    toast(dias > 7 ? 'Trayendo el historial… puede tardar un poco.' : 'Actualizando…');
    try {
      if(DEMO) await new Promise(function(ok){ setTimeout(ok, 600); });
      else await api('actualizar', { method: 'POST', body: JSON.stringify({ dias: dias || 3 }) });
      toast('Listo, datos actualizados.');
      await cargar();
    } catch(e){
      if(e.auth) mostrarLogin('La sesión se cerró. Entra otra vez.');
      else toast(e.message || 'No se pudo actualizar. Intenta otra vez.', true);
    }
    b.disabled = false;
  }
  $('btn-actualizar').addEventListener('click', function(){ actualizar(3); });

  document.querySelectorAll('[data-periodo]').forEach(function(b){
    b.addEventListener('click', function(){
      periodo = b.dataset.periodo;
      document.querySelectorAll('[data-periodo]').forEach(function(x){ const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
      $('mk-fechas').hidden = periodo !== 'fechas';
      if(periodo === 'fechas'){
        if(!$('mk-hasta').value) $('mk-hasta').value = hoyCaracas();
        if(!$('mk-desde').value) $('mk-desde').value = sumarDias(hoyCaracas(), -13);
      }
      cargar();
    });
  });
  $('mk-fechas').addEventListener('submit', function(e){ e.preventDefault(); cargar(); });

  /* Instalable en Android: el service worker no guarda nada, solo habilita "Instalar app" */
  if(!DEMO && 'serviceWorker' in navigator){
    window.addEventListener('load', function(){ navigator.serviceWorker.register('/marketing-sw.js', { scope: '/marketing.html' }).catch(function(){}); });
  }

  /* ---------- Inicio: si ya hay sesión, entra directo ---------- */
  (async function(){
    if(DEMO){ mostrarApp(); return; }
    try { await api('datos?' + new URLSearchParams({ desde: hoyCaracas(), hasta: hoyCaracas() }).toString()); mostrarApp(); }
    catch(e){ mostrarLogin(e.auth ? '' : (e.message || 'No se pudo conectar.')); }
  })();

  /* ---------- Demostración (solo localhost con ?demo=1) ---------- */
  function demoNews(){
    return { ok: true, activos: 42, bajas: 1, nuevos: 17, con_vistas: 11, vistas: 36, descuentos_usados: 5, avisos: 6, avisos_activos: false, ultimo_aviso: null,
      top: [{ ruta: '/producto-going-hidratante.html', titulo: 'Hidratante Uva Going', vistas: 12, suscriptores: 7 }, { ruta: '/categoria.html?cat=hidratacion', titulo: 'Hidratación', vistas: 9, suscriptores: 5 }, { ruta: '/producto-saltstick-capsulas.html', titulo: 'Cápsulas de Electrolitos SaltStick', vistas: 4, suscriptores: 3 }] };
  }

  function demoIg(r){
    return new Promise(function(resolve){
      setTimeout(function(){
        const n = Math.max(1, Math.round((diasEntre(r.desde, r.hasta) + 1) / 3));
        resolve({ ok: true, usuario: 'apexnutricionve', actualizado: new Date().toISOString(), ultima_sync: { estado: 'ok' },
          actual: { publicaciones: n, me_gusta: n * 64, con_me_gusta: n, comentarios: n * 5, vistas: n * 420, seguidores: 1840, seguidores_inicio: 1790 },
          comparacion: r.cdesde ? { publicaciones: Math.max(1, n - 1), me_gusta: n * 52, con_me_gusta: Math.max(1, n - 1), comentarios: n * 4, vistas: n * 300 } : null,
          tipos: [{ tipo: 'video', publicaciones: Math.ceil(n / 2), me_gusta_prom: 91, comentarios_prom: 8, vistas_prom: 840 }, { tipo: 'carrusel', publicaciones: Math.ceil(n / 3), me_gusta_prom: 58, comentarios_prom: 5 }, { tipo: 'imagen', publicaciones: 1, me_gusta_prom: 33, comentarios_prom: 2 }],
          top: [{ tipo: 'video', dia: r.hasta, me_gusta: 142, comentarios: 14, vistas: 2100, texto: 'Black Friday en Apex: 25% en proteína, hidratante y Skratch hasta el domingo', url: 'https://www.instagram.com/apexnutricionve/' }, { tipo: 'carrusel', dia: r.desde, me_gusta: 77, comentarios: 6, texto: 'Qué tomar en una carrera de 21K', url: 'https://www.instagram.com/apexnutricionve/' }] });
      }, 250);
    });
  }

  function demoData(r){
    return new Promise(function(resolve){
      setTimeout(function(){
        const dias = []; let ses = 0, pv = 0, nue = 0, act = 0, car = 0, chk = 0, dur = 0;
        for(let d = r.desde, i = 0; d <= r.hasta && i < 400; d = sumarDias(d, 1), i++){
          const s = 24 + ((i * 11 + d.charCodeAt(9)) % 30), v = Math.round(s * 3.2), a = Math.round(s * 0.36), cc = Math.round(s * 0.26);
          dias.push({ dia: d, sesiones: s, paginas_vistas: v, add_carrito: a }); ses += s; pv += v; nue += Math.round(s * 0.7); act += Math.round(s * 0.85); car += a; chk += cc; dur += s * 240;
        }
        const n = dias.length;
        const base = { sesiones: ses, nuevos: nue, paginas_vistas: pv, sesiones_activas: act, usuarios_dia: Math.round(ses / n * 0.8), duracion_prom: Math.round(dur / ses), add_carrito: car, inicia_compra: chk, dias_con_datos: n };
        const comp = r.cdesde ? Object.assign({}, base, { desde: r.cdesde, hasta: r.chasta, sesiones: Math.round(ses * 0.82), nuevos: Math.round(nue * 0.9), paginas_vistas: Math.round(pv * 0.7), add_carrito: Math.round(car * 0.8), inicia_compra: Math.round(chk * 1.1), usuarios_dia: Math.round(base.usuarios_dia * 0.85), duracion_prom: Math.round(base.duracion_prom * 1.2) }) : null;
        resolve({ ok: true, actual: Object.assign({ desde: r.desde, hasta: r.hasta }, base), comparacion: comp, dias: dias,
          fuentes: [{ fuente: 'ig', medio: 'paid', sesiones: Math.round(ses * 0.34) }, { fuente: '(direct)', medio: '(none)', sesiones: Math.round(ses * 0.3) }, { fuente: 'google', medio: 'organic', sesiones: Math.round(ses * 0.2) }, { fuente: 'l.instagram.com', medio: 'referral', sesiones: Math.round(ses * 0.12) }, { fuente: 'wa.me', medio: 'referral', sesiones: Math.round(ses * 0.04) }],
          dispositivos: [{ dispositivo: 'mobile', sesiones: Math.round(ses * 0.82) }, { dispositivo: 'desktop', sesiones: Math.round(ses * 0.16) }, { dispositivo: 'tablet', sesiones: Math.round(ses * 0.02) }],
          paginas: [{ ruta: '/', vistas: Math.round(pv * 0.3) }, { ruta: '/index.html', vistas: Math.round(pv * 0.05) }, { ruta: '/categoria.html', vistas: Math.round(pv * 0.14) }, { ruta: '/ofertas.html', vistas: Math.round(pv * 0.1) }, { ruta: '/carrito.html', vistas: Math.round(pv * 0.1) }, { ruta: '/producto-going-hidratante.html', vistas: Math.round(pv * 0.06) }, { ruta: '/marca-honey.html', vistas: Math.round(pv * 0.04) }],
          ciudades: [{ pais: 'Venezuela', ciudad: 'Caracas', sesiones: Math.round(ses * 0.5) }, { pais: 'Venezuela', ciudad: 'Valencia', sesiones: Math.round(ses * 0.14) }, { pais: 'Venezuela', ciudad: 'Maracaibo', sesiones: Math.round(ses * 0.1) }, { pais: 'Venezuela', ciudad: '(not set)', sesiones: Math.round(ses * 0.08) }, { pais: 'Colombia', ciudad: 'Bogotá', sesiones: Math.round(ses * 0.03) }],
          actualizado: new Date().toISOString(), ultima_sync: { estado: 'ok' } });
      }, 250);
    });
  }
})();
