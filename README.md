# Mediador de retroalimentación entre pares — prototipo

Un estudiante (*retroalimentador*) escribe un comentario sobre el trabajo de un compañero. Antes de que llegue al destinatario, una IA lo evalúa con cinco criterios (especificidad, tono, accionabilidad, equilibrio, alineación) y le hace preguntas y sugerencias para mejorarlo. El estudiante lo refina en rondas sucesivas y lo envía cuando quiere. **La IA no reescribe el comentario**: el texto sigue siendo del estudiante. Cada ronda queda registrada para el profesor.

Es la versión en repositorio del notebook de Colab original (`notebooks/mediador_retroalimentacion_pares.ipynb`). Hay dos formas de usarlo:

| | **GitHub Pages** (`docs/`) | **Servidor Python** (`mediador/`) |
|---|---|---|
| Acceso | `https://rilianx.github.io/Evaluador/`: sin instalar nada | Hay que dejar corriendo un servidor |
| IA | El navegador llama directo a OpenAI con la key ingresada en la página | El servidor llama a OpenAI (LangGraph) |
| Prompt editado | Se guarda en ese navegador; para todos, se sube al repo | Se guarda en el servidor para todos |
| Registro | En cada navegador (CSV) + opcional Google Sheet central | Excel central en el servidor |
| Extras | — | Bot de Telegram, entrega por correo |

---

## Opción A: GitHub Pages (recomendada para el piloto)

### Publicarla (una sola vez)
1. En GitHub: **Settings → Pages**.
2. *Build and deployment* → Source: **Deploy from a branch**.
3. Branch: la rama con este código (hoy `ccr-6246fe3b-pt52jl`, o `main` si la fusionas) y carpeta **`/docs`** → *Save*.
4. En uno o dos minutos queda en **https://rilianx.github.io/Evaluador/**. Cada `push` a esa rama la actualiza.

GitHub Pages es gratis en repositorios públicos. **Todo lo que está en el repo es visible para cualquiera**, así que no subas datos de estudiantes ni la API key.

### La API key
Haz clic en el indicador de arriba a la derecha (⚙️ *Modo simulado · 🔑 configurar*) y pega la key. Queda guardada **solo en ese navegador** (localStorage) y se envía directo a `api.openai.com`; no pasa por GitHub.

Para que los estudiantes no tengan que pegarla, el mismo diálogo tiene **«Copiar enlace con key»**, que genera `https://rilianx.github.io/Evaluador/#key=sk-…`. Al abrirlo, la key se guarda y desaparece de la barra de direcciones. Lo que va después de `#` nunca se envía a GitHub.

> ⚠️ En una página estática **no hay forma de ocultar la key a quien la usa**: cualquier estudiante con el enlace puede extraerla.
> - Crea una key **de proyecto** solo para el piloto, con **límite de gasto** (platform.openai.com → Projects → Limits).
> - Comparte el enlace por un canal privado (aula virtual o correo), no en un lugar público.
> - **Revócala** al terminar el piloto.
> - **Nunca** la escribas en `docs/config.js` ni en otro archivo del repo: GitHub la detecta, OpenAI la revoca automáticamente y cualquiera podría usarla.
>
> Si eso no es aceptable, usa la opción B: allí la key queda en el servidor y los estudiantes nunca la ven.

### Registro central (opcional, Google Sheets)
Por defecto cada estudiante ve su registro solo en su navegador (pestaña *Registro*, con descarga en CSV que Excel abre bien). Para reunir el de todos:
1. Crea una Google Sheet → *Extensiones → Apps Script* → pega `docs/registro_google_sheets.gs`.
2. *Implementar → Nueva implementación → Aplicación web*: ejecutar como **tú**, acceso **cualquier usuario**.
3. Copia la URL `…/exec` en `docs/config.js` → `registro_url` y haz push.

Cada borrador evaluado agrega una fila a la hoja, y las acciones posteriores (REESCRIBIR / ENVIAR / INTENTO_ENVIO_BLOQUEADO) actualizan esa misma fila.

