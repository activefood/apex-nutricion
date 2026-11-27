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
- **Lima** (#D8F24C) `--accent` — El color de la marca, estilo The Feed. **Solo como fondo** con texto Tinta Carbón encima (14.9:1): botón principal del carrusel, etiqueta "Nuevo", contador del carrito; o como texto/detalle **sobre fondos oscuros** ("10% OFF / APEX2026" en la barra de anuncio).
- **Lima Hover** (#C4DE36) `--accent-dk` — Hover de fondos lima. Nunca como color de letra.
- **Lima Bruma** (#F5FBD9) `--accent-sf` — Fondo suave (aviso del cupón en el carrito).
- **Tinta de acento** (#14120F) `--accent-text` — Todo lo que antes era coral **sobre blanco**: eyebrows ("01 · ANTES"), "Ver todo →", "Limpiar filtros", estrellas, barras de rating, viñetas, checkboxes y anillo de foco. Los enlaces y el menú se **subrayan** al pasar el mouse.
- **Regla:** la lima sobre blanco es casi invisible (1.3:1) — nunca como letra, ícono, estrella ni borde sobre fondos claros. Nada de coral (#FF7A47) en ninguna parte.

### Semánticos (solo para su significado)
- **Verde OK** (#17724A) sobre (#E8F2EC) — "Agregado ✓", envío gratis, descuento aplicado.
- **Ámbar Aviso** (#8A6510) sobre (#FBF3DD) — Avisos.
- **Rojo Oferta / Error** (#B3261E) sobre (#FDECEB) — Errores de cupón, precios de oferta. Error de checkout: (#C0392B).
- **Verde WhatsApp** (#1D8548) — Solo el botón flotante "¿Dudas? Escríbenos".
- **Cartelito flotante del newsletter** (`.aviso-flotante`, armado por `app.js`, en todas las páginas menos el carrito; ofrece el 10% de descuento: "Suscríbete a nuestro newsletter y obtén un 10% de descuento. Te llega un código promocional al correo"): tarjeta de papel con borde de tinta 1px y la sombra dura del menú (`--shadow-menu`), esquinas de 2px, abajo a la izquierda (en celular, de lado a lado y sobre el botón de WhatsApp, sin el párrafo largo). Sale sin animación a los 8 s o al bajar el 25% de la página (a los 2,5 s en las páginas siguientes de la misma visita); sigue en todas las páginas hasta que la persona se suscribe (nunca más) o toca la × (44px) o Escape, y entonces se esconde 6 horas: si vuelve otro día sin haberse suscrito, sale otra vez. Campo de correo de 48px con letra de 16px (para que el iPhone no haga zoom). No es modal: no atrapa el foco.

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
* **Banner del carrusel** (`.hero-slide--promo`, ver `SPEC-carrusel.md`): **fondo blanco** (se probó tinta oscura y se descartó el 2026-10-04), texto real a la izquierda en tinta (eyebrow en tinta → título Anton de una línea → dato concreto → precio o cupón → botón principal lima con texto tinta, secundario con borde tinta) y 2–4 fotos de producto recortadas con fondo transparente (`assets/banners/*-v2.webp`) a la derecha, inclinadas y con sombra suave. En celular: texto arriba, fotos abajo, proporción 3:4. Cupón: código en Space Mono dentro de un recuadro punteado tinta de 1.5px. Un botón por banner (excepción: dos cuando cada uno lleva a un producto distinto). Máximo 3 banners fijos (hoy: solo geles; los de la calculadora y del nuevo empaque de Going se quitaron el 2026-11-27); los de evento (Black Friday, Cyber Monday) van antes y se quitan solos por fecha. El del nuevo empaque de Going está guardado en `tasks/banner-going-estrena-imagen.html` (usa las 3 bolsas de 300 g recortadas, `.promo-media--bolsas`, mismas proporciones que el de la calculadora). **Pasos numerados** (`.promo-steps`, banner de la calculadora): lista `<ol>` de 3 pasos con el número en un cuadro lima con tinta (Anton, esquinas de 2px), una línea en negrita y una de apoyo en gris; reemplaza al dato concreto y al precio. En celular se compacta (cuadro de 34px) para que el banner mida lo mismo que los demás.
* **Franja del newsletter** (`.promo-strip`, inicio, encima del mosaico de promociones): fondo blanco con borde 1px, eyebrow "Newsletter" → título Anton "10% de descuento" → "Suscríbete a nuestro newsletter y obtén un 10% de descuento. Te llega un código promocional al correo" → envío gratis; botón lima a la derecha "Quiero mi 10%" (ancho completo en celular) que abre el cartelito. Texto real, no imagen. Se oculta a quien ya se suscribió. El descuento de primera compra (APEX2026, automático) **ya no existe** (2026-11-28) y tampoco hay códigos: el 10% se aplica solo cuando el cliente escribe su correo en el carrito y marca la casilla (o ya es suscriptor en ese navegador), un pedido por correo (`NEWSLETTER_COUPON_RATE` en `app.js`; la tasa real la devuelve `/api/descuento`).

* **Preguntas frecuentes** (inicio): 5 preguntas con título en positivo (beneficio primero) y solo datos reales del sitio: despacho/envíos (MRW y Zoom; sin plazos de entrega en esta respuesta, que sí están en el acordeón de envíos de cada ficha), pagos, el 10% por suscribirse al newsletter, cómo se compra (el botón "Comprar" abre WhatsApp con el pedido) y retiro en tienda ("Pickup"). Si cambian los envíos, los pagos o el checkout, actualizar aquí también.


* **Menú móvil**: no se bloquea el scroll con `overflow:hidden` en el `body` (en iPhone rompía el encabezado `sticky` y la hamburguesa desaparecía al hacer scroll); el panel se coloca con JS justo debajo del encabezado (`placePanel` en `app.js`) y usa `overscroll-behavior: contain`.

* **Precio con descuento en el carrito** (`.cart-line-price--sale`): en cada producto con descuento (10% por dejar el correo o promoción) el precio normal va tachado con raya roja de 2px (`--sale`, `.cart-line-was`, gris suave) y encima/debajo el precio nuevo en rojo (`.cart-line-now`), alineados a la derecha; el lector de pantalla oye "Precio normal / Con descuento".

## Correos del newsletter (Worker, `worker/index.js`)

**Reglas del dueño (2026-11-28):** fondo blanco; el único color es el **verde Apex sólido** (#D8F24C, liso: sin degradados, rayas suaves ni transparencias) en la imagen principal y el botón, con tinta (#14120F) y blanco; **nada de crema/arena ni verde claro** (#F5FBD9, #EFEBE3, #F7F5F1 prohibidos en los correos). Texto muy corto. Asunto y texto sin lenguaje de promoción ("oferta", signos de %) para que Gmail lo muestre en Principal y no en Promociones.
Estructura del de bienvenida (`correoBienvenida`, con `correoMarco` / `filaLogo`): logo Apex sobre blanco → imagen principal verde liso con "10% DE DESCUENTO" en Anton y las fotos de producto en tarjeta blanca con borde de tinta y sombra dura (`assets/email/bienvenida-hero.jpg`) → una frase en Anton mayúsculas ("COLOCA TU CORREO EN EL CARRITO Y OBTIENES EL 10% DE DESCUENTO EN TU COMPRA!") → botón verde con borde de tinta → franja negra con los logos de las 5 marcas (`assets/email/marcas-tinta.png`) → pie gris con WhatsApp y baja. Las dos imágenes se generan con `scripts/email-hero-bienvenida.py`. Anton se pide a Google Fonts y, si el programa de correo no la carga, cae en Impact. Toda imagen lleva texto alternativo. Los tres correos (bienvenida, productos de la semana y reposición) comparten `correoMarco`, `filaLogo`, `filaBandaTitulo` (banda de título en verde liso con Anton, texto real), `botonCorreo` (verde con borde de tinta; `tinta` para los botones de cada producto) y `filaMarcas` (franja de las 5 marcas). La bienvenida lleva la imagen grande del 10% (`assets/email/bienvenida-hero.jpg`) y el semanal su imagen "Los productos estrella de la semana" (`assets/email/semana-hero.jpg`: titular Anton, tarjetas de producto inclinadas con borde de tinta y sombra dura, estrella de tinta "TOP"), seguida de tarjetas de producto grandes en cuadrícula de 2 (`tarjetaProductoCorreo`: foto, nombre, botón negro; sin foto, un recuadro verde liso con el nombre en Anton; si queda una sola, va centrada). Las tres imágenes salen de `scripts/email-hero-bienvenida.py`. Las fotos de producto del semanal son las del sitio (webp): Gmail y Apple Mail las muestran; Outlook de escritorio puede no hacerlo.

## Panel de pedidos (panel.html) — pantalla interna

No es parte de la tienda: lo usa quien recibe los pedidos (antes lo hacía un bot de Telegram). Tiene su propio
`panel/panel.css` (no carga `styles.css`) pero la misma identidad: tinta, papel, lima **solo como fondo**
(botón "Confirmar" y contador de nuevos), Anton para números de pedido y totales, Space Mono para datos.
Pensado para usarlo de pie y con una mano: botones de 56 px, letras grandes, tarjetas tipo ticket de
cocina. Celular = pestañas por etapa; pantalla grande (≥ 900 px) = tres columnas (Nuevos / Entrega /
Resueltos). El tiempo de espera pasa a ámbar a los 10 min y a rojo a los 30. No se indexa
(`noindex`, `robots.txt`) y los datos solo salen por `/api/panel/*` con código de acceso.

**Dashboard de Ventas — histórico:** con "Histórico" (o cualquier rango de más de 62 días) la gráfica pasa a ser **una barra por mes** y aparece un filtro de 4 botones en la misma tarjeta: Pedidos (por defecto), Vendido ($), Ticket promedio y Unidades. Es una sola gráfica (el filtro cambia lo que muestra, no hay gráficas separadas). Lleva **línea de tendencia** roja punteada (mínimos cuadrados sobre los meses completos; el mes en curso va en gris con asterisco y no cuenta) y, debajo, una frase en lenguaje normal ("Sube $174 por mes"). En rangos cortos sigue la gráfica de ventas por día, sin filtro.

**Dashboard de Ventas — compartir gráficas (2026-11-28):** cada gráfica (la de ventas por día / por mes y la distribución de productos) tiene un botón "Compartir" (`.chip--compartir`, con ícono, a la derecha del encabezado de la tarjeta). Al tocarlo sale la ventana de confirmación del panel (`.dialog-overlay` / `.dialog`, la misma de cancelar un pedido): "Compartir gráfica — Vas a compartir la gráfica de {nombre} ({periodo}). ¿Estás seguro?" con **No** (el foco queda aquí, y Escape o tocar fuera también cierran) y **Sí**. Con el Sí, la gráfica se convierte en una imagen PNG (barra de tinta con filo verde, título, periodo, la gráfica con su línea de tendencia y nota si la tiene, y el pie "Apex Nutrición · apexnutricionve.com · Generado el …") y se abre el menú de compartir del teléfono; si el navegador no puede compartir archivos, se descarga la imagen. La imagen se prepara mientras se lee la pregunta (Safari exige compartir justo después del toque). Solo lleva cifras de ventas, nunca nombres ni teléfonos de clientes. El código está en `panel/ventas.js` (sección "Compartir gráficas").
