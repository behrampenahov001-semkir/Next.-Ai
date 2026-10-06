import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app=express();
app.use(express.json({limit:"1mb"}));
app.use(express.static("public"));

const missions=new Map();

function buildMission(input){
  const id=randomUUID();
  const now=new Date().toISOString();
  const mission={
    id,title:input.title,desiredOutcome:input.desiredOutcome||input.title,
    deadline:input.deadline||null,createdAt:now,updatedAt:now,
    status:"active",
    steps:[
      {id:randomUUID(),title:"Define the outcome",status:"next"},
      {id:randomUUID(),title:"Identify the critical dependencies",status:"blocked"},
      {id:randomUUID(),title:"Take the smallest useful next action",status:"queued"}
    ],
    blockers:[]
  };
  missions.set(id,mission);
  return mission;
}

app.get("/health",(req,res)=>res.json({ok:true,service:"next-ai",version:"0.1.0"}));
app.get("/api/missions",(req,res)=>res.json([...missions.values()]));
app.post("/api/missions",(req,res)=>{
  if(!req.body?.title) return res.status(400).json({error:"title is required"});
  res.status(201).json(buildMission(req.body));
});
app.get("/api/missions/:id",(req,res)=>{
  const m=missions.get(req.params.id);
  m?res.json(m):res.status(404).json({error:"mission not found"});
});
app.post("/api/missions/:id/blocker",(req,res)=>{
  const m=missions.get(req.params.id);
  if(!m) return res.status(404).json({error:"mission not found"});
  const text=String(req.body?.text||"").trim();
  if(!text) return res.status(400).json({error:"text is required"});
  const blocker={id:randomUUID(),text,severity:req.body?.severity||"medium",createdAt:new Date().toISOString()};
  m.blockers.push(blocker);m.updatedAt=new Date().toISOString();
  res.json({blocker,recommendation:"Reduce this blocker to one concrete action or decision that can be completed next."});
});

const mcp=new McpServer({name:"next-ai",version:"0.1.0"});
mcp.tool("create_mission","Create a mission and its first next actions.",
  {title:z.string(),desiredOutcome:z.string().optional(),deadline:z.string().optional()},
  async({title,desiredOutcome,deadline})=>({content:[{type:"text",text:JSON.stringify(buildMission({title,desiredOutcome,deadline}),null,2)}]}));
mcp.tool("get_mission","Get a mission by id.",{id:z.string()},
  async({id})=>({content:[{type:"text",text:JSON.stringify(missions.get(id)||{error:"mission not found"},null,2)}]}));
mcp.tool("analyze_blocker","Turn a blocker into a concrete next action.",{missionId:z.string(),blocker:z.string()},
  async({missionId,blocker})=>{
    const m=missions.get(missionId);
    if(m) m.blockers.push({id:randomUUID(),text:blocker,severity:"medium",createdAt:new Date().toISOString()});
    return {content:[{type:"text",text:JSON.stringify({blocker,diagnosis:"The blocker needs to be made specific.",nextAction:"Write the smallest observable action that removes or tests the blocker."},null,2)}]};
  });

app.post("/mcp",async(req,res)=>{
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
  res.on("close",()=>transport.close());
  await mcp.connect(transport);
  await transport.handleRequest(req,res,req.body);
});

const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`NEXT running on http://localhost:${port}`));
