"""Genera las imágenes del correo de bienvenida (assets/email/): la principal (fondo negro, "10%" grande y productos) y la franja de logos de las marcas.
Los correos no cargan las fuentes del sitio, así que el título grande va en la imagen (Anton, de assets/fonts). Colores: solo el verde Apex SÓLIDO (#D8F24C, sin degradados ni rayas suaves), tinta y blanco (regla del dueño, 2026-11-28: sin crema ni verde claro).
Uso: python3 scripts/email-hero-bienvenida.py   (necesita pillow y fonttools con brotli)"""
import io, os
from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw, ImageFont

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIMA, TINTA, BLANCO = (216, 242, 76), (20, 18, 15), (255, 255, 255)
W, H = 1200, 700


def fuente(nombre_woff2, tam):
    f = TTFont(os.path.join(RAIZ, 'assets/fonts', nombre_woff2))
    f.flavor = None
    b = io.BytesIO(); f.save(b); b.seek(0)
    return ImageFont.truetype(b, tam)


def producto(ruta, alto):
    im = Image.open(os.path.join(RAIZ, ruta)).convert('RGB')
    caja = Image.eval(im.convert('L'), lambda p: 255 if p < 245 else 0).getbbox()   # las fotos tienen fondo blanco: se recorta al contenido
    im = im.crop(caja)
    return im.resize((round(im.width * alto / im.height), alto), Image.LANCZOS)


img = Image.new('RGB', (W, H), LIMA)   # color liso, sin degradados
d = ImageDraw.Draw(img)
mono = fuente('spacemono-700.woff2', 27)
anton = lambda t: fuente('anton.woff2', t)
d.text((70, 196), 'BIENVENIDO  ·  NEWSLETTER DE APEX', font=mono, fill=TINTA, anchor='ls')
d.text((56, 456), '10%', font=anton(260), fill=TINTA, anchor='ls')
d.text((70, 562), 'DE DESCUENTO', font=anton(84), fill=TINTA, anchor='ls')
d.rectangle([70, 598, 300, 608], fill=TINTA)

# tarjeta blanca con borde de tinta y sombra dura (la del menú del sitio)
x0, y0, x1, y1 = 660, 80, 1120, 600
d.rectangle([x0 + 16, y0 + 16, x1 + 16, y1 + 16], fill=TINTA)
d.rectangle([x0, y0, x1, y1], fill=BLANCO, outline=TINTA, width=5)
gel1 = producto('assets/going/gel-guayaba.png', 250)
prot = producto('assets/going/proteina-tarro-chocolate.png', 350)
gel2 = producto('assets/going/gel-granada.png', 250)
cx = (x0 + x1) // 2
img.paste(gel1, (cx - 150 - gel1.width // 2, y0 + 215))
img.paste(gel2, (cx + 150 - gel2.width // 2, y0 + 215))
img.paste(prot, (cx - prot.width // 2, y0 + 110))

os.makedirs(os.path.join(RAIZ, 'assets/email'), exist_ok=True)
salida = os.path.join(RAIZ, 'assets/email/bienvenida-hero.jpg')
img.save(salida, 'JPEG', quality=86, optimize=True, progressive=True)
print(salida, os.path.getsize(salida) // 1024, 'KB')

# Franja de logos de las marcas con el fondo Tinta Carbón del correo (el original es negro puro y se nota el borde).
franja = Image.open(os.path.join(RAIZ, 'assets/marcas-logos-strip.png')).convert('RGB')
franja = ImageChops.screen(franja, Image.new('RGB', franja.size, TINTA))
salida2 = os.path.join(RAIZ, 'assets/email/marcas-tinta.png')
franja.save(salida2, 'PNG', optimize=True)
print(salida2, os.path.getsize(salida2) // 1024, 'KB')
