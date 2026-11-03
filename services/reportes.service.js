const MARGEN = 48;
const ALTO_LINEA = 12;
const ANCHOS = [38, 82, 187, 110, 82];
const COLOR = '#183c4b';
const texto = value => Array.from(String(value ?? 'No registrado'))
  .filter(char => char === '\n' || char === '\t' || char.charCodeAt(0) >= 32).join('');

// Divide también palabras sin espacios para que una descripción extensa no se recorte.
function envolver(doc, value, width)
{
  const lines = [];
  for(const paragraph of texto(value).split('\n'))
  {
    let line = '';
    for(const word of paragraph.split(/\s+/))
    {
      if(line && doc.widthOfString(`${line} ${word}`) <= width)
      {
        line += ` ${word}`;
        continue;
      }
      if(line) lines.push(line);
      line = '';
      for(const char of word)
      {
        if(line && doc.widthOfString(line + char) > width)
        {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

function generarPdfAuditoria(auditoria, hallazgos)
{
  // Carga al generar: el resto de la API no depende del motor de PDF.
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) =>
  {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true,
      margins: { top: 104, bottom: 60, left: MARGEN, right: MARGEN },
      info: { Title: `Resumen de hallazgos - Auditoría ${auditoria.id_auditoria}`,
        Author: 'AuditCloud', Subject: 'Resumen de evidencias y consumos' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.once('error', reject);
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    try
    {
      const ancho = doc.page.width - 2 * MARGEN;
      const encabezado = () =>
      {
        doc.fillColor(COLOR).font('Helvetica-Bold').fontSize(22)
          .text('AuditCloud', MARGEN, 34, { lineBreak: false });
        doc.font('Helvetica').fontSize(10).text('Resumen de hallazgos', MARGEN, 62, { lineBreak: false });
        doc.moveTo(MARGEN, 85).lineTo(doc.page.width - MARGEN, 85).strokeColor('#b7ccd2').stroke();
        doc.fillColor('#22313b').font('Helvetica').fontSize(10);
        doc.x = MARGEN;
        doc.y = 104;
      };
      encabezado();
      doc.on('pageAdded', encabezado);
      doc.font('Helvetica-Bold').fontSize(16).text(`Auditoría #${auditoria.id_auditoria}`);
      doc.moveDown(0.5).font('Helvetica').fontSize(10);
      for(const [label, value] of [
        ['Empresa auditora', auditoria.empresa_auditora], ['Empresa auditada', auditoria.empresa],
        ['RFC', auditoria.rfc], ['Cliente', auditoria.cliente], ['Estado de la auditoría', auditoria.estado],
        ['Fecha de creación', auditoria.creada_en], ['Fecha de inicio', auditoria.fecha_inicio],
        ['Generado (UTC)', new Date().toISOString()], ['Objetivo', auditoria.objetivo]
      ]) doc.text(`${label}: ${texto(value)}`, { width: ancho });
      doc.moveDown().text(`Total de hallazgos/evidencias: ${hallazgos.length}`).moveDown();
      if(!hallazgos.length) doc.text('Sin hallazgos ni consumos registrados.');
      else
      {
        let y = doc.y;
        const limite = doc.page.height - 60;
        const cabeceraTabla = () =>
        {
          if(y + 32 > limite)
          {
            doc.addPage();
            y = 104;
          }
          doc.rect(MARGEN, y, ancho, 28).fill(COLOR);
          doc.font('Helvetica-Bold').fontSize(9).fillColor('white');
          let x = MARGEN;
          ['ID', 'Módulo / tipo', 'Hallazgo / evidencia', 'Consumo', 'Periodo'].forEach((title, i) =>
          {
            doc.text(title, x + 5, y + 8, { width: ANCHOS[i] - 10, lineBreak: false });
            x += ANCHOS[i];
          });
          y += 28;
          doc.font('Helvetica').fontSize(9).fillColor('#22313b');
        };
        cabeceraTabla();
        for(const [index, h] of hallazgos.entries())
        {
          const consumo = h.tipo_recurso == null ? 'Sin consumo' :
            `${h.tipo_recurso}\n${h.cantidad} ${h.unidad_medida}`;
          const values = [h.id_evidencia, `${texto(h.modulo)}\n${texto(h.tipo)}`,
            `${texto(h.descripcion)}\nAuditor: ${texto(h.auditor)}\nFecha: ${texto(h.fecha_evidencia)}` +
              (h.nombre_archivo ? `\nArchivo: ${h.nombre_archivo}` : ''),
            consumo, h.tipo_recurso == null ? 'No aplica' : `${h.consumo_inicio}\na ${h.consumo_fin}`];
          const lines = values.map((value, i) => envolver(doc, value, ANCHOS[i] - 10));
          const total = Math.max(...lines.map(column => column.length));
          let offset = 0;
          while(offset < total)
          {
            let capacity = Math.floor((limite - y - 10) / ALTO_LINEA);
            if(capacity < 1)
            {
              doc.addPage();
              y = 104;
              cabeceraTabla();
              capacity = Math.floor((limite - y - 10) / ALTO_LINEA);
            }
            const count = Math.min(capacity, total - offset);
            const height = count * ALTO_LINEA + 10;
            doc.rect(MARGEN, y, ancho, height).fill(index % 2 ? '#ffffff' : '#edf4f6');
            doc.fillColor('#22313b');
            let x = MARGEN;
            lines.forEach((column, i) =>
            {
              column.slice(offset, offset + count).forEach((line, j) =>
              {
                doc.text(line, x + 5, y + 5 + j * ALTO_LINEA, { lineBreak: false });
              });
              x += ANCHOS[i];
            });
            y += height;
            offset += count;
          }
        }
      }
      const { count } = doc.bufferedPageRange();
      for(let i = 0; i < count; i++)
      {
        doc.switchToPage(i);
        doc.font('Helvetica').fontSize(8).fillColor('#62747b')
          .text(`AuditCloud | Auditoría ${auditoria.id_auditoria} | Página ${i + 1} de ${count}`,
            MARGEN, doc.page.height - 36, { lineBreak: false });
      }
      doc.end();
    }
    catch(error)
    {
      doc.destroy();
      reject(error);
    }
  });
}

module.exports = { generarPdfAuditoria };
