# NEXT

> Tell NEXT what you want. NEXT finds the next move.

NEXT is a goal-to-outcome agent MVP. A mission becomes a sequence of actions, with blockers surfaced separately so the user always has a concrete next move.

## v0.2
- Mission progression and completion
- Automatic activation of the next queued step
- Blocker capture and actionable blocker recommendation
- HTTP API
- MCP server at /mcp
- MCP tools: create_mission, get_mission, complete_step, analyze_blocker
- Health endpoint and Docker support

## Run
npm install
npm start

Open http://localhost:3000.

## Docker
docker build -t next-ai .
docker run -p 3000:3000 next-ai

## Core loop
Outcome → Next action → Complete → Advance → Handle blockers.

The MVP uses in-memory storage so the product loop can be tested quickly. Durable storage and authentication can follow after the core experience is validated.