### Cambiar el prompt, la tarea o el modelo para todos
- **Prompt**: en la pestaña *Prompt del mediador*, edítalo y pruébalo; *Guardar* lo usa solo en tu navegador. Cuando te guste, *Descargar .md* y súbelo como `docs/prompts/prompt_mediador.md` (en GitHub: abrir el archivo → ✏️ → pegar → *Commit*).
- **Tarea**: reemplaza `docs/datos/rubrica.md` y `docs/datos/trabajo_ejemplo.md`, y ajusta `autor_trabajo` en `docs/config.js`.
- **Modelo / rondas**: en `docs/config.js` (cada usuario puede cambiarlos en ⚙️ solo para su navegador).

### Probarla localmente
```bash
python -m http.server -d docs 8000      # y abre http://localhost:8000
```
(Abrir `index.html` con doble clic no funciona: el navegador no deja cargar los `.md` desde `file://`.)

---

## Opción B: servidor Python

```bash
pip install -r requirements.txt
uvicorn mediador.web:app --reload        # http://127.0.0.1:8000
```
La API key se pega en la página (indicador de arriba a la derecha) y queda en el servidor (`salida/openai_api_key.txt`, fuera de git); la usan todos y nadie la ve completa. También puede ir en `.env` como `OPENAI_API_KEY`, y en ese caso tiene prioridad.

**Antes de abrirla a otros** define `MEDIADOR_CLAVE_ADMIN=algo-secreto`: protege la key, la edición/prueba del prompt y el registro.

Cómo exponerla:
- **Misma red**: `uvicorn mediador.web:app --host 0.0.0.0 --port 8000` → `http://<tu-IP>:8000`.
- **Enlace público temporal**: `cloudflared tunnel --url http://localhost:8000` (o `ngrok http 8000`).
- **Colab**:
  ```python
  !git clone -b ccr-6246fe3b-pt52jl https://github.com/rilianx/Evaluador && cd Evaluador && pip install -q -r requirements.txt
  !wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared && chmod +x cloudflared
  import os, subprocess; os.chdir("Evaluador"); os.environ["MEDIADOR_CLAVE_ADMIN"] = "algo-secreto"
  subprocess.Popen(["uvicorn", "mediador.web:app", "--port", "8000"])
  !./cloudflared tunnel --url http://localhost:8000
  ```
- **Servidor permanente** (Render, Railway, VM): hay un `Dockerfile`. Monta un disco persistente en `/app/salida`.

Otros: `python -m mediador.consola` (prueba en terminal), `python -m mediador.bot_telegram` (bot, requiere `TELEGRAM_BOT_TOKEN`), `pytest -q` (tests). Variables en `.env.example`.

---

## Modo simulado
Sin API key, ambas versiones usan reglas heurísticas locales en lugar del modelo. Sirve para probar la interfaz y el flujo sin gastar; **las evaluaciones no son reales** y el prompt no se usa. La interfaz lo indica arriba a la derecha.

## La interfaz (GitHub Pages)

| Sección | Para qué |
|---|---|
| **Trabajo del estudiante** | El informe que se va a retroalimentar. |
| **Retroalimentar** | Escribes tu comentario (o eliges uno de los **ejemplos** del selector «📋 Cargar un ejemplo…» en la misma ventana), pulsas *Revisar con la IA*, ves los puntajes y preguntas, editas el mismo texto y vuelves a revisar. Cada ronda muestra qué cambiaste respecto a la anterior. *Enviar* solo se habilita si la última versión fue revisada y no está bloqueada. La **rúbrica** está al lado. |
| **⚙️ Opciones generales** | **API key y modelo**; **Prompt del mediador**: ver, editar, probar un borrador, «Probar todos los ejemplos» (tabla de puntajes vs. lo esperado) y ver el prompt completo que recibe el modelo; **Registro**: todas las rondas y descarga CSV. |

La versión de servidor Python (`mediador/static/`) conserva la disposición anterior en pestañas (Retroalimentar / Prompt / Registro).

## Reglas del flujo

