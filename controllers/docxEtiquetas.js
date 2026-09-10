const { Document, Packer, Paragraph, ImageRun, AlignmentType } = require("docx");

const PT_A_PX = 96 / 72;
const MARGIN_PT = 72; // 2.54 cm (1 pulgada)

async function construirDocumentoEtiquetas(etiquetas) {
  if (!etiquetas || !etiquetas.length) {
    throw new Error("No hay etiquetas para generar");
  }

  // 1. Limpiamos las imágenes y creamos los objetos ImageRun
  const imagenes = etiquetas.map((et) => {
    // ESTO EVITA EL BLOQUEO: Quitamos el prefijo 'data:image/...;base64,' si existe
    const base64Limpio = et.base64.replace(/^data:image\/\w+;base64,/, "");

    return new ImageRun({
      data: Buffer.from(base64Limpio, "base64"),
      transformation: {
        width: Math.round(et.widthPT * PT_A_PX),
        height: Math.round(et.heightPT * PT_A_PX)
      }
    });
  });

  // 2. Creamos el documento SIN TABLAS
  const documento = new Document({
    creator: "SafeLabel", // Metadato para dar confianza al archivo de Word
    title: "Etiquetas de Seguridad",
    description: "Generador de etiquetas",
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: MARGIN_PT * 20, // 20 twips = 1 pt
              bottom: MARGIN_PT * 20,
              left: MARGIN_PT * 20,
              right: MARGIN_PT * 20
            }
          }
        },
        children: [
          // Metemos TODAS las imágenes en un solo párrafo centrado.
          // Word las colocará una al lado de la otra de forma natural.
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: imagenes
          })
        ]
      }
    ]
  });

  return Packer.toBuffer(documento);
}

module.exports = { construirDocumentoEtiquetas };
