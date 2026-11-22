FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Excel, SQLite y la API key ingresada desde la página viven aquí: monta un volumen para no perderlos.
VOLUME /app/salida
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn mediador.web:app --host 0.0.0.0 --port ${PORT}"]
