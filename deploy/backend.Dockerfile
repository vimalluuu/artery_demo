FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements-model.txt ./
ARG INSTALL_MODEL=false
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 vascuai \
    && useradd --uid 10001 --gid 10001 --no-create-home vascuai \
    && mkdir -p /data/uploads /data/outputs \
    && chown -R 10001:10001 /data
RUN if [ "$INSTALL_MODEL" = "true" ]; then pip install --no-cache-dir -r requirements-model.txt --index-url https://download.pytorch.org/whl/cpu; fi
COPY backend/app/ ./app/
COPY backend/migrations/ ./migrations/
COPY backend/alembic.ini ./
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
