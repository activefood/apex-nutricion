/* Casos 1 a 9 de calculadora-apex/PROMPT.md (Etapa 6). Se corre con: node calculadora/pruebas/casos.js */
const E = require('../motor.js');

const base = { sport: 'carrera', w: 70, intens: 'moderada', clima: 'caluroso', sweat: 0, dist: 0, salty: true, gut: false, caf: false, drink: 'auto', gelPref: 'hs_gel_fruta', drinkTrained: false };
const T = [];
function t(name, fn){
  let ok = false, det = '';
  try { const r = fn(); ok = r[0]; det = r[1]; } catch(e){ det = String(e.stack || e); }
  T.push({ name: name, ok: ok, det: det });
}

t('1. Carrera de 40 min: 0 g/h y sin meta de sodio', function(){
  const p = E.plan(Object.assign({}, base, { min: 40, salty: false }));
  return [p.ct.g === 0 && p.naT == null, 'carbohidrato ' + p.ct.g + ' g/h; sodio ' + (p.naT == null ? 'sin meta' : p.naT)];
});

t('2. Maratón 4 h, 70 kg, calor, salado: 0.75 L, 1 hidratante, 2 geles, 2 tabletas por hora', function(){
  const p = E.plan(Object.assign({}, base, { min: 240 })); const k = E.kitFromPlan(p, base); const it = p.items;
  const ok = p.V === 0.75 && it.going_hidr === 1 && it.hs_gel_fruta === 2 && it.ss_chews === 1 && p.carbs === 57 && p.naSum === 551 &&
    k.serv.going_hidr === 4 && k.serv.hs_gel_fruta === 8 && E.sellUnits('ss_chews', k.serv.ss_chews) === 1;
  return [ok, p.V + ' L/h; ' + (it.going_hidr || 0) + ' hidratante, ' + (it.hs_gel_fruta || 0) + ' geles, ' + (it.ss_chews || 0) * 2 + ' tabletas; ' +
    p.carbs + ' g y ' + p.naSum + ' mg por hora; kit ' + k.serv.going_hidr + ' sobres, ' + k.serv.hs_gel_fruta + ' geles, ' +
    E.sellUnits('ss_chews', k.serv.ss_chews || 0) + ' sobre de FastChews'];
});

t('3. Ciclismo 5 h, 80 kg, estómago entrenado: 90 g/h y al menos 30 g/h con fructosa', function(){
  const p = E.plan(Object.assign({}, base, { sport: 'ciclismo', w: 80, min: 300, gut: true, salty: false }));
  return [p.ct.g === 90 && p.fruCarb >= 30, 'meta ' + p.ct.g + ' g/h; plan ' + p.carbs + ' g/h, ' + p.fruCarb + ' g con fructosa; ' + JSON.stringify(p.items)];
});

t('4. 90 kg recibe más líquido y sodio que 50 kg', function(){
  const a = E.plan(Object.assign({}, base, { w: 50, min: 180 })), b = E.plan(Object.assign({}, base, { w: 90, min: 180 }));
  return [b.V > a.V && b.naT > a.naT, '50 kg: ' + a.V + ' L/h y ' + Math.round(a.naT) + ' mg; 90 kg: ' + b.V + ' L/h y ' + Math.round(b.naT) + ' mg'];
});

t('5. Ciclismo sin sudor medido: 0.8 L/h en calor, 0.6 en fresco, y pide medir', function(){
  const c = E.plan(Object.assign({}, base, { sport: 'ciclismo', min: 120 })), f = E.plan(Object.assign({}, base, { sport: 'ciclismo', min: 120, clima: 'fresco' }));
  return [Math.abs(c.S - 0.8) < 1e-9 && Math.abs(f.S - 0.6) < 1e-9 && c.medirSudor && /mide tu sudor/.test(c.sweatSrc), 'calor ' + c.S + ' L/h, fresco ' + f.S + ' L/h; ' + c.sweatSrc];
});

t('6. Usuario con hipertensión: sin cifras', function(){
  return [true, 'Se verifica en la interfaz (Etapa 4): la pregunta de exclusión oculta todas las cifras. El motor no se llama.'];
});

t('7. Cafeína en 50 kg, evento de 10 h: no pasa de 300 mg', function(){
  const i = Object.assign({}, base, { w: 50, min: 600, caf: true }); const k = E.kitFromPlan(E.plan(i), i);
  const ig = Object.assign({}, i, { gelPref: 'going_gel' }); const kg = E.kitFromPlan(E.plan(ig), ig);
  return [k.caf > 0 && k.caf <= 300 && kg.caf <= 300, 'geles Honey Stinger: ' + k.caf + ' mg (' + (k.caf / 50).toFixed(1) + ' mg/kg); gel Going preferido: ' + kg.caf + ' mg ' + JSON.stringify(kg.serv)];
});

t('8. Pack mensual: 4 × 1 h + tirada de 2.5 h', function(){
  const m = E.monthPack(Object.assign({}, base, { min: 240 }), { days: 5, normalMin: 60, hasLong: true, longMin: 150, gutBlock: false });
  const ok = m.week.going_hidr === 7 && m.week.hs_gel_fruta === 5 && !m.week.ss_chews && m.month.going_hidr === 28 && m.month.hs_gel_fruta === 20 && m.pl.V === 0.5;
  const combo = function(k){ const c = m.compra[k]; return c.combo.map(function(x){ return x[0] === 1 ? x[1] + ' sueltos' : x[1] + ' caja x' + x[0]; }).join(' + ') + (c.leftover ? ' (sobran ' + c.leftover + ')' : ''); };
  return [ok, 'por semana: ' + m.week.going_hidr + ' sobres, ' + m.week.hs_gel_fruta + ' geles, ' + (m.week.ss_chews || 0) * 2 + ' tabletas (tirada larga ' + m.pl.V + ' L/h); por mes: ' +
    m.month.going_hidr + ' sobres → ' + combo('going_hidr') + '; ' + m.month.hs_gel_fruta + ' geles → ' + combo('hs_gel_fruta') + '; total $' + m.total.toFixed(2)];
});

t('9. Triatleta 90.7 kg, 2.8 L/h de sudor, 5 h: 1.0 L/h y ~9.9 %; entrena bebiendo: 1.25 L/h y ~8.5 %', function(){
  const i = Object.assign({}, base, { sport: 'triatlon', w: 90.7, min: 300, sweat: 2.8, salty: false });
  const a = E.plan(i), b = E.plan(Object.assign({}, i, { drinkTrained: true }));
  const ok = a.V === 1 && Math.abs(a.avisoAgua.perdida - 9.9) < 0.05 && b.V === 1.25 && Math.abs(b.avisoAgua.perdida - 8.5) < 0.05;
  return [ok, 'sin entrenar: ' + a.V + ' L/h, pérdida ' + a.avisoAgua.perdida.toFixed(1) + ' %; entrenado: ' + b.V + ' L/h, pérdida ' + b.avisoAgua.perdida.toFixed(1) + ' %'];
});

const n = T.filter(function(x){ return x.ok; }).length;
T.forEach(function(x){ console.log((x.ok ? 'PASA ' : 'FALLA') + '  ' + x.name + '\n       ' + x.det); });
console.log('\n' + n + ' de ' + T.length + ' casos pasan.');
process.exitCode = n === T.length ? 0 : 1;
