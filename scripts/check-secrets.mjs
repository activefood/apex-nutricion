#!/usr/bin/env node
// Chequeo rápido de secretos para el loop de edición (segundos, no minutos).
//
// Por qué no gitleaks: es la herramienta de facto para esto, pero este
// entorno no tiene Homebrew ni el binario instalado, y bajar un binario
// nuevo a mano no encaja con un chequeo que debe correr en segundos cada
// vez que se edita un archivo. Hasta que alguien instale gitleaks (hay que
// seguir usándolo si ya está: `gitleaks detect --redact`), esto corre un
// escaneo liviano por patrones sobre el diff — sin dependencias nuevas.
//
// Siempre redacta lo que encuentra (nunca imprime el secreto completo).
// Modo "solo avisar": nunca bloquea, pero un hallazgo real acá es serio —
// revisarlo a mano antes de seguir.

import { execSync } from 'node:child_process';

const PATTERNS = [
  { name: 'Telegram bot token', re: /\b\d{6,10}:[A-Za-z0-9_-]{30,45}\b/g },
  { name: 'AWS Access Key ID', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Clave privada', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'Bearer token en código', re: /Authorization['"]?\s*:\s*['"]Bearer [A-Za-z0-9._-]{20,}/g },
  { name: 'Posible secreto genérico asignado', re: /(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][A-Za-z0-9_\-./+]{16,}['"]/gi }
];

function redact(match) {
  if (match.length <= 8) return '••••••••';
  return match.slice(0, 4) + '…' + match.slice(-4);
}

function getDiff() {
  try {
    const staged = execSync('git diff --cached -U0', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
    const unstaged = execSync('git diff -U0', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
    return staged + '\n' + unstaged;
  } catch (e) {
    return '';
  }
}

function main() {
  const diff = getDiff();
  if (!diff.trim()) {
    console.log('✓ check:fast — sin cambios en git para escanear.');
    process.exit(0);
  }

  // Solo mira líneas agregadas (+), ignora el contexto y lo que se borró.
  const addedLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const haystack = addedLines.join('\n');

  const findings = [];
  for (const { name, re } of PATTERNS) {
    const matches = haystack.match(re) || [];
    for (const m of matches) findings.push({ name, redacted: redact(m) });
  }

  if (findings.length === 0) {
    console.log('✓ check:fast — sin secretos evidentes en los cambios (patrones básicos, no reemplaza gitleaks).');
    process.exit(0);
  }

  console.log('⚠️  check:fast — posibles secretos en los cambios (modo solo avisar, no se bloquea):');
  for (const f of findings) console.log(`   - ${f.name}: ${f.redacted}`);
  console.log('   Revísalo antes de subir. Si es un falso positivo, sigue de largo.');
  process.exit(0); // warn-only
}

main();
