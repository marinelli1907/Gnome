import { diagnoseAppleNotificationPipeline, diagnoseAppleServerAuth, sha256 } from '../_shared/subscription_providers.ts';

const CORS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-gnome-diag-token',
};

const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{
  status,headers:{...CORS,'Content-Type':'application/json'},
});

Deno.serve(async (req:Request) => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if (req.method!=='POST') return reply(405,{status:'UNEXPECTED_ERROR'});
  const expected=Deno.env.get('APPLE_IAP_DIAG_TOKEN_SHA256')?.trim();
  const token=req.headers.get('x-gnome-diag-token')?.trim() ?? '';
  if (!expected || !token || await sha256(token)!==expected) {
    return reply(401,{status:'AUTH_FAILED'});
  }
  const body=await req.json().catch(()=>({})) as {action?:string};
  if (body.action==='notification') {
    return reply(200,{status:await diagnoseAppleNotificationPipeline()});
  }
  return reply(200,{status:await diagnoseAppleServerAuth()});
});
