// Configuración común para todos los que abran la página (edítala en GitHub).
// ⚠️ NO pongas aquí la API key: este archivo es público. La key se ingresa en la página (🔑).
window.MEDIADOR_CONFIG = {
  modelo: "gpt-5.4-mini",
  max_iteraciones: 3,          // rondas "sugeridas": después la IA solo verifica tono/bloqueo
  autor_trabajo: "Roberto Díaz",
  archivo_trabajo: "datos/trabajo_ejemplo.md",
  archivo_rubrica: "datos/rubrica.md",
  archivo_prompt: "prompts/prompt_mediador.md",
  archivo_ejemplos: "datos/ejemplos_retroalimentacion.json",   // borradores de ejemplo para probar
  // URL de una aplicación web de Google Apps Script que recibe el registro de todos los
  // estudiantes en una Google Sheet (ver docs/registro_google_sheets.gs). Vacío = solo registro local.
  registro_url: "",
};
