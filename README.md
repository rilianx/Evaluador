# Mediador de retroalimentación entre pares — prototipo

Un estudiante (*retroalimentador*) escribe un comentario sobre el trabajo de un compañero. Antes de que llegue al destinatario, una IA lo evalúa con cinco criterios (especificidad, tono, accionabilidad, equilibrio, alineación) y le hace preguntas y sugerencias para mejorarlo. El estudiante lo refina en rondas sucesivas y lo envía cuando quiere. **La IA no reescribe el comentario**: el texto sigue siendo del estudiante. Cada ronda queda registrada en un Excel para el profesor.

Es la versión en repositorio del notebook de Colab original (`notebooks/mediador_retroalimentacion_pares.ipynb`).

## Inicio rápido

```bash
pip install -r requirements.txt
uvicorn mediador.web:app --reload
```

Abre <http://127.0.0.1:8000> y haz clic en el indicador de modo (arriba a la derecha) para pegar la **API key de OpenAI**. Se guarda en el servidor (`salida/openai_api_key.txt`, fuera de git) y la usan todos los estudiantes; la página nunca la muestra completa. También puedes definirla como `OPENAI_API_KEY` en `.env` (ver `.env.example`); en ese caso tiene prioridad.

## Acceso web

> **Antes de abrirla a otros**, define una contraseña de profesor:
> `export MEDIADOR_CLAVE_ADMIN=algo-secreto` (o en `.env`). Con ella se protegen la API key,
> la edición y prueba del prompt y el registro (que contiene los comentarios de los estudiantes).
> Los estudiantes solo usan la pestaña *Retroalimentar* y no la necesitan.

**1. Misma red (sala de clases, wifi de la universidad)**
```bash
uvicorn mediador.web:app --host 0.0.0.0 --port 8000
```
Los estudiantes entran a `http://<IP-de-tu-computador>:8000` (la IP sale con `ipconfig` en Windows o `ip addr` / `ifconfig` en Linux/Mac). Puede que debas permitir el puerto 8000 en el firewall. Algunas redes institucionales aíslan a los equipos entre sí; en ese caso usa la opción 2.

**2. Enlace público temporal desde tu computador (sin servidor)**
Con el servidor corriendo, en otra terminal:
```bash
cloudflared tunnel --url http://localhost:8000     # https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
# o bien:  ngrok http 8000
```
Te entrega una URL `https://….trycloudflare.com` para compartir. Funciona mientras tu computador y el comando sigan encendidos; la URL cambia cada vez.

**3. Desde Google Colab** (como el notebook original)
```python
!git clone -b ccr-6246fe3b-pt52jl https://github.com/rilianx/Evaluador && cd Evaluador && pip install -q -r requirements.txt
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared && chmod +x cloudflared
import os, subprocess; os.chdir("Evaluador"); os.environ["MEDIADOR_CLAVE_ADMIN"] = "algo-secreto"
subprocess.Popen(["uvicorn", "mediador.web:app", "--port", "8000"])
!./cloudflared tunnel --url http://localhost:8000      # busca la URL https://….trycloudflare.com en la salida
```
Los archivos de `salida/` se pierden al cerrar la sesión de Colab: descarga el Excel desde la pestaña *Registro*.

**4. Servidor permanente (Render, Railway, Fly.io, una VM…)**
El repositorio incluye un `Dockerfile`:
```bash
docker build -t mediador .
docker run -p 8000:8000 -e MEDIADOR_CLAVE_ADMIN=algo-secreto -v $(pwd)/salida:/app/salida mediador
```
En Render/Railway: crea un servicio web desde el repositorio (detecta el Dockerfile), define `MEDIADOR_CLAVE_ADMIN` (y opcionalmente `OPENAI_API_KEY`) en las variables de entorno y agrega un **disco persistente montado en `/app/salida`**; sin él, el registro y la key se borran en cada redespliegue. La plataforma entrega la URL https.

### Modo simulado
Si no hay API key (ni en la página ni en `OPENAI_API_KEY`) (o con `MEDIADOR_MODO=simulado`) el mediador usa reglas heurísticas locales en lugar del modelo. Sirve para probar la interfaz y el flujo sin gastar API; **las evaluaciones no son reales** y el prompt no se usa. La interfaz lo indica arriba a la derecha.

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

Ver `.env.example`. Principales: `OPENAI_API_KEY` (o ingrésala en la página), `MEDIADOR_CLAVE_ADMIN`, `MEDIADOR_MODELO` (por defecto `gpt-5.4-mini`), `MEDIADOR_MAX_ITERACIONES`, `MEDIADOR_MODO`. Para el bot: `TELEGRAM_BOT_TOKEN`, `PROFESOR_CHAT_ID`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`.

## Limitaciones del prototipo

- Los estudiantes no se autentican: cualquiera con el enlace puede elegir ser cualquier estudiante y usar la API key del servidor (con su costo). Las acciones de profesor sí se protegen con `MEDIADOR_CLAVE_ADMIN`. Para más que un piloto controlado haría falta login (p. ej. con la cuenta institucional).
- En la web la "entrega" queda registrada pero no se notifica al destinatario (eso lo hace el bot de Telegram / correo).
- Un solo proceso: las ejecuciones del grafo se serializan (SQLite).
