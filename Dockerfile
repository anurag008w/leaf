FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r user --gid 1000 \
    && useradd -r -g user --uid 1000 -d /app -s /bin/bash user \
    && mkdir -p /data /app/data /app/__pycache__ \
    && chmod 777 /data /app/data

COPY --chown=user:user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY --chown=user:user . .

RUN chmod +x entrypoint.sh

EXPOSE 7860

USER user

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:7860/health || exit 1

CMD ["./entrypoint.sh"]
