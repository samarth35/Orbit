# syntax=docker/dockerfile:1

FROM node:20-slim AS web
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html ./
COPY src ./src
COPY shared ./shared
COPY package.json ./
RUN npm run build

FROM python:3.12-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY --from=web /app/dist ./dist
RUN mkdir -p /app/data

EXPOSE 8000
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
