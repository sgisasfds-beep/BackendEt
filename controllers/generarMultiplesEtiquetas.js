/* ==========================================================
   GENERAR DOCUMENTO PARA MÚLTIPLES ETIQUETAS (ARRAY DINÁMICO)
   Recibe: { etiquetas: [{ base64Image, envase }, ...] }
========================================================== */
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

// --- (Asegúrate de que tus credenciales sigan aquí) ---
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

// =======================================================
//  LÓGICA PARA DIMENSIONES DINÁMICAS (TU CÓDIGO)
// =======================================================
const DIMENSIONES = {
  grupo0: { width: 2.0866, height: 1.4567 },
  grupo1: { width: 3.933071, height: 2.629921 }, // 100mL - 1000mL
  grupo2: { width: 4.1456693, height: 2.940945 }, // 2000mL - 3000mL
  grupo3: { width: 8, height: 4.2795276 } // 10L - 50L
};

function obtenerDimensionesPorEnvase(envase) {
  let v = String(envase).toLowerCase().replace(/\s/g, "");  // limpia espacios

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
  if (["10000","10l","20000","20l","30000","30l","40000","40l","50000","50l"].includes(v)) {
    console.log("➡ APLICADO GRUPO 3");
    return DIMENSIONES.grupo3;
  }

  // Si nada coincide, grupo 1 por defecto
  console.log("⚠ No coincide ningún grupo → usando GRUPO 1 por defecto");
  return DIMENSIONES.grupo1;
}

// =======================================================
//  FUNCIÓN PRINCIPAL
// =======================================================
async function generarMultiplesEtiquetas(req, res) {
  console.log("⚡ Iniciando generación de documento múltiple...");

  try {
    // 1. RECIBIMOS EL NUEVO ARRAY DE OBJETOS
    const { etiquetas } = req.body; 

    if (!etiquetas || !Array.isArray(etiquetas) || etiquetas.length === 0) {
      return res.status(400).json({ error: "Se requiere un array de etiquetas con imagen y envase." });
    }

    const auth = await getAuthClient();
    const drive = google.drive({ version: "v3", auth });
    const docs = google.docs({ version: "v1", auth });

    // 2. CREAMOS UNA COPIA DE LA PLANTILLA
    const copia = await drive.files.copy({
      fileId: TEMPLATE_ID,
      requestBody: { name: `Etiquetas_Lote_${Date.now()}` },
      fields: "id"
    });
    const documentId = copia.data.id;

    const requests = [];

    // 3. PROCESAMOS CADA ETIQUETA
    for (let i = 0; i < etiquetas.length; i++) {
      const { base64Image, envase } = etiquetas[i];
      
      // ⚡ OBTENER DIMENSIONES DINÁMICAS ⚡
      const dimensiones = obtenerDimensionesPorEnvase(envase);
      const widthPT = dimensiones.width * 72; // Convertir pulgadas a puntos (1 pulgada = 72 puntos)
      const heightPT = dimensiones.height * 72;
      
      const tempPath = path.join(__dirname, `../tmp/temp_multi_${Date.now()}_${i}.png`);
      
      const dirTmp = path.join(__dirname, "..", "tmp");
      if (!fs.existsSync(dirTmp)) fs.mkdirSync(dirTmp, { recursive: true });

      fs.writeFileSync(tempPath, Buffer.from(base64Image, "base64"));

      // Subir a Google Drive
      const upload = await drive.files.create({
        requestBody: {
          name: `img_temp_${i}.png`,
          parents: [CARPETA_TEMPORAL],
          mimeType: "image/png"
        },
        media: {
          mimeType: "image/png",
          body: fs.createReadStream(tempPath)
        },
        fields: "id"
      });

      fs.unlinkSync(tempPath);

      // Hacer pública
      await drive.permissions.create({
        fileId: upload.data.id,
        requestBody: { role: "reader", type: "anyone" }
      });

      const urlImagen = `https://drive.google.com/uc?id=${upload.data.id}`;

      // Insertar en el DOC con las dimensiones calculadas
      requests.push({
        insertInlineImage: {
          uri: urlImagen,
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

    // 4. EJECUTAR LOS CAMBIOS EN EL DOC
    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests: requests.reverse() } 
    });

    // 5. EXPORTAR A DOCX y descargar
    const file = await drive.files.export(
      { fileId: documentId, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(file.data);
    const nombreArchivo = `Lote_Etiquetas_Dinamico_${Date.now()}.docx`;

    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    console.log(`✅ Lote de etiquetas generado y enviado directamente: ${nombreArchivo}`);
    return res.send(buffer);

  } catch (err) {
    console.error("❌ Error en generarMultiplesEtiquetas:", err);
    res.status(500).json({ error: "Error interno generando documento múltiple." });
  }
}

module.exports = { generarMultiplesEtiquetas };
