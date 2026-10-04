# Tareas: Nuevos banners del carrusel

- [x] 1. Maqueta de los 3 banners
  - Acceptance: `tasks/maqueta-carrusel.html` muestra los 3 banners en celular y escritorio, con textos y precios reales y estilos de `DESIGN.md`.
  - Verify: capturas con Playwright (393 px y 1280 px) enviadas al dueño → **aprobación (checkpoint A)**.
  - Files: `tasks/maqueta-carrusel.html`

- [x] 2. Banners en `index.html` + estilos
  - Acceptance: exactamente 3 diapositivas en el orden de la spec; Caracas Rock y Cápsulas fuera; texto real; botones ≥ 44 px; mismo alto en los 3.
  - Verify: Playwright (contenido, enlaces, autoplay, pausa, puntos) + Lighthouse `index.html` (rend. ≥ 82, acc. ≥ 93, CLS ≤ 0,015).
  - Files: `index.html`, `styles.css`

- [x] 3. Medición de promociones
  - Acceptance: `view_promotion` una vez por banner visto; `select_promotion` por clic; parámetros `promotion_id`, `promotion_name`, `creative_slot`.
  - Verify: Playwright leyendo `window.dataLayer` tras rotar y hacer clic.
  - Files: `app.js`

- [x] 4. Limpieza y documentación
  - Acceptance: sin CSS de banners viejos; `DESIGN.md` documenta el patrón `.hero-slide--promo`; versiones de caché subidas.
  - Verify: `grep` sin referencias a `kit-banner`, `capsulas-banner`, `skratch-banner` ni `fastchews-banner`; `npm run check:fast`; `npm run check:task`.
  - Files: `styles.css`, `DESIGN.md`, `*.html` (versión)

- [ ] 5. Publicar (solo con "Sube todo")
  - Acceptance: en vivo en apexnutricionve.com.
  - Verify: Playwright contra producción (iPhone 15): 3 banners, enlaces correctos, sin imágenes rotas.
