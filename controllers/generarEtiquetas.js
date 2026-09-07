console.log("ARCHIVO etiqueta.js CARGADO");

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

// ========= AUTENTICACIÓN =========
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const REDIRECT_URI = process.env.REDIRECT_URI;


const CARPETA_TEMPORAL = "145r6FtxPxOGsfil7YTvtrWl9nbybb4yg";

const TEMPLATE_ID = "1ViovW9_-ApYIWV88yDBQVtdRW4Z6lsNI0_sxXyoJbDA";

async function getAuthClient() {
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  auth.setCredentials({ refresh_token: REFRESH_TOKEN });
  await auth.getAccessToken();
  return auth;
}

/* ====================================================================================
    DIMENSIONES exactas por grupo
    grupo0 = 30, 40, 60 → dimensiones pequeñas de etiqueta
 ==================================================================================== */

const DIMENSIONES = {
  // Grupo 0 → 3.7 cm alto × 5.3 cm ancho → convertidos a pulgadas (Google Docs)
  grupo0: { width: 2.0866, height: 1.4567 },  

  grupo1: { width: 3.933071, height: 2.629921 },
  grupo2: { width: 4.1456693, height: 2.940945 },
  grupo3: { width: 8, height: 4.2795276 }
};

function obtenerDimensionesPorEnvase(envase) {
  let v = String(envase).toLowerCase().replace(/\s/g, "");

  console.log("📌 ENVASE RECIBIDO:", envase);
  console.log("🔄 ENVASE NORMALIZADO:", v);

  // Grupo 0 — etiquetas pequeñas
  if (["30", "30ml", "40", "40ml", "60", "60ml"].includes(v)) {
    console.log("➡ APLICADO GRUPO 0");
    return DIMENSIONES.grupo0;
  }

  // Grupo 1
  if (["100","100ml","250","250ml","500","500ml","1000","1000ml"].includes(v)) {
    console.log("➡ APLICADO GRUPO 1");
    return DIMENSIONES.grupo1;
  }

  // Grupo 2
  if (["2000","2000ml","3000","3000ml"].includes(v)) {
    console.log("➡ APLICADO GRUPO 2");
    return DIMENSIONES.grupo2;
  }

  // Grupo 3
  if (["10000","10l","20000","20l",,"30000","30l","40000","40l","50000","50l"].includes(v)) {
    console.log("➡ APLICADO GRUPO 3");
    return DIMENSIONES.grupo3;
  }

  // Si nada coincide, grupo 1 por defecto
  console.log("⚠ No coincide ningún grupo → usando GRUPO 1 por defecto");
  return DIMENSIONES.grupo1;
}


async function generarDocumentoEtiquetas(req, res) {
  const rutaTemp = path.join(__dirname, `../tmp/etq_temp_${Date.now()}.png`);
  let uploadedFileId = null;

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
    const dirTmp = path.join(__dirname, "..", "tmp");
    if (!fs.existsSync(dirTmp)) fs.mkdirSync(dirTmp, { recursive: true });
    fs.writeFileSync(rutaTemp, Buffer.from(base64Imagen, "base64"));
    const auth = await getAuthClient();
    const drive = google.drive({ version: "v3", auth });
    const docs = google.docs({ version: "v1", auth });
    const uploadRes = await drive.files.create({
      requestBody: {
        name: `etq_temp_${Date.now()}.png`,
        parents: [CARPETA_TEMPORAL],
        mimeType: "image/png"
      },
      media: {
        mimeType: "image/png",
        body: fs.createReadStream(rutaTemp)
      },
      fields: "id"
    });

    uploadedFileId = uploadRes.data.id;
    await drive.permissions.create({
      fileId: uploadedFileId,
      requestBody: { role: "reader", type: "anyone" }
    });

    const imageUrl = `https://drive.google.com/uc?id=${uploadedFileId}`;

    const copia = await drive.files.copy({
      fileId: TEMPLATE_ID,
      requestBody: { name: `Etiquetas_${Date.now()}` },
      fields: "id"
    });

    const documentId = copia.data.id;
    const requests = [];

    for (let i = 0; i < cantidad; i++) {
      requests.push({
        insertInlineImage: {
          uri: imageUrl,
          location: { index: 1 },
          objectSize: {
            height: { magnitude: heightPT, unit: "PT" },
            width: { magnitude: widthPT, unit: "PT" }
          }
        }
      });

      requests.push({
        insertText: { location: { index: 1 }, text: "\n" }
      });
    }

    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests }
    });

    await drive.files.delete({ fileId: uploadedFileId });
    uploadedFileId = null;

    fs.unlinkSync(rutaTemp);

    const exportado = await drive.files.export(
      {
        fileId: documentId,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      { responseType: "arraybuffer" }
    );

    
    const buffer = Buffer.from(exportado.data);
    const nombreArchivo = `etiquetas_${Date.now()}.docx`;

    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    console.log("🚀 Enviando archivo DOCX directamente al cliente...");
    return res.send(buffer);

  } catch (error) {
    console.error("❌ Error generando etiquetas:", error);

    try {
      if (uploadedFileId) {
        const auth = await getAuthClient();
        const drive = google.drive({ version: "v3", auth });
        await drive.files.delete({ fileId: uploadedFileId });
      }
    } catch {}

    try {
      if (fs.existsSync(rutaTemp)) fs.unlinkSync(rutaTemp);
    } catch {}

    return res.status(500).json({ error: "Error generando el documento" });
  }
}

module.exports = { generarDocumentoEtiquetas };