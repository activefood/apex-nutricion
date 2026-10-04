# Plan: Nuevos banners del carrusel

Implementa `SPEC-carrusel.md` (aprobada 2026-10-03).

## Enfoque

1. **Maqueta primero.** Una página aparte (`tasks/maqueta-carrusel.html`, fuera del sitio publicado) que usa el `styles.css` real y muestra los 3 banners en celular (393 px) y escritorio (1280 px). Se aprueba antes de tocar `index.html`.
2. **Un patrón de banner, tres instancias.** Una sola estructura HTML (`.hero-slide--promo`: texto + foto de producto) con modificadores por banner. Así el 4º banner futuro es copiar y pegar, no diseñar de cero.
3. **Alto fijo compartido.** Celular: alto fijo para los 3 (texto arriba, producto abajo). Escritorio: dos columnas, mínimo 480 px como hoy. Evita saltos al rotar y mantiene el CLS en 0,015.
4. **Medición al final del carrusel**, aislada en `initHeroCarousel`: `view_promotion` la primera vez que cada banner se activa, y `select_promotion` en clics dentro del banner. Lee `data-promo-*` del HTML, sin datos repetidos en el JS.
5. **Limpieza:** se borran del CSS los estilos de los banners viejos (kit, cápsulas, y los restos sin uso skratch y fastchews). Las imágenes se quedan en el servidor.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Banners en HTML se ven "menos diseñados" que los gráficos actuales | La maqueta se aprueba antes; si no convence, se ajusta ahí, no en producción |
| La foto del producto (LCP) carga más lenta o más rápido que hoy | Primera foto con `fetchpriority="high"`, el resto con carga diferida; medir con Lighthouse antes y después |
| Eventos de GA4 duplicados (cada vuelta del carrusel) | `view_promotion` solo una vez por banner por carga de página |
| Texto largo en celular empuja el botón fuera de pantalla | Criterio 6 de la spec: verificar con Playwright en 393 × 659 |

## Checkpoints

- **A — Maqueta aprobada por ti** → recién ahí se toca `index.html`.
- **B — Banners en el sitio local** → Lighthouse + Playwright + capturas.
- **C — Medición** → eventos verificados en `dataLayer`.
- **D — "Sube todo"** → publicar y verificar en vivo.
