/* 5,000 perfiles al azar contra las reglas que nunca se pueden violar (calculadora-apex/CLAUDE.md, regla 7).
   Se corre con: node calculadora/pruebas/estres.js */
const E = require('../motor.js');

let seed = 42;
const rnd = function(){ seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = function(a){ return a[Math.floor(rnd() * a.length)]; };
const N = 5000; const fails = {};
const note = function(k, ex){ (fails[k] = fails[k] || []).push(ex); };
const devCarb = [];

for(let i = 0; i < N; i++){
  const inp = {
    sport: pick(['carrera', 'ciclismo', 'triatlon', 'otro']), min: Math.round(20 + rnd() * 880), w: Math.round(45 + rnd() * 75),
    intens: pick(['baja', 'moderada', 'alta']), clima: pick(['fresco', 'caluroso']),
    sweat: rnd() < 0.4 ? Math.round((0.3 + rnd() * 2.2) * 100) / 100 : 0, dist: 0, salty: rnd() < 0.5, gut: rnd() < 0.5, caf: rnd() < 0.3,
    drink: pick(['auto', 'going_hidr', 'skratch', 'agua']), gelPref: pick(['hs_gel_fruta', 'hs_gel_gold', 'going_gel', 'hs_gomitas', 'probar_bolt', 'hs_waffle']),
    drinkTrained: rnd() < 0.3
  };
  if(inp.sport === 'carrera' && rnd() < 0.5) inp.dist = Math.round(inp.min / 60 * (7 + rnd() * 9) * 10) / 10;
  const p = E.plan(inp); const k = E.kitFromPlan(p, inp); const tag = JSON.stringify(inp);
  const cap = inp.gut ? 90 : 60;
  const nonFru = p.carbs - p.fruCarb;
  const drinkVol = p.drink !== 'agua' ? (p.items[p.drink] || 0) * E.P[p.drink].vol : 0;

  if(p.V > p.S + 1e-9) note('líquido > sudor', tag);
  if(p.V > (inp.drinkTrained ? 1.25 : 1.0) + 1e-9) note('líquido > tope', tag);
  if(drinkVol > p.S + 1e-9) note('bebida > sudor', tag);
  if(p.carbs > cap + 1e-9) note('carbohidrato > tope (' + cap + ' g/h)', { inp: inp, carbs: p.carbs, items: p.items });
  if(nonFru > 60 + 1e-9) note('carbohidrato sin fructosa > 60 g/h', { inp: inp, nonFru: nonFru, items: p.items });
  if(k.caf > E.CAF_TOPE_MG_KG * inp.w + 1e-9) note('cafeína > 6 mg/kg', { inp: inp, caf: k.caf, serv: k.serv });
  if(!inp.caf && k.caf > 0) note('cafeína sin pedirla', { inp: inp, serv: k.serv });
  if(inp.intens === 'alta' && p.items.hs_waffle) note('waffle a intensidad alta', tag);
  for(const kk in p.items) if(!(p.items[kk] > 0)) note('cantidad no positiva', tag);
  if(p.ct.g > 0) devCarb.push(p.carbs - p.ct.g);
  const ev = E.schedule(p, k, inp.min);
  ev.forEach(function(e){ if(e.t < 0 || e.t > inp.min + 1e-9) note('toma fuera del evento', tag); });
}

console.log('Perfiles: ' + N);
const keys = Object.keys(fails);
if(!keys.length) console.log('Ninguna violación.');
keys.forEach(function(k){ console.log('FALLA ' + k + ': ' + fails[k].length + ' perfiles. Ejemplo: ' + JSON.stringify(fails[k][0]).slice(0, 400)); });
const s = devCarb.slice().sort(function(a, b){ return a - b; });
const q = function(f){ return Math.round(s[Math.floor((s.length - 1) * f)]); };
console.log('Carbohidrato del plan menos la meta (g/h) — mín ' + q(0) + ', p5 ' + q(0.05) + ', mediana ' + q(0.5) + ', p95 ' + q(0.95) + ', máx ' + q(1));
process.exitCode = keys.length ? 1 : 0;
