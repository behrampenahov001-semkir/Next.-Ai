import { randomUUID } from "node:crypto";
import { z } from "zod";

const PlanSchema = z.object({
  title: z.string().min(1),
  outcome: z.string().min(1),
  successCriteria: z.array(z.string()).max(6),
  assumptions: z.array(z.string()).max(6),
  constraints: z.array(z.string()).max(6),
  steps: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    why: z.string().min(1),
    priority: z.enum(["critical","high","medium","low"]),
    status: z.enum(["next","queued"]),
    dependsOn: z.array(z.string())
  })).min(1).max(12),
  blockers: z.array(z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    severity: z.enum(["low","medium","high"]),
    resolutionHint: z.string().min(1)
  })).max(8),
  nextAction: z.object({
    title: z.string().min(1),
    reason: z.string().min(1),
    estimatedMinutes: z.number().int().min(1).max(1440),
    doneWhen: z.string().min(1)
  })
});

function fallbackPlan(input) {
  const goal = String(input.goal || input.desiredOutcome || "").trim();
  const context = String(input.context || "").trim();
  const deadline = input.deadline || null;
  const title = goal || "Untitled mission";
  const base = [
    ["Clarify the finish line", "Make the desired result observable and specific.", "critical"],
    ["Identify the main dependency", "Find the thing that could stop progress if ignored.", "high"],
    ["Do the smallest useful action", "Create immediate forward movement instead of more planning.", "high"],
    ["Review and replan", "Use the result of the action to choose the next move.", "medium"]
  ];
  const steps = base.map(([t,w,p],i)=>({
    id: randomUUID(), title:t, why:w, priority:p,
    status:i===0?"next":"queued", dependsOn:[]
  }));
  return {
    title,
    outcome: goal || "A concrete result that can be verified.",
    successCriteria: [
      "The intended result is clearly defined.",
      "At least one concrete action has been completed.",
      "Progress can be verified without guessing."
    ],
    assumptions: context ? [context] : [],
    constraints: deadline ? ["Deadline: "+deadline] : [],
    steps,
    blockers: [],
    nextAction: {
      title: steps[0].title,
      reason: steps[0].why,
      estimatedMinutes: 15,
      doneWhen: "You can state the outcome in one clear sentence and know what counts as finished."
    }
  };
}

const responseSchema = {
  type:"object",
  additionalProperties:false,
  required:["title","outcome","successCriteria","assumptions","constraints","steps","blockers","nextAction"],
  properties:{
    title:{type:"string"},
    outcome:{type:"string"},
    successCriteria:{type:"array",items:{type:"string"}},
    assumptions:{type:"array",items:{type:"string"}},
    constraints:{type:"array",items:{type:"string"}},
    steps:{type:"array",items:{
      type:"object",additionalProperties:false,
      required:["id","title","why","priority","status","dependsOn"],
      properties:{
        id:{type:"string"},title:{type:"string"},why:{type:"string"},
        priority:{type:"string",enum:["critical","high","medium","low"]},
        status:{type:"string",enum:["next","queued"]},
        dependsOn:{type:"array",items:{type:"string"}}
      }
    }},
    blockers:{type:"array",items:{
      type:"object",additionalProperties:false,
      required:["id","text","severity","resolutionHint"],
      properties:{
        id:{type:"string"},text:{type:"string"},
        severity:{type:"string",enum:["low","medium","high"]},
        resolutionHint:{type:"string"}
      }
    }},
    nextAction:{type:"object",additionalProperties:false,
      required:["title","reason","estimatedMinutes","doneWhen"],
      properties:{
        title:{type:"string"},reason:{type:"string"},
        estimatedMinutes:{type:"integer"},doneWhen:{type:"string"}
      }
    }
  }
};

async function llmPlan(input) {
  if (!process.env.OPENAI_API_KEY) return null;
  const model=process.env.AI_MODEL || "gpt-6-luna";
  const prompt = [
    "Goal: "+String(input.goal||""),
    "Desired outcome: "+String(input.desiredOutcome||""),
    "Deadline: "+String(input.deadline||"not specified"),
    "Context/constraints: "+String(input.context||"")
  ].join("\n");
  const r=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+process.env.OPENAI_API_KEY,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model,
      instructions:"You are NEXT, an execution-first planning agent. Turn a goal into the smallest credible path to a verifiable outcome. Prefer action over advice. Keep the plan concrete, ordered and realistic. Return only the requested JSON.",
      input:prompt,
      text:{format:{type:"json_schema",name:"next_plan",strict:true,schema:responseSchema}}
    })
  });
  if(!r.ok) throw new Error("AI provider returned HTTP "+r.status);
  const data=await r.json();
  const raw=data.output_text;
  if(!raw) throw new Error("AI provider returned no output");
  return PlanSchema.parse(JSON.parse(raw));
}

export async function createPlan(input={}) {
  const normalized={
    goal:String(input.goal||input.desiredOutcome||"").trim(),
    desiredOutcome:String(input.desiredOutcome||"").trim(),
    deadline:input.deadline||null,
    context:String(input.context||"").trim()
  };
  if(!normalized.goal) throw new Error("goal is required");
  try {
    const ai=await llmPlan(normalized);
    if(ai) return {...ai, provider:"openai", model:process.env.AI_MODEL||"gpt-6-luna"};
  } catch (error) {
    console.warn("NEXT AI provider unavailable; using fallback:",error.message);
  }
  return {...fallbackPlan(normalized), provider:"fallback"};
}

export { PlanSchema };
