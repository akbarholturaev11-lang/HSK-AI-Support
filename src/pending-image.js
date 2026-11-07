// Durable 60-second screenshot grace period. D1 stores only the Telegram
// reference, NEVER image bytes. Queue messages contain IDs and a random token.
export const IMAGE_GRACE_SECONDS=60;
const RETRY_LEASE_SECONDS=90;

function photoReference(message) {
  const photo=Array.isArray(message?.photo)?message.photo.at(-1):null;
  const doc=message?.document;
  if(photo?.file_id && Number(photo.file_size||0)<=3_500_000)
    return {type:"photo",file_id:photo.file_id,file_size:Number(photo.file_size||0),mime_type:null};
  if(doc?.file_id && ["image/jpeg","image/png"].includes(doc.mime_type) &&
      Number(doc.file_size||0)<=3_500_000)
    return {type:"document",file_id:doc.file_id,file_size:Number(doc.file_size||0),mime_type:doc.mime_type};
  return null;
}

export function hasHoldableImage(message) {
  return Boolean(photoReference(message) && Number.isSafeInteger(message?.message_id));
}

export async function holdImageForCaption(env,message,ctx,now=Math.floor(Date.now()/1000)) {
  if(!env.IMAGE_DELAY_QUEUE || !env.DB)return false;
  const media=photoReference(message);
  if(!media||!Number.isSafeInteger(message?.message_id))return false;
  const tgId=message.from?.id;
  if(!Number.isSafeInteger(tgId)||tgId<=0)return false;
  const token=crypto.randomUUID();
  try{
    await env.DB.prepare(
      "INSERT INTO pending_images(tg_id,message_id,file_id,file_size,media_type,mime_type,lang,source,created_at,expires_at,token,status,claimed_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',NULL)"
    ).bind(tgId,message.message_id,media.file_id,media.file_size,media.type,media.mime_type,
      ctx.lang,ctx.source,now,now+IMAGE_GRACE_SECONDS,token).run();
  }catch(error){
    console.warn("support_image_hold_db_unavailable",error?.name||"Error");
    return false;
  }
  try{
    await env.IMAGE_DELAY_QUEUE.send({tgId,messageId:message.message_id,token},
      {delaySeconds:IMAGE_GRACE_SECONDS});
    return true;
  }catch{
    // If scheduling failed, remove our exact row. The ordinary immediate
    // Vision path remains available, rather than silently losing the image.
    await env.DB.prepare("DELETE FROM pending_images WHERE tg_id=? AND message_id=? AND token=?")
      .bind(tgId,message.message_id,token).run();
    console.warn("support_image_hold_queue_unavailable");
    return false;
  }
}

export async function claimImageForText(env,tgId,now=Math.floor(Date.now()/1000)) {
  const row=await env.DB.prepare(
    "SELECT * FROM pending_images WHERE tg_id=? AND status='pending' AND expires_at>=? "+
    "ORDER BY created_at DESC,message_id DESC LIMIT 1"
  ).bind(tgId,now).first();
  if(!row)return null;
  const changed=await env.DB.prepare(
    "UPDATE pending_images SET status='processing',claimed_at=? "+
    "WHERE tg_id=? AND message_id=? AND token=? AND status='pending'"
  ).bind(now,tgId,row.message_id,row.token).run();
  return Number(changed.meta?.changes||0)===1?row:null;
}

export async function claimImageFromQueue(env,body,now=Math.floor(Date.now()/1000)) {
  if(!body || !Number.isSafeInteger(body.tgId) || !Number.isSafeInteger(body.messageId) ||
      typeof body.token!=="string" || !/^[a-f0-9-]{36}$/i.test(body.token))
    return {status:"invalid"};
  const row=await env.DB.prepare(
    "SELECT * FROM pending_images WHERE tg_id=? AND message_id=? AND token=? LIMIT 1"
  ).bind(body.tgId,body.messageId,body.token).first();
  if(!row)return {status:"missing"};
  if(row.expires_at>now)
    return {status:"early",delaySeconds:Math.max(1,row.expires_at-now)};
  if(row.status==="processing" && Number(row.claimed_at||0)>now-RETRY_LEASE_SECONDS)
    return {status:"busy",delaySeconds:30};
  const changed=await env.DB.prepare(
    "UPDATE pending_images SET status='processing',claimed_at=? "+
    "WHERE tg_id=? AND message_id=? AND token=? "+
    "AND (status='pending' OR (status='processing' AND claimed_at<=?))"
  ).bind(now,body.tgId,body.messageId,body.token,now-RETRY_LEASE_SECONDS).run();
  if(Number(changed.meta?.changes||0)!==1)return {status:"busy",delaySeconds:30};
  return {status:"claimed",row};
}

export function restoreTelegramImageMessage(row,caption="") {
  const media={file_id:row.file_id,file_size:row.file_size};
  return {message_id:row.message_id,
    ...(row.media_type==="document" ? {document:{...media,mime_type:row.mime_type}} : {photo:[media]}),
    ...(caption?{caption}:{}),
  };
}

export async function finishPendingImage(env,row) {
  await env.DB.prepare("DELETE FROM pending_images WHERE tg_id=? AND message_id=? AND token=?")
    .bind(row.tg_id,row.message_id,row.token).run();
}

export async function releasePendingImage(env,row) {
  await env.DB.prepare(
    "UPDATE pending_images SET status='pending',claimed_at=NULL "+
    "WHERE tg_id=? AND message_id=? AND token=? AND status='processing'"
  ).bind(row.tg_id,row.message_id,row.token).run();
}

// Commands and human operator opt-in must never leave a queued AI screenshot.
export async function cancelPendingImages(env,tgId) {
  await env.DB.prepare("DELETE FROM pending_images WHERE tg_id=?").bind(tgId).run();
}
