"""Lectura/escritura de los textos editables: prompt, rúbrica, trabajo y directorio."""
import csv
import json
import re

from . import config


def leer(ruta) -> str:
    return ruta.read_text(encoding="utf-8") if ruta.exists() else ""


def leer_prompt() -> str:
    return leer(config.ARCHIVO_PROMPT)


def validar_prompt(texto: str) -> list[str]:
    """Devuelve advertencias/errores sobre los marcadores del prompt."""
    usados = set(re.findall(r"\{(\w+)\}", texto))
    problemas = []
    for m in config.MARCADORES_OBLIGATORIOS:
        if m not in usados:
            problemas.append(f"Falta el marcador obligatorio {{{m}}}.")
    desconocidos = sorted(u for u in usados if u not in config.MARCADORES_PROMPT)
    if desconocidos:
        problemas.append("Marcadores desconocidos (se dejarán tal cual): "
                         + ", ".join("{" + d + "}" for d in desconocidos))
    return problemas


def guardar_prompt(texto: str) -> None:
    config.ARCHIVO_PROMPT.write_text(texto, encoding="utf-8")


def restaurar_prompt() -> str:
    texto = leer(config.ARCHIVO_PROMPT_ORIGINAL)
    guardar_prompt(texto)
    return texto


def rellenar_prompt(plantilla: str, **valores) -> str:
    """Sustituye solo los marcadores conocidos, así el prompt puede contener otras llaves sin romperse."""
    def reemplazo(m):
        k = m.group(1)
        return str(valores[k]) if k in valores else m.group(0)
    return re.sub(r"\{(\w+)\}", reemplazo, plantilla)


def leer_rubrica() -> str:
    return leer(config.ARCHIVO_RUBRICA)


def leer_trabajo() -> str:
    return leer(config.ARCHIVO_TRABAJO)


def leer_ejemplos() -> list[dict]:
    """Borradores de ejemplo para probar (docs/datos/ejemplos_retroalimentacion.json)."""
    try:
        return json.loads(leer(config.ARCHIVO_EJEMPLOS) or "[]")
    except json.JSONDecodeError:
        return []


def cargar_directorio() -> dict[str, dict]:
    with open(config.ARCHIVO_DIRECTORIO, encoding="utf-8") as f:
        return {r["alias"].strip().lower(): r for r in csv.DictReader(f)}
