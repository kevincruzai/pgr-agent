import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttachmentParts } from '../src/services/gemini.js';

const mk = (filename, contentType, sizeBytes) => ({ filename, contentType, buffer: Buffer.alloc(sizeBytes, 1) });

describe('Gemini — preparación de documentos adjuntos para análisis', () => {
  test('PDF e imágenes se incluyen como inlineData base64', () => {
    const { parts, names } = buildAttachmentParts([
      mk('pliego.pdf', 'application/pdf', 1024),
      mk('plano.png', 'image/png', 2048),
    ]);
    assert.equal(parts.length, 2);
    assert.equal(parts[0].inlineData.mimeType, 'application/pdf');
    assert.ok(parts[0].inlineData.data.length > 0);
    assert.deepEqual(names, ['pliego.pdf', 'plano.png']);
  });

  test('tipos no analizables (ej. .zip, .exe) se excluyen pero se reportan por nombre', () => {
    const { parts, names } = buildAttachmentParts([mk('respaldo.zip', 'application/zip', 100)]);
    assert.equal(parts.length, 0);
    assert.match(names[0], /no analizable/);
  });

  test('el content-type con charset se normaliza (text/plain; charset=utf-8)', () => {
    const { parts } = buildAttachmentParts([mk('notas.txt', 'text/plain; charset=utf-8', 100)]);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].inlineData.mimeType, 'text/plain');
  });

  test('un adjunto que excede 4MB se omite por tamaño', () => {
    const { parts, names } = buildAttachmentParts([mk('grande.pdf', 'application/pdf', 5 * 1024 * 1024)]);
    assert.equal(parts.length, 0);
    assert.match(names[0], /omitido por tamaño/);
  });

  test('el total acumulado respeta el presupuesto de 10MB por solicitud', () => {
    const tres = [
      mk('a.pdf', 'application/pdf', 4 * 1024 * 1024),
      mk('b.pdf', 'application/pdf', 4 * 1024 * 1024),
      mk('c.pdf', 'application/pdf', 4 * 1024 * 1024), // este ya no cabe (12MB > 10MB)
    ];
    const { parts, names } = buildAttachmentParts(tres);
    assert.equal(parts.length, 2);
    assert.match(names[2], /omitido por tamaño/);
  });

  test('lista vacía o sin buffer no genera partes ni errores', () => {
    assert.deepEqual(buildAttachmentParts([]).parts, []);
    const { parts } = buildAttachmentParts([{ filename: 'x.pdf', contentType: 'application/pdf', buffer: null }]);
    assert.equal(parts.length, 0);
  });
});
