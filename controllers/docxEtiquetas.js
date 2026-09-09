/* ==========================================================
   GENERAR DOCUMENTO PARA MÚLTIPLES ETIQUETAS (ARRAY DINÁMICO)
   Recibe: { etiquetas: [{ base64Image, envase }, ...] }
   Versión local: sin Google Drive/Docs.
========================================================== */

const { obtenerDimensionesPorEnvase } = require("./dimensionesEtiquetas");
const { construirDocumentoEtiquetas } = require("./docxEtiquetas");

async function generarMultiplesEtiquetas(req, res) {
  console.log("⚡ Iniciando generación de documento múltiple (local)...");

  try {
    const { etiquetas } = req.body;

    if (!etiquetas || !Array.isArray(etiquetas) || etiquetas.length === 0) {
      return res.status(400).json({ error: "Se requiere un array de etiquetas con imagen y envase." });
    }

    const listaParaDocx = etiquetas.map(({ base64Image, envase }) => {
      const dimensiones = obtenerDimensionesPorEnvase(envase);
      return {
        base64: base64Image,
        widthPT: dimensiones.width * 72,
        heightPT: dimensiones.height * 72
      };
    });

    const buffer = await construirDocumentoEtiquetas(listaParaDocx);
    const nombreArchivo = `Lote_Etiquetas_${Date.now()}.docx`;

    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    console.log(`✅ Lote de etiquetas generado localmente y enviado: ${nombreArchivo}`);
    return res.send(buffer);

  } catch (err) {
    console.error("❌ Error en generarMultiplesEtiquetas:", err);
    res.status(500).json({ error: "Error interno generando documento múltiple." });
  }
}

module.exports = { generarMultiplesEtiquetas };
