import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createPlan } from "./src/agent.js";

const app=express();
app.use(express.json({limit:"1mb"}));
app.use(express.static("public"));
const missions=new Map();

function buildMission(input){
  const now=new Date().toISOString();
  const mission={id:randomUUID(),title:String(input.title).trim(),desiredOutcome:String(input.desiredOutcome||input.title).trim(),deadline:input.deadline||null,createdAt:now,updatedAt:now,status:"active",steps:[
    {id:randomUUID(),title:"Define the outcome",status:"next"},
    {id:randomUUID(),title:"Identify the critical dependencies",status:"queued"},
    {id:randomUUID(),title:"Take the smallest useful next action",status:"queued"}],blockers:[]};
  missions.set(mission.id,mission); return mission;
}
const getMission=id=>missions.get(id);
const touch=m=>m.updatedAt=new Date().toISOString();

app.get("/health",(req,res)=>res.json({ok:true,service:"next-ai",version:"0.3.0",ai:Boolean(process.env.OPENAI_API_KEY)}));
app.get("/api/missions",(req,res)=>res.json([...missions.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))));
app.post("/api/missions",(req,res)=>{const title=String(req.body?.title||"").trim();if(!title)return res.status(400).json({error:"title is required"});res.status(201).json(buildMission(req.body))});

app.post("/api/plan",async(req,res)=>{
  try{
    const plan=await createPlan(req.body||{});
    res.json(plan);
  }catch(error){
    res.status(400).json({error:error.message});
  }
});

app.post("/api/missions/from-plan",async(req,res)=>{
  try{
    const plan=await createPlan(req.body||{});
    const mission=buildMission({title:plan.title,desiredOutcome:plan.outcome,deadline:req.body?.deadline||null});
    mission.steps=plan.steps.map((step,i)=>({
      ...step,
      status:i===0?"next":"queued"
    }));
    mission.blockers=plan.blockers;
    mission.agent={provider:plan.provider,model:plan.model||null,nextAction:plan.nextAction};
    touch(mission);
    res.status(201).json(mission);
  }catch(error){
    res.status(400).json({error:error.message});
  }
});

app.get("/api/missions/:id",(req,res)=>{const m=getMission(req.params.id);m?res.json(m):res.status(404).json({error:"mission not found"})});
app.patch("/api/missions/:id/steps/:stepId",(req,res)=>{
  const m=getMission(req.params.id);if(!m)return res.status(404).json({error:"mission not found"});
  const step=m.steps.find(x=>x.id===req.params.stepId);if(!step)return res.status(404).json({error:"step not found"});
  if(req.body?.status!=="done")return res.status(400).json({error:"status must be done"});
  step.status="done";const next=m.steps.find(x=>x.status==="queued");if(next)next.status="next";
  if(m.steps.every(x=>x.status==="done"))m.status="completed";touch(m);res.json(m);
});
app.post("/api/missions/:id/blocker",(req,res)=>{
  const m=getMission(req.params.id);if(!m)return res.status(404).json({error:"mission not found"});
  const text=String(req.body?.text||"").trim();if(!text)return res.status(400).json({error:"text is required"});
  const blocker={id:randomUUID(),text,severity:req.body?.severity||"medium",createdAt:new Date().toISOString()};
  m.blockers.push(blocker);touch(m);
  res.json({blocker,recommendation:"Name the decision, missing input, person or action that would remove this blocker."});
});

const mcp=new McpServer({name:"next-ai",version:"0.3.0"});
mcp.tool("create_mission","Create a mission and its first next actions.",{title:z.string().min(1),desiredOutcome:z.string().optional(),deadline:z.string().optional()},async({title,desiredOutcome,deadline})=>({content:[{type:"text",text:JSON.stringify(buildMission({title,desiredOutcome,deadline}),null,2)}]}));
mcp.tool("plan_goal","Turn a goal into an execution plan and one next action.",{goal:z.string().min(1),desiredOutcome:z.string().optional(),deadline:z.string().optional(),context:z.string().optional()},async(input)=>({content:[{type:"text",text:JSON.stringify(await createPlan(input),null,2)}]}));
mcp.tool("get_mission","Get a mission by id.",{id:z.string()},async({id})=>({content:[{type:"text",text:JSON.stringify(getMission(id)||{error:"mission not found"},null,2)}]}));
mcp.tool("complete_step","Complete a mission step and advance the next queued step.",{missionId:z.string(),stepId:z.string()},async({missionId,stepId})=>{const m=getMission(missionId);if(!m)return {content:[{type:"text",text:"mission not found"}]};const s=m.steps.find(x=>x.id===stepId);if(!s)return {content:[{type:"text",text:"step not found"}]};s.status="done";const n=m.steps.find(x=>x.status==="queued");if(n)n.status="next";if(m.steps.every(x=>x.status==="done"))m.status="completed";touch(m);return {content:[{type:"text",text:JSON.stringify(m,null,2)}]}});
mcp.tool("analyze_blocker","Turn a blocker into a concrete next action.",{missionId:z.string(),blocker:z.string().min(1)},async({missionId,blocker})=>{const m=getMission(missionId);if(m){m.blockers.push({id:randomUUID(),text:blocker,severity:"medium",createdAt:new Date().toISOString()});touch(m)}return {content:[{type:"text",text:JSON.stringify({blocker,diagnosis:"The blocker needs to be specific.",nextAction:"Identify the smallest observable action or decision that removes or tests it."},null,2)}]}});

app.post("/mcp",async(req,res)=>{const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});res.on("close",()=>transport.close());await mcp.connect(transport);await transport.handleRequest(req,res,req.body)});
const port=Number(process.env.PORT||3000);app.listen(port,()=>console.log("NEXT running on http://localhost:"+port));
