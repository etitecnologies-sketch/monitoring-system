.PHONY: help install dev build up down logs clean

help:
	@echo "Monitoring System - Available Commands"
	@echo "======================================"
	@echo "make install      - Install all dependencies"
	@echo "make dev          - Start development environment"
	@echo "make build        - Build Docker images"
	@echo "make up           - Start services (docker-compose up)"
	@echo "make down         - Stop services (docker-compose down)"
	@echo "make logs         - View service logs"
	@echo "make clean        - Clean up containers and volumes"
	@echo "make lint         - Run linter on all services"
	@echo "make test         - Run tests"

install:
	@echo "Installing dependencies..."
	npm install
	cd ingest-api && npm install && cd ..
	cd websocket-server && npm install && cd ..
	cd frontend && npm install && cd ..
	cd processor && pip install -r requirements.txt && cd ..

dev:
	@echo "Starting development environment..."
	docker-compose -f docker-compose.yml up -d
	@echo "Services starting... Check logs with 'make logs'"

build:
	@echo "Building Docker images..."
	docker-compose build --no-cache

up:
	@echo "Starting services..."
	docker-compose up -d
	@echo "Services started. Check logs with 'make logs'"

down:
	@echo "Stopping services..."
	docker-compose down

logs:
	docker-compose logs -f

clean:
	@echo "Cleaning up containers and volumes..."
	docker-compose down -v
	find . -type d -name node_modules -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	@echo "Cleanup complete"

lint:
	@echo "Running linters..."
	npm run lint 2>/dev/null || true
	cd ingest-api && npm run lint 2>/dev/null || true; cd ..
	cd websocket-server && npm run lint 2>/dev/null || true; cd ..
	cd frontend && npm run lint 2>/dev/null || true; cd ..

test:
	@echo "Running tests..."
	npm test

restart:
	@echo "Restarting services..."
	docker-compose restart

ps:
	docker-compose ps

shell-api:
	docker-compose exec ingest-api /bin/sh

shell-ws:
	docker-compose exec websocket /bin/sh

include .env
export

shell-db:
	docker-compose exec db psql -U $(DB_USER) -d $(DB_NAME)

migrate:
	@echo "Running migrations..."
	docker-compose exec db psql -U $(DB_USER) -d $(DB_NAME) -f /docker-entrypoint-initdb.d/schema.sql

.DEFAULT_GOAL := help
