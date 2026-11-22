/**
 * Registro central del mediador en una Google Sheet (para la versión de GitHub Pages).
 *
 * 1. Crea una Google Sheet → Extensiones → Apps Script → pega este código y guarda.
 * 2. Implementar → Nueva implementación → tipo "Aplicación web":
 *      Ejecutar como: Yo   ·   Quién tiene acceso: Cualquier usuario
 * 3. Copia la URL (termina en /exec) en docs/config.js → registro_url.
 *
 * Cada borrador evaluado agrega una fila; las acciones posteriores del estudiante
 * (REESCRIBIR, ENVIAR, INTENTO_ENVIO_BLOQUEADO) actualizan esa misma fila.
 */
const COLUMNAS = ["sesion", "fecha_hora", "retroalimentador", "destino", "iteracion", "texto",
  "especificidad", "tono", "accionabilidad", "equilibrio", "alineacion", "puntaje_global",
  "listo_para_enviar", "bloqueado", "motivo_bloqueo", "fortalezas", "sugerencias_IA", "mensaje_IA",
  "accion_retroalimentador", "es_version_final", "modelo"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (hoja.getLastRow() === 0) hoja.appendRow(COLUMNAS);
    const d = JSON.parse(e.postData.contents);
    if (d.tipo === "iteracion") {
      hoja.appendRow(COLUMNAS.map((c) => d.fila[c] ?? ""));
    } else if (d.tipo === "accion") {
      const datos = hoja.getDataRange().getValues();
      const cS = COLUMNAS.indexOf("sesion"), cI = COLUMNAS.indexOf("iteracion");
      for (let r = datos.length - 1; r >= 1; r--) {
        if (datos[r][cS] === d.sesion && Number(datos[r][cI]) === Number(d.iteracion)) {
          const cA = COLUMNAS.indexOf("accion_retroalimentador") + 1;
          const previa = datos[r][cA - 1];
          hoja.getRange(r + 1, cA).setValue(previa ? `${previa} → ${d.accion}` : d.accion);
          if (d.accion === "ENVIAR") hoja.getRange(r + 1, COLUMNAS.indexOf("es_version_final") + 1).setValue(true);
          break;
        }
      }
    }
    return ContentService.createTextOutput("ok");
  } finally {
    lock.releaseLock();
  }
}
