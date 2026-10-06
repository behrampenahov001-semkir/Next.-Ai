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

app.get("/health",(req,res)=>res.json({ok:true,service:"next-ai",version:"0.4.0",ai:Boolean(process.env.OPENAI_API_KEY)}));
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
    mission.steps=plan.steps.map((step,i)=>({...step,status:i===0?"next":"queued"}));
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

function registerMcpTools(server){
  server.tool("create_mission","Create a mission with an outcome, deadline, and executable next steps. Use this when the user wants to start tracking a goal.",{title:z.string().min(1),desiredOutcome:z.string().optional(),deadline:z.string().optional()},async({title,desiredOutcome,deadline})=>({content:[{type:"text",text:JSON.stringify(buildMission({title,desiredOutcome,deadline}),null,2)}]}));

  server.tool("plan_goal","Turn a goal into a structured execution plan with success criteria, ordered steps, blockers, and one immediate next action. Use this when the user wants a plan before execution.",{goal:z.string().min(1),desiredOutcome:z.string().optional(),deadline:z.string().optional(),context:z.string().optional()},async(input)=>({content:[{type:"text",text:JSON.stringify(await createPlan(input),null,2)}]}));

  server.tool("get_mission","Retrieve the current state of a NEXT AI mission by id. Use this to inspect progress before taking another mission action.",{id:z.string()},async({id})=>({content:[{type:"text",text:JSON.stringify(getMission(id)||{error:"mission not found"},null,2)}]}));

  server.tool("complete_step","Mark one mission step done and activate the next queued step. Use this after the user confirms a step is complete.",{missionId:z.string(),stepId:z.string()},async({missionId,stepId})=>{
    const m=getMission(missionId);if(!m)return {content:[{type:"text",text:"mission not found"}]};
    const s=m.steps.find(x=>x.id===stepId);if(!s)return {content:[{type:"text",text:"step not found"}]};
    s.status="done";const n=m.steps.find(x=>x.status==="queued");if(n)n.status="next";
    if(m.steps.every(x=>x.status==="done"))m.status="completed";touch(m);
    return {content:[{type:"text",text:JSON.stringify(m,null,2)}]};
  });

  server.tool("analyze_blocker","Record a blocker and turn it into a concrete, testable next action. Use this when progress is blocked.",{missionId:z.string(),blocker:z.string().min(1)},async({missionId,blocker})=>{
    const m=getMission(missionId);
    if(m){m.blockers.push({id:randomUUID(),text:blocker,severity:"medium",createdAt:new Date().toISOString()});touch(m);}
    return {content:[{type:"text",text:JSON.stringify({blocker,diagnosis:"The blocker needs to be specific.",nextAction:"Identify the smallest observable action or decision that removes or tests it."},null,2)}]};
  });
}

function createMcpServer(){
  const server=new McpServer({
    name:"next-ai",
    version:"0.4.0",
    instructions:"NEXT AI converts goals into executable missions. Prefer plan_goal for planning, create_mission for starting tracking, get_mission before inspecting progress, complete_step only after confirmed completion, and analyze_blocker when progress is blocked."
  });
  registerMcpTools(server);
  return server;
}

app.post("/mcp",async(req,res)=>{
  const mcp=createMcpServer();
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
  res.on("close",()=>transport.close());
  try{
    await mcp.connect(transport);
    await transport.handleRequest(req,res,req.body);
  }catch(error){
    if(!res.headersSent)res.status(500).json({error:"MCP request failed"});
  }
});

const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log("NEXT running on http://localhost:"+port));
