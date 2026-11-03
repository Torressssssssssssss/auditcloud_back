const { it } = require('node:test');
const assert = require('node:assert/strict');
const { inflateSync } = require('node:zlib');
const { generarPdfAuditoria } = require('../../services/reportes.service');

const auditoria = { id_auditoria: 20, empresa: 'Empresa demo', empresa_auditora: 'Auditora demo',
  estado: 'EN_PROCESO', cliente: 'Cliente demo', objetivo: 'Revisión ambiental' };

function contenidoPdf(buffer)
{
  const pdf = buffer.toString('latin1');
  const streams = [];
  for(const match of pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g))
  {
    streams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
  }
  const contenido = streams.join('\n');
  const texto = [...contenido.matchAll(/<([0-9a-f]+)>/gi)]
    .map(match => Buffer.from(match[1], 'hex').toString('latin1')).join('');
  return { pdf, texto };
}

// Estas pruebas usan PDFKit real; no sustituyen el motor de renderizado.
for(const largo of [false, true]) it(`genera PDF válido ${largo ? 'con descripción extensa y varias páginas' : 'sin evidencias'}`, async t =>
{
  try
  {
    require.resolve('pdfkit');
  }
  catch
  {
    t.skip('Falta instalar pdfkit: npm install (requiere acceso al registro npm).');
    return;
  }
  const hallazgos = largo ? [{ id_evidencia: 1, modulo: 'Agua', tipo: 'COMENTARIO',
    descripcion: 'Hallazgo extenso '.repeat(2500) + 'FINALDESCRIPCION', auditor: 'Auditor demo',
    tipo_recurso: 'Agua', cantidad: '0.000', unidad_medida: 'm3',
    consumo_inicio: '2026-01-01', consumo_fin: '2026-01-31' }] : [];
  const buffer = await generarPdfAuditoria(auditoria, hallazgos);
  assert.ok(Buffer.isBuffer(buffer));
  const { pdf, texto } = contenidoPdf(buffer);
  assert.ok(pdf.startsWith('%PDF-'));
  assert.match(pdf, /%%EOF/);
  const pages = [...pdf.matchAll(/\/Type \/Page\b/g)].length;
  assert.ok(largo ? pages > 1 : pages === 1);
  // Reconstruye los fragmentos de texto que PDFKit separa por ajustes tipográficos.
  assert.ok(texto.includes('EN_PROCESO'));
  if(largo) assert.ok(texto.includes('FINALDESCRIPCION'));
  else assert.ok(texto.includes('Sin hallazgos'));
});
