/* ==========================================================================
   Calculadora APEX — datos de productos (separados del motor de cálculo)

   Valores nutricionales: fijos, de las etiquetas revisadas
   (calculadora-apex/PROMPT.md, Etapa 2). No se cambian sin aprobación del
   dueño; cada número tiene su fuente en calculadora-apex/REFERENCIAS.md.

   Precios: copiados de las fichas del sitio el 2026-10-27 (precio de 1 unidad
   y precio total de cada caja x6/x12/x24). Si cambia un precio en una ficha,
   hay que cambiarlo también aquí. El carrito no usa estos precios: cobra lo
   que dicen las fichas y aplica sus propios descuentos.

   Campos:
     carb, na, caf  gramos de carbohidrato, mg de sodio y mg de cafeína por porción
     fru            true si tiene fructosa; null si no aplica
     role           'drink' bebida · 'carb' energía · 'na' sodio · 'pre' solo antes o ultras suaves
     vol            litros por porción (solo bebidas)
     perSell        porciones que trae cada unidad que se vende
     boxes          precio total de cada caja (unidades que se venden, no porciones)
     tienda         cómo se llama el producto en el carrito del sitio (ver addItemToCart en app.js)
   ========================================================================== */

/* ---------- Precio del kit y del pack (lo fija APEX) ----------
   null = automático: suma de los precios del sitio con los descuentos por
   caja que ya existen. Para fijar un precio, escribe el monto en dólares
   (por ejemplo 39.90). */
const CALC_PRECIO_KIT = null;
const CALC_PRECIO_PACK = null;

