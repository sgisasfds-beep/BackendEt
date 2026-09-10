/* ==========================================================
   GENERACIÓN LOCAL DEL .DOCX (sin Google Drive/Docs)
   Recibe una lista plana de etiquetas [{ base64, widthPT, heightPT }]
   y arma un documento Word en memoria, acomodando varias
   etiquetas por fila cuando su ancho lo permite.

   Ventaja: nada de red hacia Google → de minutos a milisegundos.
========================================================== */

const {
  Document,
  Packer,
  Table,
  TableRow,
  TableCell,
  Paragraph,
  ImageRun,
  WidthType,
  VerticalAlign,
  AlignmentType
} = require("docx");

// Página Carta (8.5in x 11in) con márgenes de 2.54 cm (1 pulgada) por lado,
// igual a lo que ya tenía la plantilla de Google Docs.
// 👉 Si tu plantilla real es A4, cambia PAGE_WIDTH_PT a 595.28.
const MARGIN_PT = 72; // 2.54 cm = 1 pulgada = 72 pt
const PAGE_WIDTH_PT = 612; // Carta
const USABLE_WIDTH_PT = PAGE_WIDTH_PT - MARGIN_PT * 2;
const GAP_PT = 8; // separación horizontal entre etiquetas de una misma fila

const PT_A_PX = 96 / 72; // docx espera el tamaño de imagen en píxeles (96dpi)

/**
 * Agrupa las etiquetas en filas: mete tantas etiquetas del mismo ancho
 * como quepan en el ancho útil de la página. Si cambia el ancho
 * (otro grupo de envase) o ya no cabe, arranca una fila nueva.
 */
function agruparEnFilas(etiquetas) {
  const filas = [];
  let filaActual = [];
  let anchoFila = null;
  let anchoAcumulado = 0;

  for (const et of etiquetas) {
    const mismoAncho = anchoFila === null || Math.abs(et.widthPT - anchoFila) < 0.5;
    const anchoConGap = et.widthPT + (filaActual.length ? GAP_PT : 0);
    const cabeEnFila = anchoAcumulado + anchoConGap <= USABLE_WIDTH_PT;

    if (mismoAncho && cabeEnFila) {
      filaActual.push(et);
      anchoAcumulado += anchoConGap;
      anchoFila = et.widthPT;
    } else {
      if (filaActual.length) filas.push(filaActual);
      filaActual = [et];
      anchoAcumulado = et.widthPT;
      anchoFila = et.widthPT;
    }
  }
  if (filaActual.length) filas.push(filaActual);
  return filas;
}

/**
 * Construye el documento .docx en memoria a partir de una lista de
 * etiquetas: [{ base64, widthPT, heightPT }, ...]
 * Devuelve un Buffer listo para enviar con res.send(buffer).
 */
async function construirDocumentoEtiquetas(etiquetas) {
  if (!etiquetas || !etiquetas.length) {
    throw new Error("No hay etiquetas para generar");
  }

  const filas = agruparEnFilas(etiquetas);

  const filasDoc = filas.map((fila) => {
    const anchoPorcentaje = Math.floor(100 / fila.length);

    const celdas = fila.map(
      (et) =>
        new TableCell({
          width: { size: anchoPorcentaje, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 120, bottom: 120, left: 60, right: 60 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: Buffer.from(et.base64, "base64"),
                  transformation: {
                    width: Math.round(et.widthPT * PT_A_PX),
                    height: Math.round(et.heightPT * PT_A_PX)
                  }
                })
              ]
            })
          ]
        })
    );

    return new TableRow({ children: celdas });
  });

  const tabla = new Table({
    rows: filasDoc,
    width: { size: 100, type: WidthType.PERCENTAGE }
  });

  const documento = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: MARGIN_PT * 20, // el paquete "docx" usa twips (1pt = 20 twips)
              bottom: MARGIN_PT * 20,
              left: MARGIN_PT * 20,
              right: MARGIN_PT * 20
            }
          }
        },
        children: [tabla]
      }
    ]
  });

  return Packer.toBuffer(documento);
}

module.exports = { construirDocumentoEtiquetas };
