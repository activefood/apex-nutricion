# Design System: Apex Nutrición

> Fuente de verdad del estilo visual de apexnutricionve.com. Documenta el sistema
> que **ya existe** en `styles.css` — no es una propuesta. Cualquier página nueva
> (hecha a mano, con Claude, Stitch u otra IA) debe verse como parte de este sitio.
> Si `styles.css` y este archivo no coinciden, gana `styles.css` y se corrige este archivo.
>
> Reglas de calidad (accesibilidad, rendimiento): ver `CONSTRAINTS.md`.

## 1. Visual Theme & Atmosphere

Tienda deportiva venezolana con alma de **ficha técnica de atleta**: blanco cálido,
tinta casi negra, esquinas rectas, líneas finas en vez de sombras, y **un solo acento
lima eléctrico** (como The Feed) usado en fondos de botones y etiquetas, nunca como letra
sobre blanco. El resto del color lo ponen los empaques de los productos. Se siente como el tablero de una carrera —
números claros, etiquetas en mayúsculas espaciadas, datos nutricionales en
tipografía monoespaciada — no como una tienda de lujo ni como una app de tecnología.

- **Densidad: 4/10 — "Daily App Balanced".** Grillas de producto de 4 columnas en
  escritorio y 2 en celular, con aire entre secciones (64px) pero sin desperdiciar
  pantalla: la mayoría de los clientes llega desde Instagram en el celular.
- **Variación: 3/10 — "Predictable Symmetric".** Grillas regulares y alineadas. La
  personalidad viene de la tipografía (Anton en mayúsculas) y de la lima sobre tinta,
  no de layouts asimétricos.
- **Movimiento: 2/10 — "Static Restrained".** Transiciones cortas de 140ms en hover
  y foco. El único movimiento automático es el carrusel del inicio, con pausa.
- **Idioma:** español de Venezuela (`lang="es-VE"`). Precios en dólares con coma
  decimal (`$3,44`) y equivalente en bolívares a tasa BCV (`≈ Bs 2.980,97`).

## 2. Color Palette & Roles

