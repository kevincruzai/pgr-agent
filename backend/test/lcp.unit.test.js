import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suggestLcpMethod, LCP_METHODS, LCP_PHASES, DEFAULT_MIN_WAGE_COMERCIO } from '../src/lcp.js';

/* Umbral legal: 240 salarios mínimos del sector comercio (LCP Arts. 39-40) */
const T = { competitiveThreshold: 240 * DEFAULT_MIN_WAGE_COMERCIO, bajaCuantiaLimit: 0 };

describe('LCP — selección de método de contratación por monto', () => {
  test('el umbral competitivo por defecto es $87,600 (240 × $365)', () => {
    assert.equal(T.competitiveThreshold, 87600);
  });

  test('monto bajo → Comparación de Precios (Art. 40)', () => {
    const r = suggestLcpMethod(500, T);
    assert.equal(r.procurement_type, 'comparacion_precios');
    assert.equal(r.article, 'Art. 40');
  });

  test('frontera exacta $87,600 → Comparación de Precios (menor o IGUAL)', () => {
    assert.equal(suggestLcpMethod(87600, T).procurement_type, 'comparacion_precios');
  });

  test('$87,600.01 → Licitación Competitiva (Art. 39)', () => {
    const r = suggestLcpMethod(87600.01, T);
    assert.equal(r.procurement_type, 'licitacion_competitiva');
    assert.equal(r.article, 'Art. 39');
  });

  test('monto alto → Licitación Competitiva', () => {
    assert.equal(suggestLcpMethod(500000, T).procurement_type, 'licitacion_competitiva');
  });

  test('sin límite de Baja Cuantía configurado, nunca se sugiere Baja Cuantía', () => {
    assert.notEqual(suggestLcpMethod(1, T).procurement_type, 'baja_cuantia');
  });

  test('con límite institucional configurado, monto menor → Baja Cuantía (Art. 44) excluida de la PAC', () => {
    const r = suggestLcpMethod(800, { ...T, bajaCuantiaLimit: 1000 });
    assert.equal(r.procurement_type, 'baja_cuantia');
    assert.match(r.note, /EXCLUYE de la PAC/);
  });

  test('frontera de Baja Cuantía: igual al límite → Baja Cuantía; arriba → Comparación', () => {
    const cfg = { ...T, bajaCuantiaLimit: 1000 };
    assert.equal(suggestLcpMethod(1000, cfg).procurement_type, 'baja_cuantia');
    assert.equal(suggestLcpMethod(1000.01, cfg).procurement_type, 'comparacion_precios');
  });

  test('el umbral escala con el salario mínimo configurado', () => {
    const custom = { competitiveThreshold: 240 * 400, bajaCuantiaLimit: 0 }; // SM $400 → $96,000
    assert.equal(suggestLcpMethod(90000, custom).procurement_type, 'comparacion_precios');
    assert.equal(suggestLcpMethod(96001, custom).procurement_type, 'licitacion_competitiva');
  });
});

describe('LCP — catálogo de métodos y fases del ciclo', () => {
  test('los 4 métodos para obras/bienes/servicios existen con sus artículos', () => {
    assert.equal(LCP_METHODS.licitacion_competitiva.article, 'Art. 39');
    assert.equal(LCP_METHODS.comparacion_precios.article, 'Art. 40');
    assert.equal(LCP_METHODS.contratacion_directa.article, 'Art. 41');
    assert.equal(LCP_METHODS.baja_cuantia.article, 'Art. 44');
  });

  test('todo estado de proyecto mapea a una fase del ciclo LCP', () => {
    for (const status of ['borrador', 'en_revision', 'aprobado', 'en_proceso', 'adjudicado', 'completado', 'cancelado']) {
      assert.ok(LCP_PHASES[status], `estado sin fase: ${status}`);
    }
  });

  test('el ciclo respeta el orden legal: planificación → selección → contratación → liquidación', () => {
    assert.equal(LCP_PHASES.borrador, 'Planificación');
    assert.equal(LCP_PHASES.aprobado, 'Selección del contratista');
    assert.equal(LCP_PHASES.adjudicado, 'Contratación');
    assert.equal(LCP_PHASES.completado, 'Liquidación');
  });
});
