# CONSTRAINTS.md — Apex Nutrición

Contexto del negocio: la mayoría de los clientes compran desde el celular,
llegando por anuncios de Instagram. Por eso el móvil pesa más que el
escritorio en todo este documento — no hay una versión "desktop-first" de
estas reglas.

## Piso (siempre, sin importar la dimensión)

- El sitio carga y no rompe el flujo de compra (producto → carrito → WhatsApp).
- `npm run check:fast` antes de subir cualquier cambio — detecta secretos
  evidentes en el diff (ver sección Herramientas, por qué no es gitleaks).
- Nunca se baja un número de este archivo para que un cambio pase. Si un
  piso ya no tiene sentido, se discute y se edita este archivo a mano, no
  se ignora en silencio.

## Dimensiones exigidas: Performance + Accesibilidad (móvil)

Elegidas en la entrevista de `/constraints` del 2026-10-01, porque:
- Performance: tráfico de Instagram Ads en celular, con conexiones a veces
  lentas en Venezuela — ya tuvimos bugs reales de imágenes sin comprimir
  esta misma sesión.
- Accesibilidad: zoom, tamaño de texto y contraste importan más en celular
  que en desktop, y ya hubo un bug real de zoom descontrolado en iPhone.

**Modo: solo avisar, nunca bloquear.** No hay CI ni pipeline hoy — el sitio
se sube directo a producción de forma iterativa. Bloquear frenaría arreglos
urgentes. Los `⚠️` de los scripts son para leer, no para ignorar.

**Números: medidos, no inventados.** Se corrió Lighthouse móvil real (ver
`scripts/thresholds.json`) y esos valores, con un margen para el ruido, son
el piso — que no empeore, no que llegue a un ideal abstracto.

| Página | Performance (piso) | Accesibilidad (piso) | Antes (2026-10-01) |
|---|---|---|---|
| `index.html` | 95 | 95 | 74 / 81 |
| `categoria.html?cat=hidratacion` | 92 | 93 | 73 / 89 |
| `producto.html` | 93 | 91 | 74 / 85 |
| `carrito.html` | 91 | 95 | 90 / 89 |
| Cualquier otra página | 85 | 88 | 70 / 80 |

**Subidos el 2026-11-04.** Medido con `node scripts/check-performance.mjs`
sobre 12 páginas, 3 pasadas. Cómo se fija cada número:
- Performance = mínimo de las 3 pasadas − 4 puntos de margen (el ruido
  normal entre corridas es de 2 a 5 puntos; el carrito dio 100, 95 y 98).
- Accesibilidad = el valor medido (no varió entre pasadas).
- "Cualquier otra página" queda por debajo del mínimo medido en las otras 8
  páginas (rendimiento 92, accesibilidad 91), porque hay páginas no medidas
  que pueden ser algo distintas.

**Por qué subieron tanto: cambió el método y cambió el sitio.**
- *El método.* Los pisos del 2026-10-01 se midieron con un servidor local
  que mandaba el HTML y el CSS **sin comprimir**, y por eso medía un sitio
  más lento que el real (el CSS pesaba 103 KB en vez de los ~21 KB que baja
  un celular desde Cloudflare). Ahora `check-performance.mjs` comprime con
  gzip como Cloudflare. El chequeo sigue corriendo ANTES de subir, sobre el
  árbol de trabajo local, no contra producción.
- *El sitio.* Fuentes propias en vez de Google Fonts y fin de las
  descargas dobles de imágenes (`?v=`), el 2026-11-04.

Contra producción (`apexnutricionve.com`, Lighthouse móvil, mediana de 5
corridas, 2026-11-04) el sitio da 97 en home, ficha y carrito. Los números
locales siguen sin ser idénticos a los de producción, pero ya no se
distancian por un servidor distinto.

Reconsiderar estos números con una medición nueva si cambia algo estructural
(CSS/JS compartido, no solo contenido de una página). Sustituir
`--measure-baseline` por el criterio de arriba: ese flag guarda el valor
exacto medido, sin margen, y dispararía falsas alarmas.

## Métricas solo-medición (sin piso todavía)

LCP, CLS y TBT se imprimen en cada corrida pero no tienen un número
exigido. Referencia contra producción (2026-11-04, mediana de 5 corridas):
LCP home 2,39 s, ficha 2,47 s, carrito 2,01 s (Google considera "bueno"
hasta 2,5 s); la home dio 3,6 s en 2 de 5 corridas, así que un piso estricto
daría falsas alarmas. Si se quiere un piso real, hay que medirlo contra
producción (`apexnutricionve.com`), no contra el servidor local.

## Excepciones

| Qué | Por qué | Dueño | Vence |
|---|---|---|---|
| `maximum-scale=1.0` en el viewport de las 29 páginas dispara la falla de accesibilidad "`[user-scalable="no"]`/`maximum-scale` < 5" en Lighthouse, en todas las páginas. | Decisión consciente del 2026-09-30: varios clientes reportaron un zoom descontrolado en iPhone que frenaba ventas; bloquear el zoom manual fue el arreglo que lo resolvió. Cambiar esto reabre ese bug. | Dueño del negocio (Claudio) | Sin vencimiento — revisar solo si Apple cambia cómo iOS maneja el zoom automático, o si aparece una forma de bloquear el zoom automático sin bloquear también el manual. |

## Herramientas

- **Performance + Accesibilidad → Lighthouse** (`lighthouse` + `chrome-launcher`
  en `devDependencies`). Un solo lanzamiento de Chrome cubre las dos
  categorías porque la categoría "accessibility" de Lighthouse corre
  axe-core por debajo — no hace falta una herramienta aparte para eso.
  Requiere Google Chrome instalado localmente (ya lo está).
- **Secretos → escáner propio por patrones**, no gitleaks. Gitleaks es la
  herramienta de facto para esto, pero este entorno no tiene Homebrew ni el
  binario instalado, y bajar un binario nuevo a mano no encajaba con un
  chequeo que debe correr en segundos. Si en algún momento se instala
  gitleaks (`brew install gitleaks`), reemplazar `check:fast` por
  `gitleaks detect --redact` y borrar `scripts/check-secrets.mjs` — es
  estrictamente mejor que el escáner casero.
- No hay linter ni test runner en el proyecto (es HTML/CSS/JS estático sin
  build step) — no se inventó una dimensión de "coverage" ni de "lint"
  porque no hay nada real detrás, por eso no están en este documento.

## Dónde corre cada chequeo

| Chequeo | Comando | Cuándo | Tiempo medido |
|---|---|---|---|
| Secretos | `npm run check:fast` | Loop de edición, antes de cada commit | ~0.3s |
| Performance + Accesibilidad | `npm run check:task` | Al terminar una tarea, antes de pedir "Sube todo" | ~35-40s (4 páginas) |
| Performance + Accesibilidad, set completo | `npm run check:full` | Revisión manual, no en cada tarea | ~35-40s (mismas 4 páginas representativas; usar páginas explícitas como argumento para cubrir otras) |

`check:task` sin argumentos prueba solo las páginas `.html` que cambiaron
en el working tree (`git diff --name-only HEAD`). Si no cambió ninguna
página HTML (p. ej. un cambio solo en `app.js` o `styles.css`, que afecta a
las 29), cae al set representativo de 4 páginas de arriba. Para probar una
página puntual: `node scripts/check-performance.mjs producto-saltstick.html`.
