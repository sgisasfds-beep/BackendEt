const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");
const QRCode = require("qrcode");
const { generarDocumentoEtiquetas } = require("./controllers/generarEtiquetas");
const { generarMultiplesEtiquetas } = require("./controllers/generarMultiplesEtiquetas");

const tmpDescargasPath = path.join(__dirname, "tmpDescargas");
if (!fs.existsSync(tmpDescargasPath)) {
    fs.mkdirSync(tmpDescargasPath);
}



const app = express();

console.log("¡SERVIDOR INICIADO! Lógica de Pictogramas 1.2 Activa.");

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, ngrok-skip-browser-warning"
    );
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }

    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
    res.setHeader("ngrok-skip-browser-warning", "true");
    next();
});

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning"],
        exposedHeaders: ["Content-Disposition"]
    })
);

app.options("/api/generarDocumentoEtiquetas", (req, res) => {
    res.header("Access-Control-Allow-Origin", process.env.REDIRECT_URI);
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Expose-Headers", "Content-Disposition");
    return res.sendStatus(204);
});

app.use(express.static(__dirname));

// Carpeta en Google Drive donde viven TODOS los PDFs (la "biblioteca").
// Súbelos ahí una sola vez con migrarPDFsADrive.js y pon el ID de esa carpeta aquí.
const DRIVE_PDFS_FOLDER_ID = process.env.DRIVE_PDFS_FOLDER_ID || "1V8BgCN0ig_J1mb7mGbCCpPPe_UMFWef1";

