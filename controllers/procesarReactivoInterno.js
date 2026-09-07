
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { InfoSoluciones, Codigo } = require("../server");


const {
  getDriveClient,
  getDocsClient,
  generarNombreCarpetaUnico,
  copiarYEditarArchivo,
  ponerTitulosEnNegrita,
  crearCarpetaDentroDeA,
  subirPDFsPorCodigo
} = require("../utils/googleTools");

async function procesarReactivoInterno(nombreReactivo, analista) {
  try {
    const info = await InfoSoluciones.findOne({
      nombre: new RegExp(`^${nombreReactivo}$`, "i")
    });

    if (!info) throw new Error("Reactivo no encontrado");

    const codigos = (info.indicaciones || "")
      .split("y")
      .map(c => c.trim())
      .filter(c => c !== "");

    let frasesH = [];
    let frasesP = [];

    for (const cod of codigos) {
      const items = await Codigo.find({ codigo: cod });
      for (const item of items) {
        if (item.frases_h) frasesH.push(...item.frases_h);
        if (item.frases_p) frasesP.push(...item.frases_p);
      }
    }

    frasesH = [...new Set(frasesH)];
    frasesP = [...new Set(frasesP)];

    const carpetaId = await crearCarpetaDentroDeA(generarNombreCarpetaUnico());

    for (const cod of codigos) {
      await subirPDFsPorCodigo(cod, carpetaId);
    }

    const contenido = `
REACTIVO:
${info.nombre}

PREPARACIÓN:
${info.preparacion || "No aplica"}

FRASES H:
${frasesH.length ? frasesH.join(", ") : "No aplica"}

FRASES P:
${frasesP.length ? frasesP.join(", ") : "No aplica"}

EMPRESA:
Servicios Geológicos Integrados SAS

ANALISTA RESPONSABLE:
${analista}
    `;

    const docId = await copiarYEditarArchivo(process.env.PLANTILLA_DOC_ID, carpetaId, contenido);
    await ponerTitulosEnNegrita(docId);

    const url = `https://drive.google.com/drive/folders/${carpetaId}`;
    const qr = await QRCode.toDataURL(url);

    return { ok: true, carpetaId, docId, qr };

  } catch (err) {
    console.error("Error procesarReactivoInterno:", err);
    throw err;
  }
}

module.exports = { procesarReactivoInterno };
