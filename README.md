# Mediador de retroalimentación entre pares — prototipo

Un estudiante (*retroalimentador*) escribe un comentario sobre el trabajo de un compañero. Antes de que llegue al destinatario, una IA lo evalúa con cinco criterios (especificidad, tono, accionabilidad, equilibrio, alineación) y le hace preguntas y sugerencias para mejorarlo. El estudiante lo refina en rondas sucesivas y lo envía cuando quiere. **La IA no reescribe el comentario**: el texto sigue siendo del estudiante. Cada ronda queda registrada en un Excel para el profesor.

Es la versión en repositorio del notebook de Colab original (`notebooks/mediador_retroalimentacion_pares.ipynb`).

## Inicio rápido

```bash
pip install -r requirements.txt
cp .env.example .env          # pon tu OPENAI_API_KEY (opcional, ver "Modo simulado")
uvicorn mediador.web:app --reload
```

Abre <http://127.0.0.1:8000>.

### Modo simulado
Si no hay `OPENAI_API_KEY` (o con `MEDIADOR_MODO=simulado`) el mediador usa reglas heurísticas locales en lugar del modelo. Sirve para probar la interfaz y el flujo sin gastar API; **las evaluaciones no son reales** y el prompt no se usa. La interfaz lo indica arriba a la derecha.

## La interfaz

| Pestaña | Para qué |
|---|---|
| **Retroalimentar** | A la izquierda, el trabajo del compañero y la rúbrica. A la derecha escribes tu comentario, pulsas *Revisar con la IA*, ves los puntajes y preguntas, editas el mismo texto y vuelves a revisar. Cada ronda muestra qué cambiaste respecto a la anterior. *Enviar* solo se habilita si la última versión fue revisada y no está bloqueada. |
| **Prompt del mediador** | Ver y editar `prompts/prompt_mediador.md`. Puedes **probar** un borrador con el prompt del editor antes de guardarlo y ver el **prompt completo** que recibe el modelo. Los cambios guardados aplican desde la siguiente evaluación, sin reiniciar. *Restaurar original* vuelve a `prompt_mediador.original.md`. |
| **Registro** | Tabla de todas las rondas (bloqueos en rojo, versión enviada en verde) y descarga del Excel. |

## Reglas del flujo (grafo LangGraph)

```
evaluar → esperar (interrupt) → decidir ─┬─ REESCRIBIR → evaluar
                                         ├─ ENVIAR + bloqueado → rechazar → esperar
                                         └─ ENVIAR → entregar → FIN
```

- Toda versión nueva pasa por la IA antes de poder enviarse.
- Si la IA marca `bloqueado` (insultos, ataques personales, contenido discriminatorio o texto que no es retroalimentación), el comentario **no puede enviarse** hasta reescribirlo. Un comentario solo seco o duro no se bloquea: baja el puntaje de Tono.
- Tras `MEDIADOR_MAX_ITERACIONES` rondas (3 por defecto) la IA deja de pedir mejoras de fondo y solo verifica tono/bloqueo.
- El estado de cada sesión se guarda en SQLite (`salida/checkpoints.sqlite`); si recargas la página, la sesión se retoma.

## Estructura

```
mediador/
  config.py        rutas, modelo, modo (lee .env)
  evaluador.py     modelo con salida estructurada + evaluador simulado
  grafo.py         grafo LangGraph y API iniciar/continuar sesión
  registro.py      Excel para el profesor
  contenido.py     prompt (validar/rellenar), rúbrica, trabajo, directorio
  web.py           API FastAPI + interfaz
  static/          index.html, app.js, estilo.css, marked.min.js (markdown sin CDN)
  consola.py       prueba en terminal: python -m mediador.consola
  bot_telegram.py  bot opcional: python -m mediador.bot_telegram
prompts/
  prompt_mediador.md           prompt editable
  prompt_mediador.original.md  copia para "Restaurar original"
datos/
  rubrica.md          enunciado + rúbrica (Informe de laboratorio N°2, péndulo simple)
  trabajo_ejemplo.md  informe de ejemplo a retroalimentar (autor: beto)
  directorio.csv      estudiantes (alias, nombre, correo)
salida/             (se crea sola, ignorada por git) Excel, SQLite, chats de Telegram
tests/test_flujo.py pruebas del flujo en modo simulado: pytest -q
```

## Trabajo de ejemplo

`datos/trabajo_ejemplo.md` es un informe de laboratorio con aciertos y problemas deliberados, para que haya cosas concretas que comentar:

- **Hipótesis**: correcta pero vaga; no explicita supuestos (ángulos pequeños).
- **Procedimiento**: no dice número de repeticiones, ángulo inicial ni precisión de instrumentos.
- **Análisis**: tabla sin incertidumbres; grafica T vs L (curva) en vez de linealizar; calcula *g* con un solo punto.
- **Conclusiones**: generaliza de más ("para cualquier péndulo", "muy preciso").

Para usar otra tarea, reemplaza `datos/rubrica.md` y `datos/trabajo_ejemplo.md` (o apunta `MEDIADOR_RUBRICA` / `MEDIADOR_TRABAJO` a otros archivos) y ajusta `MEDIADOR_AUTOR_TRABAJO`.

## Prompt

Marcadores que se rellenan en cada ronda: `{tarea}` (rúbrica), `{trabajo}`, `{borrador}` (obligatorio), `{iteracion}`, `{max_iteraciones}`, `{supera_rondas_sugeridas}`. Cualquier otra llave se deja tal cual, así que puedes escribir JSON o ejemplos con `{}` sin romper nada.

Respecto del notebook, el prompt ahora incluye el **texto del trabajo** (`{trabajo}`), para que la IA pueda comprobar si el comentario se refiere a partes reales del informe y avisar cuando afirma algo que no es cierto.

## Variables de entorno

Ver `.env.example`. Principales: `OPENAI_API_KEY`, `MEDIADOR_MODELO` (por defecto `gpt-5.4-mini`), `MEDIADOR_MAX_ITERACIONES`, `MEDIADOR_MODO`. Para el bot: `TELEGRAM_BOT_TOKEN`, `PROFESOR_CHAT_ID`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`.

## Limitaciones del prototipo

- Sin autenticación: cualquiera que abra la página puede elegir ser cualquier estudiante y editar el prompt. Pensado para uso local o piloto controlado.
- En la web la "entrega" queda registrada pero no se notifica al destinatario (eso lo hace el bot de Telegram / correo).
- Un solo proceso: las ejecuciones del grafo se serializan (SQLite).
