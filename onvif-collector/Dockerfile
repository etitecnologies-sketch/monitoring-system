FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY onvif_collector.py /app/onvif_collector.py
COPY config.example.json /app/config.example.json

ENV PYTHONUNBUFFERED=1

CMD ["python", "/app/onvif_collector.py"]
