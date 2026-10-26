FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake libopenblas-dev liblapack-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY service.py .
EXPOSE 5001
CMD ["sh", "-c", "exec uvicorn service:app --host 0.0.0.0 --port ${PORT:-5001}"]
