#!/usr/bin/env node
// Chequeo de performance + accesibilidad móvil (Lighthouse) para CONSTRAINTS.md.
//
// Por qué Lighthouse para las dos cosas: su categoría "accessibility" corre
// axe-core por debajo, así que un solo lanzamiento de Chrome cubre ambas
// dimensiones en vez de instalar y correr dos herramientas distintas.
//
// Modo "warn only": este script SIEMPRE termina con código 0. Si algo queda
// por debajo del piso en CONSTRAINTS.md, lo imprime bien visible pero nunca
// bloquea la tarea — así se decidió en la entrevista de /constraints.
//
// Alcance por costo: por default solo prueba las páginas HTML que cambiaron
// en este trabajo (git diff contra HEAD), no las 29. Con --all prueba un set
// representativo completo (para check:full / revisión).

import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const THRESHOLDS_PATH = path.join(__dirname, 'thresholds.json');

// Páginas representativas para --all o cuando no hay .html modificado que
// probar (home + categoría + producto + carrito: son las que de verdad ve
// un cliente que entra desde un anuncio de Instagram, según el embudo real
// medido en GA4 esta sesión).
const REPRESENTATIVE_PAGES = [
  'index.html',
  'categoria.html?cat=hidratacion',
  'producto.html',
  'carrito.html'
];

function getChangedHtmlPages() {
  try {
    const out = execSync('git diff --name-only HEAD -- "*.html"', { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function startStaticServer(root, port) {
  const mime = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.webp': 'image/webp', '.txt': 'text/plain', '.xml': 'application/xml'
  };
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const ext = path.extname(filePath);
    try {
      const data = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      res.end(data);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

function loadThresholds() {
  if (!existsSync(THRESHOLDS_PATH)) return null;
  return JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8'));
}

async function runLighthouse(url, chrome) {
  const result = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    logLevel: 'silent',
    onlyCategories: ['performance', 'accessibility'],
    formFactor: 'mobile',
    screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 3, disabled: false },
    throttlingMethod: 'simulate'
  });
  const lhr = result.lhr;
  return {
    performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
    accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
    lcp: lhr.audits['largest-contentful-paint']?.numericValue,
    cls: lhr.audits['cumulative-layout-shift']?.numericValue,
    tbt: lhr.audits['total-blocking-time']?.numericValue,
    a11yFailures: Object.values(lhr.audits).filter(
      (a) => a.scoreDisplayMode === 'binary' && a.score === 0 && lhr.categories.accessibility.auditRefs.some((r) => r.id === a.id)
    ).map((a) => a.title)
  };
}

async function main() {
  const all = process.argv.includes('--all');
  const explicitPages = process.argv.slice(2).filter((a) => a.endsWith('.html') || a.includes('.html?'));

  let pages;
  if (explicitPages.length) pages = explicitPages;
  else if (all) pages = REPRESENTATIVE_PAGES;
  else {
    const changed = getChangedHtmlPages();
    pages = changed.length ? changed : REPRESENTATIVE_PAGES;
  }

  const thresholds = loadThresholds();
  const port = 4173;
  console.log(`Sirviendo ${ROOT} en http://localhost:${port} ...`);
  const server = await startStaticServer(ROOT, port);

  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });

  let anyBelowFloor = false;
  const measured = {};

  try {
    for (const page of pages) {
      const url = `http://localhost:${port}/${page}`;
      process.stdout.write(`\n→ ${page} ... `);
      const r = await runLighthouse(url, chrome);
      measured[page] = r;
      console.log(`Performance ${r.performance}  Accesibilidad ${r.accessibility}  LCP ${(r.lcp / 1000).toFixed(1)}s  CLS ${r.cls?.toFixed(3)}  TBT ${Math.round(r.tbt)}ms`);

      const floor = thresholds && (thresholds.pages?.[page] || thresholds.default);
      if (floor) {
        if (r.performance < floor.performance) {
          anyBelowFloor = true;
          console.log(`  ⚠️  Performance ${r.performance} < piso ${floor.performance}`);
        }
        if (r.accessibility < floor.accessibility) {
          anyBelowFloor = true;
          console.log(`  ⚠️  Accesibilidad ${r.accessibility} < piso ${floor.accessibility}`);
        }
      }
      if (r.a11yFailures.length) {
        console.log(`  Fallas de accesibilidad: ${r.a11yFailures.join('; ')}`);
      }
    }
  } finally {
    await chrome.kill();
    server.close();
  }

  if (!thresholds) {
    console.log('\nNo hay scripts/thresholds.json todavía — corre con --measure-baseline para crearlo con los valores de hoy.');
  } else if (anyBelowFloor) {
    console.log('\n⚠️  CONSTRAINTS.md: una o más páginas quedaron por debajo del piso medido. Modo "solo avisar" — no se bloquea la tarea.');
  } else {
    console.log('\n✓ Dentro del piso de CONSTRAINTS.md.');
  }

  if (process.argv.includes('--measure-baseline')) {
    const { writeFileSync } = await import('node:fs');
    const out = { generatedAt: new Date().toISOString(), pages: {} };
    for (const [page, r] of Object.entries(measured)) {
      out.pages[page] = { performance: r.performance, accessibility: r.accessibility };
    }
    writeFileSync(THRESHOLDS_PATH, JSON.stringify(out, null, 2) + '\n');
    console.log(`\nGuardado ${THRESHOLDS_PATH} con los valores medidos como piso.`);
  }

  // Modo "solo avisar": siempre sale 0, incluso si algo quedó por debajo del piso.
  process.exit(0);
}

main().catch((err) => {
  console.error('Error corriendo el chequeo de performance:', err);
  process.exit(0); // warn-only: ni un error del script bloquea la tarea
});
