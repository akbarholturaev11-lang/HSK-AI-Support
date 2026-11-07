import test from "node:test";
import assert from "node:assert/strict";
import {
 IMAGE_GRACE_SECONDS,hasHoldableImage,holdImageForCaption,claimImageForText,
 claimImageFromQueue,restoreTelegramImageMessage,finishPendingImage,
 releasePendingImage,cancelPendingImages
} from "../src/pending-image.js";

function fakeState(){
 const rows=new Map(),scheduled=[];
 let failQueue=false,clock=1700000000;
 const env={
   DB:{prepare(sql){return {bind(...a){return {
     async first(){
       if(sql.includes("WHERE tg_id=? AND status='pending'")){
         return [...rows.values()].filter(r=>r.tg_id===a[0]&&r.status==="pending"&&r.expires_at>=a[1])
           .sort((x,y)=>y.created_at-x.created_at||y.message_id-x.message_id)[0]||null;
       }
       if(sql.includes("WHERE tg_id=? AND message_id=? AND token=?"))
         return rows.get(a[0]+":"+a[1])?.token===a[2]?rows.get(a[0]+":"+a[1]):null;
       throw Error("Unexpected select "+sql);
     },
     async run(){
       if(sql.startsWith("INSERT INTO pending_images")){
         const [tg_id,message_id,file_id,file_size,media_type,mime_type,lang,source,created_at,expires_at,token]=a;
         const key=tg_id+":"+message_id;
         if(rows.has(key))throw Error("duplicate");
         rows.set(key,{tg_id,message_id,file_id,file_size,media_type,mime_type,lang,source,
           created_at,expires_at,token,status:"pending",claimed_at:null});
         return {meta:{changes:1}};
       }
       if(sql.startsWith("UPDATE pending_images SET status='processing'")){
         const [at,tg,id,token,lease]=a,row=rows.get(tg+":"+id);
         if(!row||row.token!==token)return {meta:{changes:0}};
         if(lease===undefined ? row.status!=="pending" :
             !(row.status==="pending"||(row.status==="processing"&&row.claimed_at<=lease)))
           return {meta:{changes:0}};
         row.status="processing";row.claimed_at=at;return {meta:{changes:1}};
       }
       if(sql.startsWith("UPDATE pending_images SET status='pending'")){
         const [tg,id,token]=a,row=rows.get(tg+":"+id);
         if(row?.token===token&&row.status==="processing"){row.status="pending";row.claimed_at=null;return {meta:{changes:1}}}
         return {meta:{changes:0}};
       }
       if(sql.startsWith("DELETE FROM pending_images")){
         if(a.length===1){
           let n=0;for(const [k,row] of rows)if(row.tg_id===a[0]){rows.delete(k);n++;}
           return {meta:{changes:n}};
         }
         const [tg,id,token]=a,row=rows.get(tg+":"+id);
         if(row?.token!==token)return {meta:{changes:0}};
         rows.delete(tg+":"+id);return {meta:{changes:1}};
       }
       throw Error("Unexpected mutation "+sql);
     }
   }}}}},
   IMAGE_DELAY_QUEUE:{async send(body,options){
     if(failQueue)throw Error("queue unavailable");
     scheduled.push({body,options});return {};
   }}
 };
 const user={id:77},ctx={lang:"uz",source:"direct"};
 const image=(id=100)=>({from:user,message_id:id,photo:[{file_id:"photo_reference_"+id,file_size:300}]});
 return {env,rows,scheduled,user,ctx,image,getNow:()=>clock,setQueueError(v){failQueue=v;}};
}

test("bare Telegram photo holds only file ID and schedules exactly 60-second delay",async()=>{
 const f=fakeState();assert.equal(IMAGE_GRACE_SECONDS,60);
 assert.equal(hasHoldableImage(f.image()),true);
 assert.equal(await holdImageForCaption(f.env,f.image(),f.ctx,f.getNow()),true);
 assert.equal(f.rows.size,1);
 assert.equal(f.scheduled.length,1);
 assert.equal(f.scheduled[0].options.delaySeconds,60);
 assert.deepEqual(Object.keys(f.scheduled[0].body).sort(),["messageId","tgId","token"]);
 const row=[...f.rows.values()][0];
 assert.equal(row.expires_at-row.created_at,60);
 assert.equal(row.file_id,"photo_reference_100");
 assert.ok(!Object.keys(row).some(k=>/base64|bytes|caption|ocr/i.test(k)));
});

test("text 59s later atomically joins the original image; queue later becomes a no-op",async()=>{
 const f=fakeState();await holdImageForCaption(f.env,f.image(),f.ctx,f.getNow());
 const row=await claimImageForText(f.env,77,f.getNow()+59);
 assert.ok(row);
 const restored=restoreTelegramImageMessage(row,"Дарс тугмаси жуда кичик");
 assert.equal(restored.message_id,100);
 assert.equal(restored.photo[0].file_id,"photo_reference_100");
 assert.equal(restored.caption,"Дарс тугмаси жуда кичик");
 assert.equal(await claimImageForText(f.env,77,f.getNow()+59),null);
 await finishPendingImage(f.env,row);
 assert.equal((await claimImageFromQueue(f.env,f.scheduled[0].body,f.getNow()+61)).status,"missing");
});

