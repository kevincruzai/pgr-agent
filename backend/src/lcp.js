import { all } from './db.js';

/* Métodos de contratación de la Ley de Compras Públicas (DL 652/2023).
   Umbral competitivo: 240 salarios mínimos del sector comercio (LCP Arts. 39-40).
   El salario mínimo y el límite institucional de Baja Cuantía son configurables
   (tabla settings) porque la ley delega este último en la máxima autoridad. */

export const LCP_METHODS = {
  licitacion_competitiva: { label: 'Licitación Competitiva', article: 'Art. 39', legal_basis: 'LCP Art. 39 - Licitación Competitiva' },
  comparacion_precios:    { label: 'Comparación de Precios', article: 'Art. 40', legal_basis: 'LCP Art. 40 - Comparación de Precios' },
  contratacion_directa:   { label: 'Contratación Directa',   article: 'Art. 41', legal_basis: 'LCP Art. 41 - Contratación Directa' },
  baja_cuantia:           { label: 'Baja Cuantía',           article: 'Art. 44', legal_basis: 'LCP Art. 44 - Baja Cuantía' },
};

export const DEFAULT_MIN_WAGE_COMERCIO = 365; // USD/mes, sector comercio y servicios

export async function getLcpThresholds() {
  const rows = await all("SELECT [key], value FROM settings WHERE [key] IN ('min_wage_comercio','baja_cuantia_limit')");
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  const minWage = parseFloat(s.min_wage_comercio) || DEFAULT_MIN_WAGE_COMERCIO;
  return {
    minWage,
    competitiveThreshold: 240 * minWage,                  // > umbral → Licitación Competitiva
    bajaCuantiaLimit: parseFloat(s.baja_cuantia_limit) || 0, // 0 = no definido por la institución
  };
}

export function suggestLcpMethod(amount, { competitiveThreshold, bajaCuantiaLimit }) {
  if (bajaCuantiaLimit > 0 && amount <= bajaCuantiaLimit) {
    return { procurement_type: 'baja_cuantia', ...LCP_METHODS.baja_cuantia, modality: LCP_METHODS.baja_cuantia.label,
      note: 'Cubierta por fondo circulante/caja chica. Se EXCLUYE de la PAC y se reporta mensualmente en COMPRASAL (módulo baja cuantía).' };
  }
  if (amount <= competitiveThreshold) {
    return { procurement_type: 'comparacion_precios', ...LCP_METHODS.comparacion_precios, modality: LCP_METHODS.comparacion_precios.label,
      note: `Convocatoria abierta con mínimo 3 ofertantes (monto ≤ $${competitiveThreshold.toLocaleString('en-US')} = 240 salarios mínimos comercio).` };
  }
  return { procurement_type: 'licitacion_competitiva', ...LCP_METHODS.licitacion_competitiva, modality: LCP_METHODS.licitacion_competitiva.label,
    note: `Monto supera los 240 salarios mínimos comercio ($${competitiveThreshold.toLocaleString('en-US')}). Publicación del documento de solicitud en COMPRASAL.` };
}

/* Fases del ciclo de compra pública (LCP Art. 1) mapeadas al estado del proyecto */
export const LCP_PHASES = {
  borrador: 'Planificación',
  en_revision: 'Planificación',
  aprobado: 'Selección del contratista',
  en_proceso: 'Selección del contratista',
  adjudicado: 'Contratación',
  completado: 'Liquidación',
  cancelado: '—',
};
