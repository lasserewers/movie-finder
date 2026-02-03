#!/bin/bash
cd ~/movie-finder
source .venv/bin/activate
npm run dev --prefix frontend &
uvicorn backend.main:app --reload
