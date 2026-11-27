/* Panel de pedidos (panel.html). Reemplaza a los botones de Telegram: muestra los pedidos por etapa y
   permite confirmar, cancelar y registrar cómo se entregó. Una sola lista: cada pedido se atiende en su tarjeta
   (Confirmar → se elige Delivery o Pick up, quién paga y el monto → el pedido sale de la lista).
   Habla solo con el Worker (/api/panel/*), que exige el código de acceso. El estado de cada pedido vive en
   la hoja de cálculo; aquí no se guarda nada salvo preferencias del aparato (sonido, pantalla encendida).
   Modo demostración (?demo=1, solo en localhost): datos de mentira para revisar el diseño. */
(function(){
  'use strict';

  const $ = function(id){ return document.getElementById(id); };
  const DEMO = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && new URLSearchParams(location.search).has('demo');
  const POLL_MS = 10000;          // cada cuánto se pregunta por pedidos nuevos (con la pestaña a la vista)
  const REMIND_MS = 60000;        // mientras haya pedidos nuevos sin atender, un aviso sonoro cada minuto
  const WARN_MIN = 10, LATE_MIN = 30;

  let orders = [];
  let seenNew = null;             // ids de pedidos "nuevos" ya vistos (null = aún no hay primera carga)
  let clockSkew = 0;              // diferencia entre el reloj del servidor y el de este aparato
  let wakeLock = null;
  let audio = null, pollTimer = null, remindTimer = null, toastTimer = null, loading = false;
  const ui = {};                  // estado de pantalla por pedido: { otro: true } mientras escribe un monto; { confirm: {...} } mientras elige la entrega

  function pref(k, d){ try { const v = localStorage.getItem('apex_panel_' + k); return v === null ? d : v; } catch(e){ return d; } }
  function setPref(k, v){ try { localStorage.setItem('apex_panel_' + k, v); } catch(e){} }

  /* ---------- Red ---------- */
  async function api(path, opts){
    if(DEMO) return demoApi(path, opts);
    const res = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    if(res.status === 401) throw { auth: true };
    if(res.status === 429) throw { message: 'Demasiados intentos. Espera un minuto y vuelve a probar.' };
    if(res.status === 503) throw { message: 'El panel todavía no está configurado.' };
    let data = null;
    try { data = await res.json(); } catch(e){}
    if(!res.ok || !data || data.ok === false) throw { message: (data && data.error) || ('Error ' + res.status) };
    return data;
  }

  /* ---------- Pantallas ---------- */
  function showLogin(msg){
    stopPolling();
    $('app').hidden = true; $('login').hidden = false;
    const err = $('login-error');
    err.hidden = !msg; err.textContent = msg || '';
    $('login-code').focus();
  }
  function showApp(){
    $('login').hidden = true; $('app').hidden = false;
    fixStickyOffset(); requestWake();
    refresh().then(startPolling); pruebaCorreo();
    tick(); setInterval(tick, 30000);
  }
  function fixStickyOffset(){
    const bar = document.querySelector('.bar');
    document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px');
  }
  window.addEventListener('resize', fixStickyOffset);

  $('login-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const btn = $('login-btn'); btn.disabled = true;
    unlockAudio();   // el toque de "Entrar" es el gesto que el navegador exige para poder sonar después
    try {
      await api('/api/panel/login', { method: 'POST', body: JSON.stringify({ code: $('login-code').value }) });
      $('login-code').value = '';
      showApp();
    } catch(err){
      showLogin(err.auth ? 'Código incorrecto.' : (err.message || 'No se pudo entrar. Intenta otra vez.'));
    }
    btn.disabled = false;
  });
  $('tool-exit').addEventListener('click', async function(){
    try { await api('/api/panel/logout', { method: 'POST', body: '{}' }); } catch(e){}
    showLogin();
  });

  // Prueba del correo recordatorio (oculta, solo para soporte): abrir /panel.html?prueba=correo con la sesión iniciada.
  function pruebaCorreo(){
    if(DEMO) return;
    try {
      const q = new URLSearchParams(location.search);
      if(q.get('prueba') !== 'correo') return;
      history.replaceState(null, '', location.pathname);   // para que recargar no mande otro
    } catch(e){ return; }
    toast('Enviando correo de prueba…', false, 60000);
    api('/api/panel/recordatorio-prueba', { method: 'POST', body: '{}' }).then(function(r){
      toast('Correo de prueba enviado' + (r.pendientes != null ? ' (' + r.pendientes + ' pendientes)' : '') + '. Revisa Recibidos, Spam y Papelera.', false, 20000);
    }).catch(function(err){ toast('No se pudo enviar el correo de prueba: ' + ((err && err.message) || 'error desconocido'), true, 30000); });
  }

  /* ---------- Carga y repintado ---------- */
  async function refresh(){
    if(loading) return;
    loading = true;
    try {
      const data = await api('/api/panel/orders');
      clockSkew = (data.now || Date.now()) - Date.now();
      orders = data.orders || [];
      setLive(true);
      detectNew();
      render();
    } catch(err){
      if(err.auth){ showLogin('Tu sesión terminó. Entra otra vez.'); }
      else setLive(false, err.message);
    }
    loading = false;
  }
  function startPolling(){
    stopPolling();
    pollTimer = setInterval(function(){ if(!document.hidden) refresh(); }, POLL_MS);
    remindTimer = setInterval(remind, REMIND_MS);
  }
  function stopPolling(){ clearInterval(pollTimer); clearInterval(remindTimer); }
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && !$('app').hidden){ refresh(); requestWake(); }
  });

  function setLive(ok, msg){
    const el = $('live');
    el.classList.toggle('is-ok', ok); el.classList.toggle('is-bad', !ok);
    $('live-text').textContent = ok ? 'En vivo' : 'Sin conexión';
    if(!ok && msg) el.title = msg; else el.removeAttribute('title');
  }

  const now = function(){ return Date.now() + clockSkew; };
  function tick(){
    $('clock').textContent = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
    document.querySelectorAll('.t-time[data-created]').forEach(function(t){ paintTime(t); });
  }
  function minutesSince(ms){ return Math.max(0, Math.floor((now() - ms) / 60000)); }
  function ageLabel(min){
    if(min < 1) return 'ahora';
    if(min < 60) return 'hace ' + min + ' min';
    if(min < 1440) return 'hace ' + Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
    return 'hace ' + Math.floor(min / 1440) + ' d';
  }
  function paintTime(t){
    const min = minutesSince(Number(t.dataset.created));
    t.textContent = ageLabel(min);
    t.classList.toggle('is-warn', min >= WARN_MIN && min < LATE_MIN);
    t.classList.toggle('is-late', min >= LATE_MIN);
  }

  /* ---------- Avisos de pedido nuevo ---------- */
  function newOnes(){ return orders.filter(function(o){ return o.stage === 'new'; }); }
  function detectNew(){
    const cur = newOnes();
    if(seenNew === null){ seenNew = new Set(cur.map(function(o){ return o.id; })); return; }
    const fresh = cur.filter(function(o){ return !seenNew.has(o.id); });
    fresh.forEach(function(o){ seenNew.add(o.id); o._fresh = true; });
    if(fresh.length){ beep(); if(navigator.vibrate) navigator.vibrate([250, 120, 250]); }
  }
  function remind(){
    if(document.hidden) return;
    const stale = newOnes().some(function(o){ return minutesSince(o.createdMs) >= 1; });
    if(stale) beep();
  }
  function unlockAudio(){
    try {
      if(!audio){ const AC = window.AudioContext || window.webkitAudioContext; if(AC) audio = new AC(); }
      if(audio && audio.state === 'suspended') audio.resume();
    } catch(e){}
  }
  function beep(){
    try {
      unlockAudio();
      if(!audio) return;
      const t0 = audio.currentTime;
      [[880, 0], [1175, 0.2], [880, 0.4]].forEach(function(n){
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t0 + n[1]);
        g.gain.exponentialRampToValueAtTime(0.4, t0 + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.17);
        o.connect(g); g.connect(audio.destination);
        o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.2);
      });
      $('sound-notice').hidden = audio.state === 'running';
    } catch(e){ $('sound-notice').hidden = false; }
  }
  $('sound-enable').addEventListener('click', function(){ unlockAudio(); beep(); setTimeout(function(){ $('sound-notice').hidden = !audio || audio.state === 'running'; }, 300); });

  // La pantalla se mantiene encendida sola mientras el panel está abierto (si el navegador lo permite).
  async function requestWake(){
    try { if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch(e){}
  }

  /* ---------- Pintar los pedidos ---------- */
  function el(tag, cls, text){
    const n = document.createElement(tag);
    if(cls) n.className = cls;
    if(text != null) n.textContent = text;
    return n;
  }
  const usd = function(n){ return '$' + (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ','); };
  // La hoja guarda el monto como número (6): se muestra como $6. Si es una nota ("Coordinar por WhatsApp"), tal cual.
  const money = function(v){ return /^\d+([.,]\d+)?$/.test(String(v)) ? '$' + String(v).replace('.', ',') : String(v); };
  const digits = function(s){ return String(s || '').replace(/\D/g, ''); };
  function waNumber(phone){
    let d = digits(phone);
    if(d.startsWith('00')) d = d.slice(2);
    if(d.startsWith('0')) d = '58' + d.slice(1);       // 0414… → 58414…
    else if(d.length === 10) d = '58' + d;              // 414… → 58414…
    return d;
  }

  function render(){
    // Si alguien está escribiendo un monto, no se repinta debajo de sus dedos: se retoma en la próxima carga.
    const a = document.activeElement;
    if(a && a.tagName === 'INPUT' && a.closest('.board')) return;

    // Una sola lista con lo que falta atender: pedidos nuevos y confirmados sin entrega. Lo resuelto ya no se muestra.
    const list = orders.filter(function(o){ return o.stage !== 'done'; }).sort(function(x, y){ return x.createdMs - y.createdMs; });   // el más viejo primero
    const box = document.querySelector('[data-list="all"]');
    box.textContent = '';
    if(!list.length) box.appendChild(el('p', 'empty', 'No hay pedidos por atender.'));
    else list.forEach(function(o){ box.appendChild(ticket(o)); });
    document.querySelectorAll('[data-count="all"]').forEach(function(c){ c.textContent = list.length; c.classList.toggle('has', list.length > 0); });
    const n = newOnes().length;
    document.title = (n ? '(' + n + ') ' : '') + 'Pedidos · Apex';
    tick();
  }

  function ticket(o){
    const done = o.stage === 'done';
    const card = el('article', 'ticket' + (done ? ' ticket--done' : '') + (o._fresh ? ' is-fresh' : ''));
    card.dataset.id = o.id;

    const head = el('div', 't-head');
    const num = el('div', 't-num'); num.appendChild(el('small', null, 'OC')); num.appendChild(document.createTextNode(o.id));
    head.appendChild(num);
    const time = el('span', 't-time');
    time.dataset.created = o.createdMs;
    if(done){
      time.textContent = new Date(o.createdMs).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
    } else paintTime(time);
    if(done) time.removeAttribute('data-created');
    head.appendChild(time);
    card.appendChild(head);

    const body = el('div', 't-body');
    const who = el('div', 't-who');
    who.appendChild(el('strong', null, o.customer || '(sin nombre)'));
    const meta = el('p', 't-meta');
    if(o.phone){
      const tel = el('a', null, o.phone); tel.href = 'tel:' + digits(o.phone);
      meta.appendChild(tel);
      meta.appendChild(document.createTextNode(' · '));
      const wa = el('a', null, 'WhatsApp'); wa.href = 'https://wa.me/' + waNumber(o.phone); wa.target = '_blank'; wa.rel = 'noopener';
      meta.appendChild(wa);
      meta.appendChild(el('br'));
    }
    const lugar = [o.zona, o.estado].filter(Boolean).join(' · ');
    if(lugar) meta.appendChild(document.createTextNode(lugar));
    who.appendChild(meta);
    if(o.mrw || o.ci){
      const cm = /^\[(MRW|Zoom)\]\s*/i.exec(o.mrw || '');       // el sitio guarda "[Zoom] dirección"; pedidos viejos = MRW
      const carrier = cm ? cm[1].toUpperCase() : 'MRW';
      const agency = cm ? o.mrw.slice(cm[0].length) : o.mrw;
      who.appendChild(el('span', 't-tag', 'Envío ' + carrier + ' · pago a destino'));
      const m = el('p', 't-meta', (o.ci ? 'C.I. ' + o.ci : '') + (o.ci && agency ? ' · ' : '') + (agency ? 'Agencia ' + carrier + ': ' + agency : ''));
      who.appendChild(m);
    } else if(/^pickup$/i.test(String(o.zona || '').trim())){
      who.appendChild(el('span', 't-tag', 'Retira en tienda'));
    }
    body.appendChild(who);

    const items = el('ul', 't-items');
    (o.items || []).forEach(function(it){
      const li = el('li');
      li.appendChild(el('span', 't-qty', it.qty + '×'));
      li.appendChild(el('span', null, it.product));
      items.appendChild(li);
    });
    body.appendChild(items);

    const total = el('div', 't-total');
    total.appendChild(el('span', null, 'Total'));
    total.appendChild(el('strong', null, usd(o.total)));
    body.appendChild(total);

    if(o.stage === 'new' && !(ui[o.id] && ui[o.id].confirm)){
      const acts = el('div', 't-actions');
      const ok = button('Confirmar', 'btn btn--ok', function(){ ui[o.id] = { confirm: startConfirm(o) }; render(); });
      const no = button('Cancelar pedido', 'btn btn--danger', function(b){ askCancel(o, b); });
      acts.appendChild(ok); acts.appendChild(no);
      body.appendChild(acts);
    } else {
      if(o.stage !== 'new') body.appendChild(el('p', 't-state t-state--ok', 'Confirmado. Falta registrar la entrega.'));
      if(!(ui[o.id] && ui[o.id].confirm)) ui[o.id] = { confirm: startConfirm(o) };
      body.appendChild(editor(o));
      // Un pedido ya confirmado también se puede cancelar (deja de contar como venta).
      if(o.stage !== 'new') body.appendChild(button('Cancelar pedido', 'btn btn--danger', function(b){ askCancel(o, b); }));
    }
    card.appendChild(body);
    return card;
  }

  const payerLabel = function(p){ return p === 'Tienda' ? 'Apex (la compañía)' : p; };
  // Valores iniciales de la entrega: Pick up si el cliente retira; si no, Delivery con las reglas de siempre
  // (paga Apex desde $30; $6 sugerido en zona de Caracas). Todo se puede cambiar antes de confirmar.
  function startConfirm(o){
    const pick = /^pickup$/i.test(String(o.zona || '').trim()) || /^pickup$/i.test(String(o.delivery));
    const paga = o.paidBy === 'Tienda' || o.paidBy === 'Cliente' ? o.paidBy : (Number(o.total) >= 30 ? 'Tienda' : 'Cliente');
    let valor = o.delivery && !/^pickup$/i.test(String(o.delivery)) ? String(o.delivery).replace(/^\$/, '') : '';
    if(!valor && /^\$6/.test(String(o.suggestion || ''))) valor = '6';
    // Envío por MRW/Zoom: el flete se paga a destino, lo paga el cliente.
    if(!pick && (o.mrw || o.ci)) return { tipo: 'delivery', paga: 'Cliente', valor: valor || 'Pago a destino' };
    return { tipo: pick ? 'pickup' : 'delivery', paga: paga, valor: valor };
  }
  // Paso para confirmar: tipo de entrega, quién la paga y el monto, con un solo botón.
  function editor(o){
    const st = ui[o.id].confirm;
    const box = el('form', 't-edit');
    box.appendChild(el('p', 't-edit-title', o.stage === 'new' ? 'Confirmar pedido ' + o.id + ': ¿cómo se entrega?' : 'Entrega del pedido ' + o.id));
    function choice(label, opts, current, onPick){
      const row = el('div', 't-choice'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', label);
      row.appendChild(el('span', 't-choice-label', label));
      opts.forEach(function(op){
        const b = el('button', 'btn t-opt' + (current === op[0] ? ' is-on' : ''), op[1]); b.type = 'button';
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(current === op[0]));
        b.addEventListener('click', function(){ onPick(op[0]); render(); });
        row.appendChild(b);
      });
      return row;
    }
    box.appendChild(choice('Entrega', [['delivery', 'Delivery'], ['pickup', 'Pick up']], st.tipo, function(v){ st.tipo = v; }));
    let inp = null;
    if(st.tipo === 'delivery'){
      box.appendChild(choice('Lo paga', [['Cliente', 'El cliente'], ['Tienda', 'Apex (la compañía)']], st.paga, function(v){ st.paga = v; }));
      const lab = el('label', 't-choice-label', 'Monto del delivery (o una nota)'); lab.htmlFor = 'edit-valor-' + o.id;
      inp = el('input'); inp.type = 'text'; inp.id = 'edit-valor-' + o.id; inp.inputMode = 'decimal'; inp.maxLength = 80; inp.placeholder = '6, 0 o una nota'; inp.value = st.valor;
      inp.addEventListener('input', function(){ st.valor = inp.value; });
      box.appendChild(lab); box.appendChild(inp);
      if(o.suggestion) box.appendChild(el('p', 't-meta', 'Sugerencia: ' + o.suggestion + '.'));
    }
    const acts = el('div', 't-actions');
    const save = el('button', 'btn btn--ok', o.stage === 'new' ? 'Confirmar pedido' : 'Guardar entrega'); save.type = 'submit';
    acts.appendChild(save);
    if(o.stage === 'new') acts.appendChild(button('Volver', 'btn', function(){ delete ui[o.id]; render(); }));
    box.appendChild(acts);
    box.addEventListener('submit', function(e){
      e.preventDefault();
      const v = st.valor.trim();
      if(st.tipo === 'delivery' && !v){ if(inp) inp.focus(); toast('Escribe el monto del delivery (0 si no se cobra).', true); return; }
      act(o, 'confirm_delivery', st.tipo === 'delivery' ? v : null, save, { tipo: st.tipo, paga: st.tipo === 'delivery' ? st.paga : null });
    });
    return box;
  }

  function button(label, cls, onClick){
    const b = el('button', cls, label); b.type = 'button';
    b.addEventListener('click', function(){ onClick(b); });
    return b;
  }

  /* ---------- Acciones ---------- */
  /* Cancelar un pedido pide confirmación en una ventana: "¿Seguro que quieres cancelar el pedido 00061 de Ana?" con "Sí, cancelar" y "No, volver". */
  function askCancel(o, trigger){
    if(document.getElementById('cancel-dialog')) return;
    const overlay = el('div', 'dialog-overlay'); overlay.id = 'cancel-dialog';
    const box = el('div', 'dialog'); box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'cancel-title'); box.setAttribute('aria-describedby', 'cancel-text');
    const title = el('h2', 'dialog-title', '¿Cancelar el pedido ' + o.id + '?'); title.id = 'cancel-title';
    const quien = o.customer ? ' de ' + o.customer : '';
    const text = el('p', 'dialog-text', '¿Seguro que quieres cancelar el pedido ' + o.id + quien + ' (' + usd(o.total) + ')?' + (o.stage !== 'new' ? ' Ya estaba confirmado: dejará de contar como venta.' : '') + ' Esta acción no se puede deshacer.'); text.id = 'cancel-text';
    const acts = el('div', 'dialog-actions');
    const keep = button('No, volver', 'btn', function(){ close(); });
    const ok = button('Sí, cancelar pedido', 'btn btn--danger-solid', function(b){ close(); act(o, 'canceled', null, trigger); });
    function close(){ overlay.remove(); document.removeEventListener('keydown', onKey); if(trigger && document.body.contains(trigger)) trigger.focus(); }
    function onKey(e){ if(e.key === 'Escape') close(); }
    acts.appendChild(keep); acts.appendChild(ok);
    box.appendChild(title); box.appendChild(text); box.appendChild(acts);
    overlay.appendChild(box);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    keep.focus();   // por defecto el foco queda en "No, volver": un toque suelto no cancela nada
  }
  async function act(o, action, value, btn, extra){
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await api('/api/panel/action', { method: 'POST', body: JSON.stringify(Object.assign({ orderId: o.id, action: action, value: value }, extra || {})) });
      delete ui[o.id];
      if(document.activeElement && document.activeElement.blur) document.activeElement.blur();   // si no, el campo enfocado frena el repintado
      loading = false;
      await refresh();
      toast(action === 'confirm_delivery' ? 'Pedido ' + o.id + ' confirmado.' : action === 'canceled' ? 'Pedido ' + o.id + ' cancelado.' : action === 'completed' ? 'Pedido ' + o.id + ' confirmado.' : 'Pedido ' + o.id + ' actualizado.');
    } catch(err){
      if(err.auth){ showLogin('Tu sesión terminó. Entra otra vez.'); return; }
      btn.disabled = false; btn.textContent = label;
      toast(err.message || 'No se pudo guardar. Intenta otra vez.', true);
    }
  }
  function toast(msg, isError, ms){
    const t = $('toast');
    t.textContent = msg; t.classList.toggle('is-error', !!isError); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.hidden = true; }, ms || 3200);
  }

  /* ---------- Demostración (solo localhost con ?demo=1) ---------- */
  function demoApi(path, opts){
    return new Promise(function(resolve, reject){
      setTimeout(function(){
        const body = opts && opts.body ? JSON.parse(opts.body) : {};
        if(path === '/api/panel/login' || path === '/api/panel/logout') return resolve({ ok: true });
        if(path === '/api/panel/orders') return resolve({ ok: true, now: Date.now(), orders: demo.map(decorate) });
        if(path === '/api/panel/action'){
          const o = demo.find(function(x){ return x.id === body.orderId; });
          if(!o) return reject({ message: 'Pedido no encontrado' });
          if(body.action === 'completed') o.status = 'Completed';
          else if(body.action === 'canceled') demo.splice(demo.indexOf(o), 1);
          else if(body.action === 'pickup') o.delivery = 'Pickup';
          else if(body.action === 'delivery') o.paidBy = o.total >= 30 ? 'Tienda' : 'Cliente';
          else if(body.action === 'confirm_delivery'){ o.status = 'Completed'; if(body.tipo === 'pickup'){ o.delivery = 'Pickup'; delete o.paidBy; } else { o.paidBy = body.paga; o.delivery = /^\d+([.,]\d+)?$/.test(body.value) ? '$' + body.value.replace(',', '.') : body.value; } }
          else if(body.action === 'delivery_price') o.delivery = /^\d+([.,]\d+)?$/.test(body.value) ? '$' + body.value.replace(',', '.') : body.value;
          return resolve({ ok: true });
        }
        reject({ message: 'Ruta desconocida' });
      }, 250);
    });
  }
  function decorate(o){
    const c = JSON.parse(JSON.stringify(o));
    c.total = c.items.reduce(function(s, i){ return s + i.price * i.qty; }, 0);
    c.stage = c.status !== 'Completed' ? 'new' : (c.delivery ? 'done' : (c.paidBy ? 'amount' : 'delivery'));
    c.suggestion = /caracas|chacao|altamira|las mercedes|distrito capital/i.test(c.zona + ' ' + c.estado) ? '$6 (zona de Caracas)' : 'Coordinar por WhatsApp (fuera de Caracas)';
    c.freeDelivery = c.paidBy === 'Tienda';
    return c;
  }
  const M = function(min){ return Date.now() - min * 60000; };
  const demo = [
    { id: '00061', createdMs: M(2), status: 'Pending', customer: 'María Fernanda Rodríguez', phone: '+58 414 1234567', zona: 'Altamira', estado: 'Distrito Capital', items: [{ product: 'Gel Energético Fresa Banano Going', qty: 6, price: 3.23 }, { product: 'Hidratante Uva Going', qty: 9, price: 1.68 }, { product: 'Barra Endurance Chocolate Going', qty: 4, price: 4.10 }, { product: 'Proteína en Polvo Chocolate — Sobre 30 g Going', qty: 1, price: 3.76 }] },
    { id: '00060', createdMs: M(14), status: 'Pending', customer: 'Carlos Pérez', phone: '0424-5550192', zona: 'Valencia', estado: 'Carabobo', ci: 'V-12.345.678', mrw: 'MRW Valencia — Av. Bolívar Norte', items: [{ product: 'Kit Carrera 10K (3 geles + 3 hidratantes + 1 proteína + 1 barra endurance)', qty: 1, price: 18.0 }] },
    { id: '00059', createdMs: M(37), status: 'Pending', customer: 'Andrea Gómez', phone: '+58 412 9876543', zona: 'Pickup', estado: '', items: [{ product: 'Sport Hydration Drink Mix Limón Lima Skratch Labs', qty: 2, price: 3.45 }] },
    { id: '00058', createdMs: M(55), status: 'Completed', customer: 'Luis Hernández', phone: '+58 416 5551122', zona: 'Las Mercedes', estado: 'Distrito Capital', items: [{ product: 'Kit Maratón 42K (9 geles + 6 hidratantes + 1 proteína + 2 barras endurance)', qty: 1, price: 41.05 }] },
    { id: '00057', createdMs: M(90), status: 'Completed', customer: 'Gabriela Silva', phone: '+58 414 7770011', zona: 'Chacao', estado: 'Distrito Capital', paidBy: 'Cliente', items: [{ product: 'Gel Energético Café Going', qty: 3, price: 3.44 }, { product: 'Hidratante Coco Going', qty: 2, price: 1.79 }] },
    { id: '00056', createdMs: M(180), status: 'Completed', customer: 'José Ramírez', phone: '+58 424 3332211', zona: 'Baruta', estado: 'Miranda', paidBy: 'Cliente', delivery: '$6', items: [{ product: 'Barra Endurance Chocolate Going', qty: 2, price: 4.10 }] },
    { id: '00055', createdMs: M(300), status: 'Completed', customer: 'Valeria Castro', phone: '+58 412 1119988', zona: 'Pickup', estado: '', delivery: 'Pickup', items: [{ product: 'Hidratante Pitaya Going', qty: 4, price: 1.68 }] },
    { id: '00054', createdMs: M(420), status: 'Completed', customer: 'Diego Morales', phone: '+58 414 6664433', zona: 'El Hatillo', estado: 'Miranda', paidBy: 'Tienda', delivery: '$6', items: [{ product: 'Kit Gran Fondo (6 geles + 9 hidratantes + 1 proteína + 4 barras endurance)', qty: 1, price: 43.47 }] }
  ];

  /* ---------- Instalable en Android ("Instalar app"): el service worker no guarda nada, solo habilita la instalación ---------- */
  if(!DEMO && 'serviceWorker' in navigator){
    window.addEventListener('load', function(){ navigator.serviceWorker.register('/panel-sw.js', { scope: '/panel.html' }).catch(function(){}); });
  }

  /* ---------- Arranque ---------- */
  if(DEMO){
    document.body.classList.add('is-demo');
    showApp();
    setTimeout(function(){   // en la demostración llega un pedido nuevo a los 12 s, para ver el aviso
      demo.push({ id: '00062', createdMs: Date.now(), status: 'Pending', customer: 'Sofía Blanco', phone: '+58 414 2223344', zona: 'La Castellana', estado: 'Distrito Capital', items: [{ product: 'Gel Energético Granada Going', qty: 3, price: 3.44 }, { product: 'Hidratante Uva Going', qty: 3, price: 1.79 }] });
    }, 12000);
  } else {
    // ¿Ya hay una sesión abierta? Si el servidor no la reconoce (401), pide el código.
    api('/api/panel/orders').then(function(data){
      clockSkew = (data.now || Date.now()) - Date.now();
      orders = data.orders || [];
      $('login').hidden = true; $('app').hidden = false;
      fixStickyOffset(); requestWake(); setLive(true); detectNew(); render(); startPolling(); tick(); setInterval(tick, 30000); pruebaCorreo();
    }).catch(function(err){
      showLogin(err.auth ? '' : (err.message || 'No se pudo conectar con el panel.'));
    });
  }
})();
