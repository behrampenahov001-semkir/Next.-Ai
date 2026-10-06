# NEXT

> Tell NEXT what you want. NEXT figures out what needs to happen next.

NEXT is a goal-to-outcome agent MVP. It turns a desired outcome into a small mission map, surfaces dependencies and blockers, and keeps the focus on the next useful action.

## Included
- Web UI
- HTTP API
- MCP server endpoint at /mcp
- MCP tools: create_mission, get_mission, analyze_blocker
- /health
- Docker deployment
- In-memory MVP storage

## Run
npm install
npm start

Open http://localhost:3000

## Docker
docker build -t next-ai .
docker run -p 3000:3000 next-ai

## Status
v0.1.0 intentionally keeps storage in memory so the product loop can be tested quickly. Persistence/auth can be added after the core workflow is validated.
