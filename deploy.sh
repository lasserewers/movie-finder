#!/bin/bash
cd ~/movie-finder
git pull
docker compose -f docker-compose.prod.yml up -d --build