const CALC_PRODUCTOS = {
  going_hidr: {
    name: 'Going Hidratante', brand: 'going',
    carb: 7, na: 351, caf: 0, fru: false, role: 'drink', vol: 0.75,
    serv: 'sobre en 750 mL', sell: 'sobre', perSell: 1,
    price: 1.79, boxes: { 6: 10.08, 12: 19.80, 24: 38.64 },
    // 1 sobre de 10 g en 750 mL = 351 mg de sodio (confirmado por el fabricante; el sobre dice 115 mg en 250 mL)
    tienda: { pagina: '/producto-going-hidratante.html', marca: 'Going Nutrición', titulo: 'Hidratante {sabor} Going', sabores: ['Uva', 'Coco', 'Pitaya'], foto: 'assets/going/hidratante-sobre-uva.webp' }
  },
  skratch: {
    name: 'Skratch Hydration', brand: 'skratch',
    carb: 20, na: 390, caf: 0, fru: true, role: 'drink', vol: 0.473,
    serv: 'sobre en 473 mL', sell: 'sobre', perSell: 1,
    price: 3.45, boxes: { 6: 19.44, 12: 38.04, 24: 74.64 },
    // 390 mg: promedio de 380 y 400 entre sabores
    tienda: { pagina: '/producto-skratch.html', marca: 'Skratch Labs', titulo: 'Sport Hydration Drink Mix {sabor} Skratch Labs', sabores: ['Limón Lima', 'Fresa Limonada'], foto: 'assets/skratch/hidratacion-fresa-limonada-sticks.webp' }
  },
  going_gel: {
    name: 'Going Gel Café', brand: 'going',
    carb: 19, na: 35, caf: 12.5, fru: false, role: 'carb',
    serv: 'gel', sell: 'gel', perSell: 1,
    price: 3.44, boxes: null,
    // Cafeína: 12,5 mg en café, guayaba y fresa banano (ficha de Going, enviada por el dueño el 2026-10-27).
    // El sitio solo vende el sabor Café, y sin cajas.
    tienda: { pagina: '/producto-going-gel-cafe.html', marca: 'Going Nutrición', titulo: 'Gel Energético {sabor} Going', sabores: ['Café'], foto: 'assets/going/gel-cafe-colombia.webp' }
  },
  hs_gel_fruta: {
    name: 'Honey Stinger Gel', brand: 'hs',
    carb: 24, na: 50, caf: 0, fru: true, role: 'carb',
    serv: 'gel', sell: 'gel', perSell: 1,
    price: 4.50, boxes: { 6: 25.38, 12: 49.68, 24: 97.20 },
    tienda: { pagina: '/producto-honey-gel.html', marca: 'Honey Stinger', titulo: 'Gel Energético Orgánico {sabor} Honey Stinger', sabores: ['Fruit Smoothie', 'Acai Pomegranate'], foto: 'assets/honey/gel-acai-pomegranate.webp' }
  },
  hs_gel_gold: {
    name: 'Honey Stinger Gel Gold', brand: 'hs',
    carb: 24, na: 45, caf: 0, fru: true, role: 'carb',
    serv: 'gel', sell: 'gel', perSell: 1,
    price: 4.50, boxes: { 6: 25.38, 12: 49.68, 24: 97.20 },
    tienda: { pagina: '/producto-honey-gel.html', marca: 'Honey Stinger', titulo: 'Gel Energético Orgánico {sabor} Honey Stinger', sabores: ['Gold'], foto: 'assets/honey/gel-acai-pomegranate.webp' }
  },
  hs_gel_cafe: {
    name: 'Honey Stinger Gel Strawberry Kiwi (cafeína)', brand: 'hs',
    carb: 24, na: 50, caf: 32, fru: true, role: 'carb',
    serv: 'gel', sell: 'gel', perSell: 1,
    price: 4.50, boxes: { 6: 25.38, 12: 49.68, 24: 97.20 },
    tienda: { pagina: '/producto-honey-gel.html', marca: 'Honey Stinger', titulo: 'Gel Energético Orgánico {sabor} Honey Stinger', sabores: ['Strawberry Kiwi'], foto: 'assets/honey/gel-acai-pomegranate.webp' }
  },
  hs_gomitas: {
    name: 'Honey Stinger Gomitas', brand: 'hs',
    carb: 39, na: 60, caf: 0, fru: true, role: 'carb',
    serv: 'bolsa', sell: 'bolsa', perSell: 1,
    price: 5.99, boxes: { 6: 33.78, 12: 66.13, 24: 129.38 },
    tienda: { pagina: '/producto-honey-gomitas.html', marca: 'Honey Stinger', titulo: 'Gomitas Energéticas Orgánicas {sabor} Honey Stinger', sabores: ['Fruit Smoothie', 'Citrus Splash'], foto: 'assets/honey/gomitas-citrus-splash.webp' }
  },
  probar_bolt: {
    name: 'PROBAR Bolt', brand: 'probar',
    carb: 23, na: 75, caf: 0, fru: true, role: 'carb',
    serv: 'media bolsa', sell: 'bolsa', perSell: 2,
    price: 4.29, boxes: { 6: 24.18, 12: 47.40, 24: 92.64 },
    // tiene fructosa: jarabe de tapioca + azúcar de caña
    tienda: { pagina: '/producto-probar-gomas.html', marca: 'Probar', titulo: 'Gomas Energéticas Bolt {sabor} Probar', sabores: ['Fresa', 'Naranja'], foto: 'assets/probar/gomitas-bolt-fresa.webp' }
  },
  hs_waffle: {
    name: 'Honey Stinger Waffle', brand: 'hs',
    carb: 19, na: 70, caf: 0, fru: true, role: 'carb', soloIntensidad: ['baja', 'moderada'],
    serv: 'waffle', sell: 'waffle', perSell: 1,
    price: 3.65, boxes: { 6: 20.59, 12: 40.30, 24: 78.84 },
    // 19 g y 70 mg: promedio de los tres sabores
    tienda: { pagina: '/producto-honey-waffle.html', marca: 'Honey Stinger', titulo: 'Waffle Energético Orgánico {sabor} Honey Stinger', sabores: ['Miel', 'Vainilla', 'Chocolate'], foto: 'assets/honey/waffle-miel.webp' }
  },
  going_barra: {
    name: 'Going Barra Endurance', brand: 'going',
    carb: 28, na: 94, caf: 0, fru: null, role: 'pre',
    serv: 'barra', sell: 'barra', perSell: 1,
    price: 4.10, boxes: { 6: 23.10, 12: 45.24, 24: 88.56 },
    tienda: { pagina: '/producto-going-barra.html', marca: 'Going Nutrición', titulo: 'Barra Endurance {sabor} Going', sabores: ['Chocolate'], foto: 'assets/going/barra-chocolate-mani.webp' }
  },
  ss_caps: {
    name: 'SaltStick Cápsulas', brand: 'ss',
    carb: 0, na: 215, caf: 0, fru: null, role: 'na',
    serv: 'cápsula', sell: 'empaque de 4', perSell: 4,
    price: 4.99, boxes: { 6: 28.14, 12: 55.08, 24: 107.76 },
    tienda: { pagina: '/producto-saltstick-capsulas.html', marca: 'SaltStick', titulo: 'Cápsulas de Electrolitos SaltStick', sabores: [], foto: 'assets/saltstick/capsulas-electrolitos.webp' }
  },
  ss_chews: {
    name: 'SaltStick FastChews', brand: 'ss',
    carb: 2, na: 100, caf: 0, fru: null, role: 'na',
    serv: '2 tabletas', sell: 'sobre de 10', perSell: 5,
    price: 5.99, boxes: { 6: 33.78, 12: 66.12, 24: 129.36 },
    tienda: { pagina: '/producto-saltstick.html', marca: 'SaltStick', titulo: 'Masticables FastChews {sabor} SaltStick', sabores: ['Naranja', 'Frutos Rojos', 'Limonada Rosada', 'Limón Lima'], foto: 'assets/saltstick/fastchews-packet-tartorange.webp' }
  }
};

if(typeof module !== 'undefined') module.exports = { CALC_PRODUCTOS, CALC_PRECIO_KIT, CALC_PRECIO_PACK };
