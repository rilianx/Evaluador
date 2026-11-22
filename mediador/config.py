"""Configuración del mediador: rutas, modelo y claves (desde variables de entorno o .env)."""
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def _cargar_dotenv(ruta: Path) -> None:
    """Lector mínimo de .env (KEY=valor) para no depender de python-dotenv."""
    if not ruta.exists():
        return
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        k, v = linea.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if v and not os.environ.get(k):
            os.environ[k] = v


_cargar_dotenv(RAIZ / ".env")

MODELO = os.environ.get("MEDIADOR_MODELO", "gpt-5.4-mini")
MAX_ITERACIONES = int(os.environ.get("MEDIADOR_MAX_ITERACIONES", "3"))


# Prompt, rúbrica y trabajo viven en docs/ porque también los usa la versión de GitHub Pages.
DIR_PROMPTS = RAIZ / "docs" / "prompts"
DIR_DOCS_DATOS = RAIZ / "docs" / "datos"
DIR_DATOS = RAIZ / "datos"
DIR_SALIDA = Path(os.environ.get("MEDIADOR_SALIDA", RAIZ / "salida"))
DIR_SALIDA.mkdir(parents=True, exist_ok=True)

ARCHIVO_PROMPT = DIR_PROMPTS / "prompt_mediador.md"
ARCHIVO_PROMPT_ORIGINAL = DIR_PROMPTS / "prompt_mediador.original.md"
ARCHIVO_RUBRICA = Path(os.environ.get("MEDIADOR_RUBRICA", DIR_DOCS_DATOS / "rubrica.md"))
ARCHIVO_TRABAJO = Path(os.environ.get("MEDIADOR_TRABAJO", DIR_DOCS_DATOS / "trabajo_ejemplo.md"))
ARCHIVO_DIRECTORIO = DIR_DATOS / "directorio.csv"
AUTOR_TRABAJO = os.environ.get("MEDIADOR_AUTOR_TRABAJO", "beto")  # alias del autor del trabajo de ejemplo

ARCHIVO_XLSX = DIR_SALIDA / "registro_retroalimentacion.xlsx"
ARCHIVO_DB = DIR_SALIDA / "checkpoints.sqlite"
ARCHIVO_CHATS = DIR_SALIDA / "chats_telegram.json"
ARCHIVO_CLAVE = DIR_SALIDA / "openai_api_key.txt"   # key ingresada desde la interfaz (no va a git)

# Contraseña del profesor: si está definida, se pide para cambiar la API key o el prompt desde la web.
CLAVE_ADMIN = os.environ.get("MEDIADOR_CLAVE_ADMIN", "")


def clave_openai() -> tuple[str, str]:
    """(key, origen). La variable de entorno tiene prioridad sobre la ingresada en la interfaz."""
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"], "entorno"
    if ARCHIVO_CLAVE.exists() and ARCHIVO_CLAVE.read_text().strip():
        return ARCHIVO_CLAVE.read_text().strip(), "interfaz"
    return "", ""


def modo() -> str:
    """"openai" llama al modelo; "simulado" usa heurísticas locales (sin API) para probar la interfaz."""
    forzado = os.environ.get("MEDIADOR_MODO", "").lower()
    if forzado:
        return forzado
    return "openai" if clave_openai()[0] else "simulado"

# Marcadores que el prompt puede usar ({nombre}); el resto de llaves se deja tal cual.
MARCADORES_PROMPT = ("tarea", "trabajo", "borrador", "iteracion", "max_iteraciones", "supera_rondas_sugeridas")
MARCADORES_OBLIGATORIOS = ("borrador",)
