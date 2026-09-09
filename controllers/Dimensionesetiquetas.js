/* ==========================================================
   DIMENSIONES por grupo de envase (compartido)
   Antes estaba duplicado en generarEtiquetas.js y
   generarMultiplesEtiquetas.js — ahora vive en un solo lugar.
========================================================== */

const DIMENSIONES = {
  // Grupo 0 → 3.7 cm alto × 5.3 cm ancho (pulgadas)
  grupo0: { width: 2.0866, height: 1.4567 },

  grupo1: { width: 3.933071, height: 2.629921 }, // 100mL - 1000mL
  grupo2: { width: 4.1456693, height: 2.940945 }, // 2000mL - 3000mL
  grupo3: { width: 8, height: 4.2795276 } // 10L - 50L
};

function obtenerDimensionesPorEnvase(envase) {
  const v = String(envase).toLowerCase().replace(/\s/g, "");

  console.log("📌 ENVASE RECIBIDO:", envase);
  console.log("🔄 ENVASE NORMALIZADO:", v);

  if (["30", "30ml", "40", "40ml", "60", "60ml"].includes(v)) {
    console.log("➡ APLICADO GRUPO 0");
    return DIMENSIONES.grupo0;
  }

  if (["100", "100ml", "250", "250ml", "500", "500ml", "1000", "1000ml"].includes(v)) {
    console.log("➡ APLICADO GRUPO 1");
    return DIMENSIONES.grupo1;
  }

  if (["2000", "2000ml", "3000", "3000ml"].includes(v)) {
    console.log("➡ APLICADO GRUPO 2");
    return DIMENSIONES.grupo2;
  }

  if (["10000", "10l", "20000", "20l", "30000", "30l", "40000", "40l", "50000", "50l"].includes(v)) {
    console.log("➡ APLICADO GRUPO 3");
    return DIMENSIONES.grupo3;
  }

  console.log("⚠ No coincide ningún grupo → usando GRUPO 1 por defecto");
  return DIMENSIONES.grupo1;
}

module.exports = { DIMENSIONES, obtenerDimensionesPorEnvase };