```
evaluar → esperar → decidir ─┬─ REESCRIBIR → evaluar
                             ├─ ENVIAR + bloqueado → rechazar → esperar
                             └─ ENVIAR → entregar → FIN
```

- Toda versión nueva pasa por la IA antes de poder enviarse.
- Si la IA marca `bloqueado` (insultos, ataques personales, contenido discriminatorio o texto que no es retroalimentación), el comentario **no puede enviarse** hasta reescribirlo. Un comentario solo seco o duro no se bloquea: baja el puntaje de Tono.
- Tras las rondas sugeridas (3 por defecto) la IA deja de pedir mejoras de fondo y solo verifica tono/bloqueo.
- La sesión en curso se conserva si se recarga la página.

En Python esto es un grafo LangGraph (`mediador/grafo.py`); en GitHub Pages, la misma máquina de estados en JavaScript (`docs/mediador.js`).

## Estructura

```
docs/                         sitio de GitHub Pages (y datos compartidos)
  index.html, app.js          interfaz
  mediador.js                 motor: estados, llamada a OpenAI, evaluador simulado, registro
  config.js                   modelo, rondas, autor, registro_url (público: ¡sin key!)
  registro_google_sheets.gs   Apps Script para el registro central
  prompts/prompt_mediador.md  prompt (lo usan ambas versiones)
  datos/rubrica.md            enunciado + rúbrica (Informe de laboratorio N°2, péndulo simple)
  datos/trabajo_ejemplo.md    informe de ejemplo a retroalimentar
  datos/ejemplos_retroalimentacion.json  borradores de ejemplo para probar
mediador/                     versión servidor (FastAPI + LangGraph + Excel + Telegram)
datos/directorio.csv          estudiantes para el bot de Telegram (no se publica en Pages)
tests/test_flujo.py           tests de la versión Python
```

## Trabajo de ejemplo

`docs/datos/trabajo_ejemplo.md` es un informe de laboratorio con aciertos y problemas deliberados, para que haya cosas concretas que comentar:

- **Hipótesis**: correcta pero vaga; no explicita supuestos (ángulos pequeños).
- **Procedimiento**: no dice número de repeticiones, ángulo inicial ni precisión de instrumentos.
- **Análisis**: tabla sin incertidumbres; grafica T vs L (curva) en vez de linealizar; calcula *g* con un solo punto.
- **Conclusiones**: generaliza de más ("para cualquier péndulo", "muy preciso").

## Ejemplos de retroalimentación para probar

En *Retroalimentar* y en *Probar el prompt* hay un selector **«📋 Cargar un ejemplo…»** que pone en el cuadro un borrador típico y muestra qué debería responder el mediador. Incluye: genérico, solo elogios, duro pero válido (no debe bloquearse), ofensivo (debe bloquearse), con una afirmación falsa sobre el trabajo, desalineado con la rúbrica, mejorable, bien logrado y uno que no es retroalimentación.

Están en `docs/datos/ejemplos_retroalimentacion.json`: puedes editarlos o agregar más con la forma `{"titulo", "esperado", "texto"}`. Los usan ambas versiones. En modo simulado los resultados no coinciden con lo esperado; la comparación tiene sentido con el modelo real.

## Prompt

Marcadores que se rellenan en cada ronda: `{tarea}` (rúbrica), `{trabajo}`, `{borrador}` (obligatorio), `{iteracion}`, `{max_iteraciones}`, `{supera_rondas_sugeridas}`. Cualquier otra llave se deja tal cual.

Respecto del notebook, el prompt ahora incluye el **texto del trabajo** (`{trabajo}`), para que la IA pueda comprobar si el comentario se refiere a partes reales del informe.

## Limitaciones del prototipo

- Los estudiantes no se autentican: escriben su nombre.
- En GitHub Pages la key es visible para quien tenga el enlace (ver arriba). En el servidor Python, cualquiera con el enlace puede usarla, pero no verla.
- La "entrega" queda registrada y se muestra al estudiante, pero no se notifica al destinatario (solo el bot de Telegram/correo lo hace).
