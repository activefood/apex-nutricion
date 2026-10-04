# Apex Nutrición — tienda-marca

Antes de cualquier cambio, lee **CONSTRAINTS.md** — define el piso de
calidad de este repo (performance y accesibilidad móvil, con los números
medidos y por qué). Nunca bajes un número de ahí para que un cambio pase;
si un piso ya no tiene sentido, edita CONSTRAINTS.md a mano y dilo
explícitamente, no lo ignores en silencio.

Para cualquier cambio visual o página nueva, sigue **DESIGN.md** — el
sistema de diseño actual (colores, tipografías, componentes y lo que no
se hace). Si cambias `styles.css` de forma que lo contradiga, actualiza
DESIGN.md en el mismo cambio.

- `npm run check:fast` antes de cada commit (segundos).
- `npm run check:task` al terminar una tarea, antes de pedir que se suba
  (menos de 90s).