### Neutros (cálidos — nunca mezclar con grises fríos)
- **Tinta Carbón** (#14120F) `--ink` — Texto principal, títulos, botones primarios, etiqueta "Más vendido", barra de anuncio.
- **Tinta Media** (#514D48) `--ink-2` — Texto de párrafos, descripciones, píldoras inactivas.
- **Tinta Suave** (#726E67) `--ink-3` — Metadatos: marca sobre el producto, migas de pan, "≈ Bs", títulos del footer. Es el gris más claro permitido para texto (5.1:1 sobre blanco).
- **Papel Blanco** (#FFFFFF) `--paper` — Fondo principal y de tarjetas.
- **Papel Arena** (#F7F5F1) `--paper-2` — Footer, secciones alternas, fondos de inputs.
- **Papel Lino** (#EFEBE3) `--paper-3` — Superficies terciarias.
- **Línea Hueso** (#E4DFD5) `--line` — Bordes de 1px de tarjetas, píldoras, inputs. Es la forma principal de separar elementos.
- **Línea Foto** (#DCDFE5) `--card-media-line` — Borde de las tarjetas de producto.

### Acento: Lima (desde 2026-10-04, reemplaza al coral)
- **Lima** (#D8F24C) `--accent` — El color de la marca, estilo The Feed. **Solo como fondo** con texto Tinta Carbón encima (14.9:1): botón principal del carrusel, etiqueta "Nuevo", contador del carrito; o como texto/detalle **sobre fondos oscuros** (eyebrow del carrusel, "10% OFF / APEX2026" en la barra de anuncio).
- **Lima Hover** (#C4DE36) `--accent-dk` — Hover de fondos lima. Nunca como color de letra.
- **Lima Bruma** (#F5FBD9) `--accent-sf` — Fondo suave (aviso del cupón en el carrito).
- **Tinta de acento** (#14120F) `--accent-text` — Todo lo que antes era coral **sobre blanco**: eyebrows ("01 · ANTES"), "Ver todo →", "Limpiar filtros", estrellas, barras de rating, viñetas, checkboxes y anillo de foco. Los enlaces y el menú se **subrayan** al pasar el mouse.
- **Regla:** la lima sobre blanco es casi invisible (1.3:1) — nunca como letra, ícono, estrella ni borde sobre fondos claros. Nada de coral (#FF7A47) en ninguna parte.

### Semánticos (solo para su significado)
- **Verde OK** (#17724A) sobre (#E8F2EC) — "Agregado ✓", envío gratis, descuento aplicado.
- **Ámbar Aviso** (#8A6510) sobre (#FBF3DD) — Avisos.
- **Rojo Oferta / Error** (#B3261E) sobre (#FDECEB) — Errores de cupón, precios de oferta. Error de checkout: (#C0392B).
- **Verde WhatsApp** (#1D8548) — Solo el botón flotante "¿Dudas? Escríbenos".

### Colores de marcas representadas (solo como identificador de esa marca)
Going (#3F7D5C) · Probar (#35618C) · Skratch Labs (#8C6B35) · SaltStick (#6A5B8C) · Honey Stinger (#C98A2B).
Nunca se usan como acento general del sitio.

## 3. Typography Rules

- **Display — Anton** (`--font-head`): condensada, en mayúsculas, con tracking abierto (`letter-spacing: .05em`). **Solo** para títulos grandes de verdad:
  - `.h-46` 46px (34px en celular) · `.h-36` 36px (28px) · `.h-28` 28px · `.h-22` 22px · `.h-18` 18px · título de producto `.pdp-title` 31px.
  - Nunca por debajo de 18px: Anton chica se vuelve ilegible.
- **Texto — Inter** (`--font-body`): todo lo demás. Base 16px, interlineado 1.55. Pesos 400 / 500 / 600 / 700 / 800 (precios). Párrafos en Tinta Media.
  Títulos pequeños (nombres de producto, "Resumen del pedido", títulos del footer) también van en Inter, no en Anton.
- **Datos — Space Mono** (`--font-mono`): datos nutricionales en cajita ("19 g carbohidratos · 35 mg sodio"), botones "AGREGAR AL CARRITO". Refuerza el tono de ficha técnica.
- **Garabato — Permanent Marker** (rojo #E0261C, 19px, con una flecha dibujada): solo la nota manuscrita del armador de cajas surtidas en las fichas de producto. Se carga únicamente en esas 11 páginas. No usar en otro lugar.
- **Etiquetas / eyebrows:** Inter 10.5–11px, 700, MAYÚSCULAS, `letter-spacing: .08–.12em`.
- **Números:** precios, totales y cantidades con `font-variant-numeric: tabular-nums`.
- **Títulos:** `text-wrap: balance` (sin palabras sueltas en la última línea).
- **Tipografía:** `…` (no `...`), comillas “ ” en citas, `Cargando…` en estados de carga.

## 4. Component Stylings

* **Botón primario** (`.btn--primary`): 44px de alto, padding 0 24px, Inter 14px 600, fondo negro con un degradado mínimo (#000 → #2B2B2B, 135°), texto blanco, esquinas de 2px. Hover: negro plano. Sin sombra ni brillo.
* **Botón secundario** (`.btn--ghost`): transparente, borde 1.5px Línea Hueso, texto Tinta Carbón. Hover: el borde pasa a Tinta Carbón.
* **Botón "Agregar al carrito" de tarjeta:** ancho completo, Space Mono 11px 700 en mayúsculas, fondo Tinta Carbón. Al agregar cambia a "Agregado ✓" en Verde OK por 1.4s y se anuncia a lectores de pantalla.
* **Tarjeta de producto:** borde 1px Línea Foto, esquinas de 2px, sin sombra. Foto cuadrada (`aspect-ratio: 1`) sobre blanco con 12px de aire; debajo, marca (eyebrow), nombre (Inter 14.5px 600), cajita de datos en Space Mono y precio (16px 800) con su equivalente en Bs. Hover: sube 3px. El botón de agregar va **fuera** del enlace de la tarjeta.
* **Tarjetas de contenido** (fases, reseñas): borde 1px Línea Hueso, 24–32px de padding, sin sombra.
* **Píldoras** (filtros, presentaciones "Caja x6"): 28px de alto, borde 1px, Inter 12.5px 600. Activa: fondo Tinta Carbón y texto blanco.
* **Etiquetas sobre fotos:** "Más vendido" (fondo tinta, texto blanco), "Nuevo" (fondo lima, texto tinta). 10.5px, mayúsculas.
* **Inputs:** label arriba (Inter 12px 700, Tinta Media), 40–44px de alto, borde 1px Línea Hueso, esquinas de 2px. Foco: anillo de 2px tinta con 2px de separación (blanco sobre fondos oscuros). Error: mensaje debajo del campo en rojo, el borde del campo pasa a rojo (`aria-invalid`).
* **Encabezado:** 70px, blanco, borde inferior de 1px, fijo arriba (sticky). Arriba de él, barra de anuncio negra de 36px.
* **Footer:** fondo Papel Arena, borde superior de 1px; títulos de columna en eyebrow de Tinta Suave.
* **Menú desplegable:** "sombra" dura de bloque `0 4px 0 0 #14120F`.
* **Banner del carrusel** (`.hero-slide--promo`, ver `SPEC-carrusel.md`): **fondo Tinta Carbón en los tres banners** (un solo color, como The Feed), texto real a la izquierda en blanco (eyebrow en lima → título Anton de una línea → dato concreto → precio o cupón → botón principal lima con texto tinta, secundario con borde blanco) y 2–3 fotos de producto recortadas con fondo transparente (`assets/banners/`) a la derecha, inclinadas y con sombra suave. En celular: texto arriba, fotos abajo, proporción 3:4. Cupón: código en Space Mono dentro de un recuadro punteado blanco de 1.5px. Un botón por banner (excepción: dos cuando cada uno lleva a un producto distinto). Máximo 3 banners.
* **Controles flotantes sobre fotos** (flechas y pausa del carrusel): círculo blanco de 44px (36px en tablet; ocultos en celular, salvo la pausa), borde 1px, sombra suave.
* **Sabor seleccionado** (`.flavor-card` activa): borde de tinta de 2px (borde + `box-shadow: 0 0 0 1px`).
* **Estado vacío del carrito:** ícono de línea, título, una frase y un botón "Ir a comprar". Al eliminar un producto aparece "Deshacer".

## 5. Layout Principles

- **Contenedor:** máximo 1280px, centrado, 24px de margen lateral.
- **Secciones:** 64px de padding vertical; alternan blanco y Papel Arena.
- **Grillas:** producto 4 columnas (gap 20px) → 2 columnas en celular (gap 12px). Promociones en mosaico de 4 → 2.
- **Espaciado:** escala de 4px — 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96px (`--sp-1` a `--sp-9`).
- **Esquinas:** rectas. Botones, tarjetas, inputs, etiquetas y píldoras usan 2px (`--r-control`, `--r-card`, `--r-pill`). Excepciones fijas:
  - Círculo (50%): botones de solo ícono que flotan (flechas y pausa del carrusel, redes sociales, flechas del selector de sabores) y puntos indicadores.
  - 6px: fotos de producto dentro de su caja (3px en miniaturas).
  - Cápsula (999px): solo la insignia de descuento ("-6%") y el botón flotante de WhatsApp.
- **Profundidad:** la jerarquía se marca con bordes de 1px, cambio de fondo y peso tipográfico — no con sombras. Las únicas sombras son para **controles que flotan sobre fotos** y para las **fotos de producto recortadas del carrusel** (`drop-shadow(0 10px 14px rgba(0,0,0,.35))`, para que no se vean pegadas al fondo oscuro), para que se lean sobre cualquier imagen: flechas y puntos del carrusel (`0 2px 10px rgba(0,0,0,.18)`) y el botón de WhatsApp (`0 6px 18px rgba(20,18,15,.22)`). Más la sombra de bloque del menú desplegable.
- **Puntos de quiebre:** 1024px (tablet), 768px (celular), 640px / 480px (celular chico). Diseñar primero para 375–390px de ancho.
- **Imágenes:** formato WebP, con `width`/`height` reales (evita saltos de layout), `loading="lazy"` fuera de la primera pantalla, tamaño de archivo ≤ 2× (escritorio) / 3× (celular) del tamaño en pantalla.
- **Accesibilidad:** áreas táctiles de 44px, `aria-label` en botones de solo ícono, íconos decorativos con `aria-hidden`, enlace "Saltar al contenido", un `<h1>` por página sin saltar niveles de encabezado.

## 6. Motion & Interaction

- **Duración única:** 140ms `ease` (`--ease`) para color, borde, fondo y `transform`. Nunca `transition: all`.
- **Hover:** tarjetas suben 3px; botones oscurecen; bordes pasan de hueso a tinta.
- **Foco visible:** anillo de 2px tinta en todos los controles (`:focus-visible`); blanco dentro del carrusel.
- **Carrusel del inicio:** cambia cada 3.5s, se pausa con hover/foco, tiene botón de pausa, y no se mueve si el usuario pidió movimiento reducido. Los puntos van en su propia fila debajo del banner.
- **Carrusel del inicio:** cada banner (`.hero-slide--promo`) dura 3.5s. Al activarse, sus fotos de producto **caen una tras otra** (700ms, 120ms de diferencia, leve rebote) y quedan inclinadas entre −7° y +8° — inspirado en The Feed, hecho con CSS (`promo-entrada`). Es la **única animación de entrada permitida** del sitio; no se anima con "reducir movimiento".
- **Sin animaciones decorativas en bucle,** sin parallax, sin animaciones de entrada al hacer scroll.

## 7. Anti-Patterns (Banned)

- Sin esquinas redondeadas grandes ni botones en forma de cápsula — 2px, salvo las excepciones listadas en Layout.
- Sin sombras en tarjetas, botones o secciones; sin brillos ni resplandores. Sombra solo en controles que flotan sobre fotos y en los productos recortados del carrusel.
- Sin un color de fondo distinto por banner del carrusel: los tres van en Tinta Carbón (decidido 2026-10-04 tras comparar con un color por producto). El color lo ponen los empaques.
- Sin segundo color de acento: ni coral, ni morados, azules o degradados "de IA". Los colores de las marcas representadas no se usan como acento del sitio.
- Sin lima como letra, ícono o borde sobre fondos claros (1.3:1).
- Sin grises por debajo de #726E67 para texto, y sin grises fríos (azulados) mezclados con los cálidos.
- Sin Anton por debajo de 18px ni en párrafos.
- Sin texto de relleno: nada de "Scroll para explorar", flechas que rebotan ni "Lorem ipsum".
- Sin clichés de copy de IA ("Eleva tu rendimiento al siguiente nivel", "sin fricciones", "revoluciona"). El tono es directo y concreto: gramos, miligramos, minutos.
- Sin reseñas, ratings o números inventados — solo datos reales (reseñas de Instagram con su usuario, ratings del formulario real).
- Sin enlaces `href="#"` que no lleven a ningún lado.
- Sin botones dentro de enlaces ni `<div>` clicables — `<button>` para acciones, `<a>` para navegar.
- Sin bloquear el pegado en inputs. (El zoom manual está bloqueado por una excepción documentada en `CONSTRAINTS.md`; no extender ese bloqueo a nada más.)
- Emojis: solo en la barra de anuncio promocional (🎉) — nunca en navegación, botones ni contenido de producto.

## 8. Inconsistencias conocidas (pendientes, no copiar)

- `.btn--primary` usa negro puro (#000) en su degradado en vez de Tinta Carbón (#14120F). Las páginas nuevas deben usar el botón existente tal cual; si se rediseña, unificar a `--ink`.
- `--spark` (#D8F24C, verde lima) está definido pero solo lo usa `.hero-copy`, que hoy no aparece en ninguna página.
- `.hero-slide-media img` (esquinas de 18px, sombra `0 30px 60px`) es de un diseño anterior del carrusel y no se usa en ninguna página. No tomarlo como referencia.
- Los inputs de búsqueda, checkout y cupón usan 13–13.5px; está ligado a la excepción del zoom en `CONSTRAINTS.md`.