function normalizar(str) {
    return (str || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

// En local, si no defines las variables de entorno, sigue usando tu Mongo local.
// En el servidor desplegado, defines MONGO_URI_INFO y MONGO_URI_REACTIVOS con tu connection string de Atlas.
const connInfo = mongoose.createConnection(process.env.MONGO_URI_INFO || "mongodb://localhost:27017/InfoSolucionesDB");
const connReactivos = mongoose.createConnection(process.env.MONGO_URI_REACTIVOS || "mongodb://localhost:27017/ReactivosDB");

const infoSolucionesSchema = new mongoose.Schema({
    nombre: String,
    indicaciones: String,
    preparacion: String
});
const InfoSoluciones = connInfo.model("infosoluciones", infoSolucionesSchema);

const reactivosPurosSchema = new mongoose.Schema({
    nombre: String,
    indicaciones: String,
    preparacion: String,
    proveedor: String,
    direccion: String,
    telefono: String
});

const ReactivosPuros = connInfo.model("reactivosPuros", reactivosPurosSchema, "reactivosPuros");


const codigoSchema = new mongoose.Schema({
    codigo: String,
    nombre: String,
    palabra_advertencia: String,
    frases_h: [String],
    frases_p: [String],
    pictogramas: [String],
    proveedor: String,
    direccion: String,
    telefono: String
});
const Codigo = connReactivos.model("reactivos", codigoSchema);


const prioridad = ["GHS08", "GHS06", "GHS09", "GHS05", "GHS03", "GHS02", "GHS04", "GHS07", "NoAplica"];

const pictogramaPaths = {
    "GHS01": path.join(__dirname, "imagenes/explosivo.png"),
    "GHS02": path.join(__dirname, "imagenes/Inflamable.png"),
    "GHS03": path.join(__dirname, "imagenes/comburente.png"),
    "GHS04": path.join(__dirname, "imagenes/gas.png"),
    "GHS05": path.join(__dirname, "imagenes/corrosivo.png"),
    "GHS06": path.join(__dirname, "imagenes/toxico.png"),
    "GHS07": path.join(__dirname, "imagenes/irritacion.png"),
    "GHS08": path.join(__dirname, "imagenes/salud.png"),
    "GHS09": path.join(__dirname, "imagenes/Medioambiente.png"),
    "NoAplica": path.join(__dirname, "imagenes/noaplica.png")
};

/**
 * Selecciona y ordena los pictogramas según la prioridad, aplicando un límite.
 * @param {string[]} lista - Lista de códigos GHS (pictogramas)
 * @param {number} [limite=2] - Número máximo de pictogramas a devolver.
 * @returns {string[]} Lista de códigos GHS seleccionados.
 */
function seleccionarPictogramas(lista, limite = 2) {
    if (!lista) return [];
    const filtrados = lista.filter(p => prioridad.includes(p));
    const ordenados = filtrados.sort((a, b) => prioridad.indexOf(a) - prioridad.indexOf(b));
    return ordenados.slice(0, limite);
}

function escaparRegex(string) {

    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calcularTamaño(volumen, cantidad) {
    volumen = parseInt(volumen) || 0;
    const grupo1 = [30, 40, 60, 100];
    const grupo2 = [250, 500, 1000];
    const grupo3 = [2000, 3000];
    let width_cm, height_cm;

    if (grupo1.includes(volumen) || grupo2.includes(volumen) || grupo3.includes(volumen)) {
        if (cantidad <= 1) {
            width_cm = height_cm = 2;
        } else {
            width_cm = 4;
            height_cm = 2;
        }
    } else {
        if (cantidad <= 1) {
            width_cm = height_cm = 3.8;
        } else {
            width_cm = 7.6;
            height_cm = 3.8;
        }
    }

    const px = 118;
    return {
        width: Math.round(width_cm * px),
        height: Math.round(height_cm * px)
    };
}

/**
 * Genera la imagen final del pictograma (o pictogramas combinados) como Base64.
 * Aplica la lógica de 1 o 2 pictogramas basada en el volumen.
 * @param {string[]} codigos - Lista de códigos GHS a considerar.
 * @param {string} volumen - El volumen del envase (ej: "100 mL", "500 mL").
 * @returns {Promise<string|null>} Imagen Base64 o null si falla.
 */
async function generarPictogramaFinal(codigos, volumen) {
    try {

        const volumenMatch = String(volumen).match(/(\d+)/);
        const volumenNum = volumenMatch ? parseInt(volumenMatch[1]) : 0;

        const maxPictograms = volumenNum < 100 ? 1 : 2;

        // *** DEPURACIÓN ***
        console.log(`[DEBUG PICTO] Volumen recibido: ${volumen}`);
        console.log(`[DEBUG PICTO] Número de Volumen (volumenNum): ${volumenNum}`);
        console.log(`[DEBUG PICTO] Límite de Pictogramas (maxPictograms): ${maxPictograms}`);
        // ******************

        const seleccion = seleccionarPictogramas(codigos, maxPictograms);

        // *** DEPURACIÓN ***
        console.log(`[DEBUG PICTO] Pictogramas seleccionados: ${seleccion.length} (${seleccion.join(', ')})`);
        // ******************

        if (seleccion.length === 0) return null;

        const tamaño = calcularTamaño(volumen, seleccion.length);

        if (seleccion.length === 1) {
            const ruta = pictogramaPaths[seleccion[0]];
            return (await sharp(ruta).resize(tamaño.width, tamaño.height).png().toBuffer()).toString("base64");
        }

        const ruta1 = pictogramaPaths[seleccion[0]];
        const ruta2 = pictogramaPaths[seleccion[1]];
        const wMitad = Math.round(tamaño.width / 2);

        const img1 = await sharp(ruta1).resize(wMitad, tamaño.height).png().toBuffer();
        const img2 = await sharp(ruta2).resize(wMitad, tamaño.height).png().toBuffer();

        return (
            await sharp({
                create: {
                    width: tamaño.width,
                    height: tamaño.height,
                    channels: 4,
                    background: { r: 255, g: 255, b: 255, alpha: 0 }
                }
            })
                .composite([
                    { input: img1, left: 0, top: 0 },
                    { input: img2, left: wMitad, top: 0 }
                ])
                .png()
                .toBuffer()
        ).toString("base64");

    } catch (error) {
        console.error("Error generando imagen Sharp:", error);
        return null;
    }
}

const CLIENT_ID = '7453909704-o92g8sag1lievj61vbl9eqo3s549q0q0.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const REDIRECT_URI = 'http://127.0.0.1:5500';

const CARPETA_A_ID = "1JmCe_EzvVJxzNToko_MCPlgI5I6y-SP1";
const PLANTILLA_DOC_ID = "1ivDHlSpkSvAOClVQTXP-gwKXe2N_q3oAL19GOeLVCuc";

async function getAuthClient() {
    const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    auth.setCredentials({ refresh_token: REFRESH_TOKEN });
    await auth.getAccessToken();
    return auth;
}

async function getDriveClient() {
    return google.drive({ version: "v3", auth: await getAuthClient() });
}

async function getDocsClient() {
    return google.docs({ version: "v1", auth: await getAuthClient() });
}

function generarNombreCarpetaUnico() {
    return `Etiqueta_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

async function crearCarpetaDentroDeA(nombreCarpeta) {
    const drive = await getDriveClient();
    const res = await drive.files.create({
        resource: {
            name: nombreCarpeta,
            parents: [CARPETA_A_ID],
            mimeType: "application/vnd.google-apps.folder"
        },
        fields: "id"
    });
    return res.data.id;
}

async function copiarYEditarArchivo(archivoId, nuevaCarpetaId, contenidoTexto) {
    try {
        const drive = await getDriveClient();
        const copia = await drive.files.copy({
            fileId: archivoId,
            requestBody: {
                name: "Consolidado",
                parents: [nuevaCarpetaId]
            }
        });

        const docId = copia.data.id;
        const docs = await getDocsClient();

        await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: {
                requests: [{
                    insertText: {
                        text: contenidoTexto,
                        endOfSegmentLocation: {}
                    }
                }]
            }
        });

        return docId;

    } catch (err) {
        console.error("Error copiarYEditarArchivo:", err);
        throw err;
    }
}

function encontrarTextoEnDoc(contenido, texto) {
    const resultados = [];

    for (const elemento of contenido) {
        if (!elemento.paragraph) continue;

        for (const run of elemento.paragraph.elements) {
            const t = run.textRun?.content;
            if (!t) continue;

            let pos = t.indexOf(texto);
            if (pos !== -1) {
                resultados.push({
                    start: run.startIndex + pos,
                    end: run.startIndex + pos + texto.length
                });
            }
        }
    }

    return resultados;
}

async function ponerTitulosEnNegrita(docId) {
    const docs = await getDocsClient();

    const documento = await docs.documents.get({ documentId: docId });
    const contenido = documento.data.body.content;

    const titulos = ["REACTIVO:", "PREPARACION:", "FRASES H:", "FRASES P:", "EMPRESA:"];

    const requests = [];

    for (const titulo of titulos) {
        const posiciones = encontrarTextoEnDoc(contenido, titulo);

        for (const pos of posiciones) {
            requests.push({
                updateTextStyle: {
                    range: {
                        startIndex: pos.start,
                        endIndex: pos.end
                    },
                    textStyle: { bold: true },
                    fields: "bold"
                }
            });
        }
    }

    if (requests.length === 0) return;

    await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests }
    });
}


// Busca en la carpeta "biblioteca" de Drive los PDFs cuyo nombre empieza por el código.
// Usamos "name contains" en la query para no traer TODA la carpeta en cada llamada.
async function buscarPDFsEnDrive(drive, codigo, fabricante, modoReactivosPuros) {
    const codigoBajo = codigo.toLowerCase();
    const regexExacta = new RegExp(`^${codigoBajo}(\\s|\\.|$)`, "i");
    const codigoEscapado = codigo.replace(/'/g, "\\'");

    let archivos = [];
    let pageToken = null;

    do {
        const respuesta = await drive.files.list({
            q: `'${DRIVE_PDFS_FOLDER_ID}' in parents and mimeType='application/pdf' and trashed=false and name contains '${codigoEscapado}'`,
            fields: "nextPageToken, files(id, name)",
            pageSize: 1000,
            pageToken
        });
        archivos = archivos.concat(respuesta.data.files || []);
        pageToken = respuesta.data.nextPageToken || null;
    } while (pageToken);

    // "contains" es una búsqueda amplia, así que igual filtramos con la regex exacta
    // (y por fabricante si aplica) para no arrastrar coincidencias parciales.
    return archivos.filter(archivo => {
        const nombreBajo = archivo.name.toLowerCase();
        const codigoMatch = regexExacta.test(nombreBajo);

        if (modoReactivosPuros) {
            const proveedorMatch = fabricante
                ? nombreBajo.includes(fabricante.toLowerCase())
                : false;
            return codigoMatch && proveedorMatch;
        }

        return codigoMatch;
    });
}

async function subirPDFsPorCodigo(codigo, carpetaId, fabricante, modoReactivosPuros) {
    const drive = await getDriveClient();

    const coincidencias = await buscarPDFsEnDrive(drive, codigo, fabricante, modoReactivosPuros);

    console.log(`[PDF Drive] Código buscado: ${codigo}. Coincidencias exactas encontradas: ${coincidencias.length}`);

    // Antes se copiaba un PDF a la vez (await dentro de un for). Como cada copia es
    // independiente de las demás, lanzarlas todas juntas con Promise.all ahorra
    // segundos cuando hay varios PDFs por código.
    await Promise.all(coincidencias.map(async archivo => {
        try {
            await drive.files.copy({
                fileId: archivo.id,
                requestBody: {
                    name: archivo.name,
                    parents: [carpetaId]
                }
            });
            console.log(`[PDF Drive] Copiado con éxito: ${archivo.name}`);
        } catch (error) {
            console.error(`[PDF Drive] Error al copiar ${archivo.name}:`, error.message);
        }
    }));
}

async function generarQR(idCarpeta) {
    const url = `https://drive.google.com/drive/folders/${idCarpeta}`;
    return await QRCode.toDataURL(url);
}

const bloqueos = new Map();

function generarClaveBloqueo(nombreReactivo, usuarioAnalista) {
    return `${nombreReactivo.trim().toLowerCase()}__${usuarioAnalista.trim().toLowerCase()}`;
}


app.get("/api/listaReactivos", async (req, res) => {
    try {
        const lista = await InfoSoluciones.find({}, { nombre: 1, indicaciones: 1, _id: 0 });
        const listaFinal = lista.map(item => {
            const nombreLimpio = item.nombre ? item.nombre.trim() : "";
            const indicaciones = item.indicaciones || "";
            const listaCodigos = indicaciones
                .split("y")
                .map(c => c.trim())
                .filter(c => c !== "");

            const codigo = listaCodigos.length > 0 ? listaCodigos[0] : "N/A";

            return {
                nombre: nombreLimpio,
                codigo: codigo
            };
        }).filter(item => item.nombre !== "");

        res.json(listaFinal);

    } catch (err) {
        console.error("Error al obtener la lista de reactivos:", err);
        res.status(500).json({ error: "Error al cargar la lista de reactivos" });
    }
});

app.get("/api/listaReactivosPuros", async (req, res) => {
    try {
        const lista = await ReactivosPuros.find({}, { nombre: 1, indicaciones: 1, _id: 0 });

        const listaFinal = lista.map(item => {
            const nombreLimpio = item.nombre ? item.nombre.trim() : "";

            const indicaciones = item.indicaciones || "";
            const listaCodigos = indicaciones
                .split("y")
                .map(c => c.trim())
                .filter(c => c !== "");

            const codigo = listaCodigos.length > 0 ? listaCodigos[0] : "N/A";

            return {
                nombre: nombreLimpio,
                codigo: codigo
            };
        }).filter(item => item.nombre !== "");

        res.json(listaFinal);

    } catch (err) {
        console.error("Error al obtener reactivos puros:", err);
        res.status(500).json({ error: "Error al cargar reactivos puros" });
    }
});

app.get("/api/infoSolucionPorNombre/:nombre", async (req, res) => {
    try {
        const nombreDecodificado = decodeURIComponent(req.params.nombre).trim();
        const nombreRegex = escaparRegex(nombreDecodificado);

        const info = await InfoSoluciones.findOne({
            nombre: { $regex: new RegExp(`^${nombreRegex}$`, "i") }
        });

        if (!info) return res.status(404).json({ error: "No encontrado" });
        res.json(info);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error servidor" });
    }
});

app.get("/api/reactivoPorCodigo/:codigo", async (req, res) => {
    try {
        const lista = await Codigo.find({ codigo: req.params.codigo.trim() });
        if (!lista.length) return res.status(404).json({ error: "No encontrado" });
        res.json(lista);
    } catch (err) {
        res.status(500).json({ error: "Error servidor" });
    }
});

app.post("/api/procesarCarpetaReactivo", async (req, res) => {
    const { nombreReactivo, usuarioAnalista, fabricante, modoReactivosPuros } = req.body;


    const clave = generarClaveBloqueo(nombreReactivo, usuarioAnalista);
    if (bloqueos.has(clave)) {
        return res.status(429).json({
            ok: false,
            error: "Proceso ya en ejecución",
            detalle: "Se rechazó una llamada duplicada para evitar múltiples carpetas."
        });
    }
    bloqueos.set(clave, true);

    try {
        const ModeloBusqueda = modoReactivosPuros
            ? ReactivosPuros
            : InfoSoluciones;

        const info = await ModeloBusqueda.findOne({
            nombre: new RegExp(`^${nombreReactivo}$`, "i")
        });

        if (!info) return res.status(404).json({ error: "Reactivo no encontrado" });
        const codigos = (info.indicaciones || "")
            .split("y")
            .map(c => c.trim())
            .filter(c => c !== "");

        const nombreCarpeta = generarNombreCarpetaUnico();

        // Estas dos cosas no dependen una de la otra: buscar las frases H/P en Mongo
        // y crear la carpeta en Drive. Antes se hacían en cascada; ahora corren juntas.
        const [resultadosFrases, idCarpeta] = await Promise.all([
            Promise.all(codigos.map(cod => Codigo.find({ codigo: cod }))),
            crearCarpetaDentroDeA(nombreCarpeta)
        ]);

        let frasesH = [];
        let frasesP = [];
        resultadosFrases.flat().forEach(item => {
            if (item.frases_h) frasesH.push(...item.frases_h);
            if (item.frases_p) frasesP.push(...item.frases_p);
        });
        frasesH = [...new Set(frasesH)];
        frasesP = [...new Set(frasesP)];
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
Servicios Geológicos Integrados SAS (SGI SAS)
Dirección: Cra. 32B #22B - 29
Teléfono: (601) 813 8530

EN FUNCION DEL CUMPLIMIENTO DE TRAZABILIDAD SE DECLARA QUE LA SOLUCIÓN REENVASADA O MEZCLA PRESENTE EN EL ENVASE ETIQUETADO FUE REALIZADO POR EL ANALISTA AUTORIZADO: ${usuarioAnalista}
    `;

        // Copiar y actualizar documento
        // Estas tres tareas solo necesitan el idCarpeta y no dependen entre sí:
        // subir los PDFs, generar el documento (copiar plantilla + poner negritas),
        // y generar el QR (que ni siquiera necesita el documento). Antes se esperaban
        // una por una y el tiempo total era la SUMA de las tres; en paralelo, el tiempo
        // total es el de la más lenta, no la suma.
        const [, docId, qrBase64] = await Promise.all([
            Promise.all(codigos.map(cod => subirPDFsPorCodigo(cod, idCarpeta, fabricante, modoReactivosPuros))),
            (async () => {
                const id = await copiarYEditarArchivo(PLANTILLA_DOC_ID, idCarpeta, contenido);
                await ponerTitulosEnNegrita(id);
                return id;
            })(),
            generarQR(idCarpeta)
        ]);

        res.json({
            ok: true,
            carpetaId: idCarpeta,
            docId,
            qr: qrBase64,
            mensaje: "Carpeta creada, PDFs subidos y QR generado."
        });

    } catch (err) {
        console.error("Error procesarCarpetaReactivo:", err);
        res.status(500).json({ error: "Error procesando carpeta y archivos" });

    } finally {
        bloqueos.delete(clave);
    }
});

app.post("/api/generarEtiqueta", async (req, res) => {
    const { nombreReactivo, fabricante, volumen, modoReactivosPuros } = req.body;

    try {
        const nombreLimpio = nombreReactivo.trim();
        const nombreRegex = escaparRegex(nombreLimpio);

        const ModeloBusqueda = modoReactivosPuros ? ReactivosPuros : InfoSoluciones;

        const info = await ModeloBusqueda.findOne({
            nombre: { $regex: new RegExp(`^${nombreRegex}$`, "i") }
        });

        if (!info) return res.status(404).json({ error: "No encontrado en InfoSolucionesDB" });

        const listaCodigos = (info.indicaciones || "")
            .split("y")
            .map(c => c.trim())
            .filter(c => c !== "");

        if (listaCodigos.length === 0) {
            return res.status(404).json({ error: "El reactivo no tiene códigos en 'indicaciones'" });
        }

        const primerCodigo = listaCodigos[0];

        const coincidencias = await Codigo.find({ codigo: primerCodigo });

        if (coincidencias.length === 0) {
            return res.status(404).json({ error: `Código principal (${primerCodigo}) no encontrado en ReactivosDB` });
        }

        let seleccion = coincidencias;
        if (fabricante?.trim()) {
            const f = normalizar(fabricante);
            seleccion = coincidencias.filter(c => normalizar(c.nombre).includes(f));

            if (!seleccion.length) {
                return res.status(404).json({
                    error: "Fabricante no coincide",
                    coincidencias
                });
            }
        }

        const reactivoBD = seleccion[0];

        const todosLosPictogramas = reactivoBD.pictogramas || [];
        const volNumerico = parseInt(volumen);

        const listaAEnviar = (volNumerico < 100 && todosLosPictogramas.length > 0)
            ? [todosLosPictogramas[0]]
            : todosLosPictogramas;

        res.json({
            nombre: info.nombre,
            codigo: primerCodigo,
            preparación: info.preparacion || "No aplica",
            palabra_advertencia: reactivoBD.palabra_advertencia,
            frases_h: reactivoBD.frases_h,
            frases_p: reactivoBD.frases_p,

            pictogramas: listaAEnviar,

            imagenPictograma: null,

            fabricanteFiltrado: fabricante || null,
            direccion: reactivoBD.direccion || info.direccion || "",
            telefono: reactivoBD.telefono || info.telefono || "",
            proveedor: info.proveedor || ""
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.get("/api/descargar/:archivo", (req, res) => {
    const archivo = req.params.archivo;
    const ruta = path.join(__dirname, "tmpDescargas", archivo);

    console.log("🟦 Petición de descarga recibida:", archivo);
    console.log("🟦 Buscando archivo en:", ruta);

    if (!fs.existsSync(ruta)) {
        console.log("Archivo NO existe:", ruta);
        return res.status(404).send("Archivo no encontrado");
    }

    res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: *;");

    console.log("Archivo encontrado. Enviando para descarga...");
    res.sendFile(ruta, (err) => {
        if (err) console.log("Error al descargar:", err.message);
        else console.log("Descarga enviada correctamente.");
    });
});

app.put("/api/actualizarPreparacion", async (req, res) => {
    const { nombre, preparacion } = req.body;

    try {
        const infoActualizada = await InfoSoluciones.findOneAndUpdate(
            { nombre: new RegExp(`^${escaparRegex(nombre.trim())}$`, "i") },
            { $set: { preparacion: preparacion } },
            { new: true }
        );

        if (!infoActualizada) {
            return res.status(404).json({ error: "Reactivo no encontrado en InfoSolucionesDB" });
        }

        res.json({ ok: true, mensaje: "Preparación guardada con éxito" });
    } catch (error) {
        console.error("Error al actualizar preparación:", error);
        res.status(500).json({ error: "Error interno al guardar en la base de datos" });
    }
});

app.post("/api/generarDocumentoEtiquetas", generarDocumentoEtiquetas);
app.post("/api/generarDocumentoMultiples", generarMultiplesEtiquetas);
module.exports = { InfoSoluciones, Codigo };

app.listen(4000, () =>
    console.log("Servidor corriendo en http://localhost:4000")
);