test("no text triggers exactly once after one minute and handles early queue triggers",async()=>{
 const f=fakeState();await holdImageForCaption(f.env,f.image(),f.ctx,f.getNow());
 const body=f.scheduled[0].body;
 let result=await claimImageFromQueue(f.env,body,f.getNow()+45);
 assert.deepEqual(result,{status:"early",delaySeconds:15});
 result=await claimImageFromQueue(f.env,body,f.getNow()+60);
 assert.equal(result.status,"claimed");
 assert.deepEqual(await claimImageFromQueue(f.env,body,f.getNow()+60),{status:"busy",delaySeconds:30});
 await finishPendingImage(f.env,result.row);
 assert.equal((await claimImageFromQueue(f.env,body,f.getNow()+120)).status,"missing");
});

test("text arriving after expiration is not attached to an old screenshot",async()=>{
 const f=fakeState();await holdImageForCaption(f.env,f.image(),f.ctx,f.getNow());
 assert.equal(await claimImageForText(f.env,77,f.getNow()+61),null);
 assert.equal((await claimImageFromQueue(f.env,f.scheduled[0].body,f.getNow()+61)).status,"claimed");
});

test("multiple separate photos are not silently overwritten and latest receives nearby text",async()=>{
 const f=fakeState();
 await holdImageForCaption(f.env,f.image(101),f.ctx,f.getNow());
 await holdImageForCaption(f.env,f.image(102),f.ctx,f.getNow()+1);
 const last=await claimImageForText(f.env,77,f.getNow()+5);
 assert.equal(last.message_id,102);
 assert.equal(f.rows.size,2);
 const earlier=await claimImageFromQueue(f.env,f.scheduled[0].body,f.getNow()+65);
 assert.equal(earlier.row.message_id,101);
});

test("explicit /start or human escalation cancellation makes scheduled messages inert",async()=>{
 const f=fakeState();await holdImageForCaption(f.env,f.image(),f.ctx,f.getNow());
 await cancelPendingImages(f.env,77);
 assert.equal(f.rows.size,0);
 assert.equal((await claimImageFromQueue(f.env,f.scheduled[0].body,f.getNow()+60)).status,"missing");
});

test("Queue schedule failure removes durable pending state so existing immediate AI path can recover",async()=>{
 const f=fakeState();f.setQueueError(true);
 const prior=console.warn;console.warn=()=>{};
 try{assert.equal(await holdImageForCaption(f.env,f.image(),f.ctx,f.getNow()),false);}
 finally{console.warn=prior;}
 assert.equal(f.rows.size,0);
});

test("processing lease can be recovered but cannot create competing simultaneous workers",async()=>{
 const f=fakeState();await holdImageForCaption(f.env,f.image(),f.ctx,f.getNow());
 const body=f.scheduled[0].body;
 const first=await claimImageFromQueue(f.env,body,f.getNow()+60);
 assert.equal(first.status,"claimed");
 assert.equal((await claimImageFromQueue(f.env,body,f.getNow()+90)).status,"busy");
 const later=await claimImageFromQueue(f.env,body,f.getNow()+151);
 assert.equal(later.status,"claimed");
 await releasePendingImage(f.env,later.row);
 assert.equal((await claimImageFromQueue(f.env,body,f.getNow()+152)).status,"claimed");
});

test("file references from unsupported documents or oversized photos never enter Queue",async()=>{
 const f=fakeState();
 assert.equal(hasHoldableImage({from:f.user,message_id:1,document:{file_id:"a",mime_type:"application/pdf"}}),false);
 assert.equal(hasHoldableImage({from:f.user,message_id:2,photo:[{file_id:"a",file_size:4000000}]}),false);
 assert.equal(await holdImageForCaption(f.env,{from:f.user,message_id:3,document:{
   file_id:"bad",mime_type:"application/pdf"}},f.ctx,f.getNow()),false);
 assert.equal(f.scheduled.length,0);
});

test("a forged Queue message cannot access unrelated D1 rows",async()=>{
 const f=fakeState();await holdImageForCaption(f.env,f.image(),f.ctx,f.getNow());
 for(const body of [{tgId:77,messageId:100,token:"fake"},{tgId:77,messageId:100,token:"../secrets"},
  {tgId:"77",messageId:100,token:f.scheduled[0].body.token}]){
  const x=await claimImageFromQueue(f.env,body,f.getNow()+61);
  assert.ok(["missing","invalid"].includes(x.status));
 }
 assert.equal(f.rows.size,1);
});
