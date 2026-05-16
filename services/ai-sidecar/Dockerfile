FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir \
    fastapi==0.115.0 \
    uvicorn[standard]==0.32.0 \
    pydantic==2.9.0 \
    pandas==2.2.3 \
    duckdb==1.1.1 \
    openpyxl==3.1.5 \
    ollama==0.3.3 \
    "docling>=2.0,<3.0" \
    python-multipart==0.0.12

COPY . .

# F16/F3: run as an unprivileged user. The sandbox dir must be writable by
# that user (uploads land there); nothing else needs write access.
ENV SANDBOX_DIR=/home/appuser/ses-ai-sandbox
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p "$SANDBOX_DIR" \
    && chown -R appuser:appuser "$SANDBOX_DIR" /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
