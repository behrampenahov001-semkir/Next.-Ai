# NEXT

> Tell NEXT what you want. NEXT finds the next move.

NEXT is an execution-first goal agent. It turns a goal into a mission map, identifies dependencies and blockers, and chooses one concrete next action.

## v0.3 — Agent core
- Structured AI planning engine with Zod validation
- Goal → outcome → steps → blockers → next action
- Optional OpenAI Responses API provider
- Deterministic fallback planner when no API key is configured
- `POST /api/plan`
- `POST /api/missions/from-plan`
- MCP tool: `plan_goal`
- Existing mission progression and blocker tools retained

The architecture keeps the AI provider behind one agent function, so the product can evolve without rewriting the mission engine.

## Run
npm install
npm start

Open http://localhost:3000.

### Enable the AI planner
Copy `.env.example` to `.env` and set:

```
OPENAI_API_KEY=your_key
AI_MODEL=gpt-6-luna
```

Without `OPENAI_API_KEY`, NEXT still works using the built-in deterministic planner.

## API example

```json
POST /api/plan
{
  "goal": "Launch my first online service",
  "desiredOutcome": "First paying customer",
  "deadline": "2026-12-01",
  "context": "Solo founder, limited budget"
}
```

The response contains success criteria, ordered steps, dependencies, blockers, and exactly one recommended next action.

## Docker
docker build -t next-ai .
docker run -p 3000:3000 next-ai

## Core loop
Outcome → Next action → Complete → Advance → Handle blockers → Replan.
