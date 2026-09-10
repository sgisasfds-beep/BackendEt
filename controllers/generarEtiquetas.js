console.log("ARCHIVO generarEtiquetas.js CARGADO (versión local, sin Google Drive/Docs)");

const { obtenerDimensionesPorEnvase } = require("./dimensionesEtiquetas");
const { construirDocumentoEtiquetas } = require("./docxEtiquetas");
const docxImportado = require("./docxEtiquetas"); // Importamos todo el módulo para revisar

console.log("🔍 LO QUE NODE ESTÁ IMPORTANDO DE docxEtiquetas:", docxImportado);

const { construirDocumentoEtiquetas } = docxImportado;
async function generarDocumentoEtiquetas(req, res) {
  try {
    const { base64Imagen, cantidad, envase } = req.body;

    console.log("-------------------------------------");
    console.log("📥 DATOS RECIBIDOS PARA ETIQUETA");
    console.log({ cantidad, envase });
    console.log("-------------------------------------");

    if (!base64Imagen) return res.status(400).json({ error: "Falta la imagen." });
    if (!cantidad) return res.status(400).json({ error: "Falta la cantidad." });

    const dimensiones = obtenerDimensionesPorEnvase(envase || "");
    const widthPT = dimensiones.width * 72;
    const heightPT = dimensiones.height * 72;

    console.log("📐 TAMAÑO FINAL DE ETIQUETA (PT):", { widthPT, heightPT });

    // Repetimos la misma imagen "cantidad" veces; construirDocumentoEtiquetas
    // se encarga de acomodar varias por fila según el ancho.
    const etiquetas = Array.from({ length: cantidad }, () => ({
      base64: base64Imagen,
      widthPT,
      heightPT
    }));

    const buffer = await construirDocumentoEtiquetas(etiquetas);
    const nombreArchivo = `etiquetas_${Date.now()}.docx`;

    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    console.log("🚀 Documento generado localmente y enviado al cliente (sin Google).");
    return res.send(buffer);

  } catch (error) {
    console.error("❌ Error generando etiquetas:", error);
    return res.status(500).json({ error: "Error generando el documento" });
  }
}

module.exports = { generarDocumentoEtiquetas };
