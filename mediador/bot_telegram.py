"""Bot de Telegram (opcional), equivalente al del notebook.

Ejecutar:  python -m mediador.bot_telegram   (requiere TELEGRAM_BOT_TOKEN)
Comandos: /soy <alias>, /retro <alias_destino>, /cancelar, /tarea, /miid
"""
import asyncio
import json
import os
import smtplib
import uuid
from email.message import EmailMessage

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from . import config, contenido
from .consola import formatear
from .grafo import continuar_sesion, iniciar_sesion

DIRECTORIO = contenido.cargar_directorio()
SESIONES: dict[int, dict] = {}  # chat_id -> {"thread_id", "alias", "destino", "fase": "borrador"|"bucle"}
PROFESOR_CHAT_ID = int(os.environ.get("PROFESOR_CHAT_ID") or 0) or None


def cargar_chats() -> dict:
    return json.loads(config.ARCHIVO_CHATS.read_text()) if config.ARCHIVO_CHATS.exists() else {}


def guardar_chat(alias, chat_id):
    chats = cargar_chats()
    chats[alias] = chat_id
    config.ARCHIVO_CHATS.write_text(json.dumps(chats, indent=2))


def alias_de(chat_id):
    return next((a for a, c in cargar_chats().items() if c == chat_id), None)


def enviar_correo(destinatario, asunto, cuerpo) -> bool:
    user, pwd = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    if not (user and pwd and destinatario):
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = user, destinatario, asunto
    msg.set_content(cuerpo)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(user, pwd)
        s.send_message(msg)
    return True


AYUDA = ("👋 Soy el mediador de retroalimentación del curso.\n\n"
         "1️⃣  /soy <alias>  — identifícate.\n"
         "2️⃣  /retro <alias_destino>  — inicia una retroalimentación.\n"
         "3️⃣  Pega tu comentario; responde con una nueva versión o escribe ENVIAR.\n\n"
         "Otros: /cancelar, /tarea (ver enunciado y rúbrica).")


async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(AYUDA)


async def cmd_soy(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    alias = " ".join(ctx.args).strip().lower()
    if alias not in DIRECTORIO:
        return await update.message.reply_text("No encuentro ese alias en el directorio.")
    guardar_chat(alias, update.effective_chat.id)
    await update.message.reply_text(f"Listo, {DIRECTORIO[alias]['nombre']}. Usa /retro <alias>.")


async def cmd_tarea(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(contenido.leer_rubrica()[:4000])


async def cmd_retro(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    alias = alias_de(chat_id)
    if not alias:
        return await update.message.reply_text("Primero identifícate con /soy <alias>.")
    destino = " ".join(ctx.args).strip().lower()
    if destino not in DIRECTORIO:
        return await update.message.reply_text("Ese alias de destino no existe.")
    if destino == alias:
        return await update.message.reply_text("No puedes retroalimentarte a ti mismo 🙂")
    SESIONES[chat_id] = {"thread_id": f"tg-{chat_id}-{uuid.uuid4().hex[:8]}",
                         "alias": alias, "destino": destino, "fase": "borrador"}
    await update.message.reply_text(f"Retroalimentación para {DIRECTORIO[destino]['nombre']}. "
                                    "Pega tu comentario en un solo mensaje.")


async def cmd_miid(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(f"Tu chat_id es {update.effective_chat.id}")


async def cmd_cancelar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    SESIONES.pop(update.effective_chat.id, None)
    await update.message.reply_text("Sesión cancelada.")


async def texto(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    s = SESIONES.get(chat_id)
    if not s:
        return await update.message.reply_text("Usa /retro <alias> para comenzar.")
    await update.message.chat.send_action("typing")
    if s["fase"] == "borrador":
        r = await asyncio.to_thread(iniciar_sesion, s["thread_id"], s["alias"], s["destino"], update.message.text)
        s["fase"] = "bucle"
    else:
        r = await asyncio.to_thread(continuar_sesion, s["thread_id"], update.message.text)
    if r["bloqueado"] and PROFESOR_CHAT_ID:
        await ctx.bot.send_message(PROFESOR_CHAT_ID, f"⚠️ Comentario bloqueado. De: {s['alias']} → "
                                                     f"{s['destino']} · sesión {s['thread_id']}")
    if not r["terminado"]:
        return await update.message.reply_text(formatear(r))
    canales = []
    chat_destino = cargar_chats().get(s["destino"])
    if chat_destino:
        await ctx.bot.send_message(chat_destino, "📨 " + r["mensaje_final"])
        canales.append("Telegram")
    if enviar_correo(DIRECTORIO[s["destino"]].get("correo"), "Retroalimentación de un compañero", r["mensaje_final"]):
        canales.append("correo")
    SESIONES.pop(chat_id, None)
    via = " y ".join(canales) if canales else "el registro (el destinatario aún no se registra)"
    await update.message.reply_text(f"✅ Enviado a {DIRECTORIO[s['destino']]['nombre']} vía {via}.")


def main():
    app = Application.builder().token(os.environ["TELEGRAM_BOT_TOKEN"]).build()
    for nombre, fn in [("start", cmd_start), ("ayuda", cmd_start), ("soy", cmd_soy), ("retro", cmd_retro),
                       ("cancelar", cmd_cancelar), ("tarea", cmd_tarea), ("miid", cmd_miid)]:
        app.add_handler(CommandHandler(nombre, fn))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, texto))
    print("🤖 Bot corriendo (Ctrl+C para detener).")
    app.run_polling()


if __name__ == "__main__":
    main()
