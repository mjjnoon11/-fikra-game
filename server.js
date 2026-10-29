const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8000);
const rooms = new Map();
const quizzes = new Map();
const QUESTION_SECONDS = 20;
const MAX_PLAYERS = 24;
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() { let s=''; for(let i=0;i<6;i++) s+=codeChars[crypto.randomInt(codeChars.length)]; return s; }
function makeQuizCode() { let s; do { s = makeCode(); } while (quizzes.has(s)); return s; }
function sanitizeQuizQuestions(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const item of arr.slice(0, 60)) {
    if (!item || typeof item !== 'object') continue;
    const q = String(item.q || '').trim().slice(0, 300);
    const options = Array.isArray(item.options) ? item.options.map(o => String(o || '').trim().slice(0, 120)).filter(Boolean).slice(0, 6) : [];
    const correct = Number(item.correct);
    if (!q || options.length < 2 || !(correct >= 0 && correct < options.length)) continue;
    const img = item.img ? String(item.img).trim().slice(0, 8) : null;
    out.push({ q, options, correct, img: img || null });
  }
  return out.length ? out : null;
}
function safeQuizForParticipant(quiz) {
  return { code: quiz.code, title: quiz.title, questionCount: quiz.questions.length, questions: quiz.questions.map(q => ({ q: q.q, options: q.options, img: q.img || null })) };
}
function safeQuizForCreator(quiz) {
  return { code: quiz.code, title: quiz.title, questionCount: quiz.questions.length, questions: quiz.questions, submissionCount: quiz.submissions.length };
}
function csvEscape(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function json(res, status, body) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>25000){reject(new Error('too large'));req.destroy();}});req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}});req.on('error',reject);}); }
function tick(room) {
  if(room.status!=='playing') return;
  const now=Date.now();
  const allAnswered=room.players.length>0 && room.players.every(p=>room.answers[p.id]);
  if(now>=room.deadline || (allAnswered && now>=room.allAnsweredAt+1200)) {
    room.questionIndex++;
    room.answers={}; room.allAnsweredAt=0;
    if(room.questionIndex>=room.questionCount){room.status='finished';room.deadline=0;}
    else if(room.questionIndex%room.stageSize===0){room.status='intermission';room.questionStartedAt=0;room.deadline=0;}
    else{room.questionStartedAt=now;room.deadline=now+QUESTION_SECONDS*1000;}
  }
}
const REACTION_EMOJIS = new Set(['👏','😂','🔥','😮','👎','❤️','🎉','🤔']);
function pruneReactions(room) {
  const cutoff = Date.now() - 15000;
  room.reactions = (room.reactions||[]).filter(r=>r.at>=cutoff).slice(-12);
}
function safeRoom(room, playerId) {
  tick(room);
  pruneReactions(room);
  return {code:room.code,category:room.category,mode:room.mode,hostId:room.hostId,status:room.status,questionIndex:room.questionIndex,questionCount:room.questionCount,stageSize:room.stageSize,stageNumber:Math.floor(room.questionIndex/room.stageSize)+1,questionStartedAt:room.questionStartedAt,deadline:room.deadline,players:room.players.map(p=>({id:p.id,name:p.name,score:p.score,team:p.team,isHost:p.id===room.hostId,answered:!!room.answers[p.id]})),myPlayerId:playerId||null,reactions:room.reactions,reactionSeq:room.reactionSeq||0};
}
function sendError(res,status,message){json(res,status,{error:message});}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
  try {
    if(url.pathname==='/api/health' && req.method==='GET') return json(res,200,{ok:true,rooms:rooms.size});
    if(url.pathname==='/api/rooms' && req.method==='POST'){
      const b=await readBody(req); const id=String(b.playerId||'').slice(0,80); if(!id)return sendError(res,400,'معرّف اللاعب مطلوب');
      let code; do{code=makeCode()}while(rooms.has(code));
      const host={id,name:String(b.name||'لاعب فضولي').trim().slice(0,24)||'لاعب فضولي',score:0,team:b.mode==='فرق'?'الفريق ١':null};
      const room={code,category:String(b.category||'علوم واكتشافات').slice(0,50),mode:b.mode==='فرق'?'فرق':'فردي',hostId:id,players:[host],status:'waiting',questionIndex:0,questionCount:Math.max(1,Math.min(100,Number(b.questionCount)||20)),stageSize:Math.max(2,Math.min(10,Number(b.stageSize)||5)),questionStartedAt:0,deadline:0,answers:{},allAnsweredAt:0,createdAt:Date.now(),reactions:[],reactionSeq:0};rooms.set(code,room);
      return json(res,201,safeRoom(room,id));
    }
    const match=url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(join|start|answer|continue|leave|react))?$/i);
    if(match){const code=match[1].toUpperCase(), action=match[2]||'';const room=rooms.get(code);if(!room)return sendError(res,404,'لم نعثر على تحدٍّ بهذا الرمز. اطلب من المضيف إنشاء تحدٍ جديد.');
      if(req.method==='GET'&&!action)return json(res,200,safeRoom(room,url.searchParams.get('playerId')));
      if(req.method==='POST'&&action==='join'){
        const b=await readBody(req),id=String(b.playerId||'').slice(0,80);if(!id)return sendError(res,400,'معرّف اللاعب مطلوب');
        if(room.status!=='waiting')return sendError(res,409,'بدأ التحدّي بالفعل ولا يمكن الانضمام الآن.');
        let p=room.players.find(x=>x.id===id);if(!p){if(room.players.length>=MAX_PLAYERS)return sendError(res,409,'وصل التحدّي إلى الحد الأقصى للاعبين.');const team=room.mode==='فرق'?(room.players.filter(x=>x.team==='الفريق ١').length<=room.players.filter(x=>x.team==='الفريق ٢').length?'الفريق ١':'الفريق ٢'):null;p={id,name:String(b.name||'لاعب جديد').trim().slice(0,24)||'لاعب جديد',score:0,team};room.players.push(p)}
        return json(res,200,safeRoom(room,id));
      }
      if(req.method==='POST'&&action==='start'){
        const b=await readBody(req);if(b.playerId!==room.hostId)return sendError(res,403,'بدء اللعبة متاح للمضيف فقط.');if(room.status==='waiting'){room.status='playing';room.questionIndex=0;room.questionStartedAt=Date.now();room.deadline=Date.now()+QUESTION_SECONDS*1000;room.answers={};}return json(res,200,safeRoom(room,b.playerId));
      }
      if(req.method==='POST'&&action==='continue'){
        const b=await readBody(req);if(b.playerId!==room.hostId)return sendError(res,403,'المضيف فقط يمكنه فتح المرحلة التالية.');if(room.status!=='intermission')return sendError(res,409,'لا توجد مرحلة تنتظر البدء.');room.status='playing';room.questionStartedAt=Date.now();room.deadline=Date.now()+QUESTION_SECONDS*1000;room.answers={};room.allAnsweredAt=0;return json(res,200,safeRoom(room,b.playerId));
      }
      if(req.method==='POST'&&action==='answer'){
        const b=await readBody(req);tick(room);if(room.status!=='playing')return sendError(res,409,'هذه الجولة انتهت.');if(Number(b.questionIndex)!==room.questionIndex)return sendError(res,409,'انتقلت اللعبة إلى السؤال التالي.');const player=room.players.find(p=>p.id===b.playerId);if(!player)return sendError(res,403,'انضم إلى اللعبة أولاً.');
        if(!room.answers[player.id]){const correct=!!b.correct;const points=correct?Math.max(10,Math.min(100,Number(b.points)||10)):0;room.answers[player.id]={correct,points};player.score+=points;if(room.players.every(p=>room.answers[p.id]))room.allAnsweredAt=Date.now();}
        return json(res,200,{ok:true,correct:room.answers[player.id].correct,points:room.answers[player.id].points,score:player.score,room:safeRoom(room,player.id)});
      }
      if(req.method==='POST'&&action==='react'){
        const b=await readBody(req),id=String(b.playerId||'');
        const player=room.players.find(p=>p.id===id);
        if(!player)return sendError(res,403,'انضم إلى اللعبة أولاً.');
        const emoji=REACTION_EMOJIS.has(b.emoji)?b.emoji:'👏';
        pruneReactions(room);
        room.reactionSeq=(room.reactionSeq||0)+1;
        room.reactions.push({id:room.reactionSeq,playerId:id,name:player.name,emoji,at:Date.now()});
        room.reactions=room.reactions.slice(-12);
        return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&action==='leave'){
        const b=await readBody(req),id=String(b.playerId||'');
        const idx=room.players.findIndex(p=>p.id===id);
        if(idx===-1)return sendError(res,403,'لست عضواً في هذه الغرفة.');
        room.players.splice(idx,1);
        delete room.answers[id];
        if(room.players.length===0){rooms.delete(code);return json(res,200,{ok:true,left:true});}
        if(room.hostId===id)room.hostId=room.players[0].id;
        return json(res,200,{ok:true,left:true,room:safeRoom(room,null)});
      }
      return sendError(res,405,'الطلب غير مدعوم.');
    }
    if(url.pathname==='/api/quizzes' && req.method==='POST'){
      const b=await readBody(req); const creatorId=String(b.creatorId||'').slice(0,80); if(!creatorId)return sendError(res,400,'معرّف المُنشئ مطلوب');
      const questions=sanitizeQuizQuestions(b.questions); if(!questions)return sendError(res,400,'أضف سؤالاً واحداً على الأقل، كل سؤال يحتاج نصاً وخيارين على الأقل وإجابة صحيحة محددة.');
      const code=makeQuizCode();
      const quiz={code,creatorId,title:String(b.title||'اختبار').trim().slice(0,80)||'اختبار',questions,submissions:[],createdAt:Date.now()};
      quizzes.set(code,quiz);
      return json(res,201,safeQuizForCreator(quiz));
    }
    const qmatch=url.pathname.match(/^\/api\/quizzes\/([A-Z0-9]+)(?:\/(submit|results|export))?$/i);
    if(qmatch){const code=qmatch[1].toUpperCase(),action=qmatch[2]||'';const quiz=quizzes.get(code);if(!quiz)return sendError(res,404,'لم نعثر على اختبار بهذا الرمز.');
      if(req.method==='GET'&&!action)return json(res,200,safeQuizForParticipant(quiz));
      if(req.method==='GET'&&action==='results'){
        if((url.searchParams.get('creatorId')||'')!==quiz.creatorId)return sendError(res,403,'عرض النتائج متاح لمُنشئ الاختبار فقط.');
        const sorted=[...quiz.submissions].sort((a,b)=>b.score-a.score||a.submittedAt-b.submittedAt);
        return json(res,200,{code:quiz.code,title:quiz.title,questionCount:quiz.questions.length,submissions:sorted});
      }
      if(req.method==='GET'&&action==='export'){
        if((url.searchParams.get('creatorId')||'')!==quiz.creatorId)return sendError(res,403,'تصدير النتائج متاح لمُنشئ الاختبار فقط.');
        const sorted=[...quiz.submissions].sort((a,b)=>b.score-a.score||a.submittedAt-b.submittedAt);
        let csv='﻿الاسم,النتيجة,من,النسبة%,التاريخ\n';
        for(const s of sorted){const pct=quiz.questions.length?Math.round(s.score/quiz.questions.length*100):0;csv+=`${csvEscape(s.name)},${csvEscape(s.score)},${csvEscape(quiz.questions.length)},${csvEscape(pct)},${csvEscape(new Date(s.submittedAt).toLocaleString('ar'))}\n`;}
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${quiz.code}-results.csv"`,'Access-Control-Allow-Origin':'*'});
        return res.end(csv);
      }
      if(req.method==='POST'&&action==='submit'){
        const b=await readBody(req); const name=String(b.name||'مشارك').trim().slice(0,40)||'مشارك';
        const answers=Array.isArray(b.answers)?b.answers.slice(0,quiz.questions.length):[];
        let score=0; const details=quiz.questions.map((q,i)=>{const yourIndex=Number.isInteger(answers[i])?answers[i]:null;const correct=yourIndex===q.correct;if(correct)score++;return{correct,correctIndex:q.correct,yourIndex};});
        quiz.submissions.push({id:'s_'+crypto.randomBytes(6).toString('hex'),name,score,total:quiz.questions.length,submittedAt:Date.now()});
        return json(res,200,{score,total:quiz.questions.length,details});
      }
      return sendError(res,405,'الطلب غير مدعوم.');
    }
    if(url.pathname.startsWith('/api/'))return sendError(res,404,'المسار غير موجود.');
    let pathname=decodeURIComponent(url.pathname);if(pathname==='/')pathname='/index.html';const file=path.join(ROOT,pathname);
    if(path.relative(ROOT,file).startsWith('..')){res.writeHead(403);return res.end('Forbidden');}
    const ext=path.extname(file);
    if(ext==='.html'){
      fs.readFile(file,'utf8',(err,html)=>{
        if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found');}
        const proto=(req.headers['x-forwarded-proto']||'').split(',')[0].trim()||(req.socket.encrypted?'https':'http');
        const baseUrl=`${proto}://${req.headers.host}`;
        html=html.split('{{BASE_URL}}').join(baseUrl);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);
      });
      return;
    }
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found');}const types={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};const isStatic=pathname.startsWith('/assets/')||ext==='.ico';res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':isStatic?'public, max-age=86400':'no-store'});res.end(data);});
  } catch(err){console.error(err);sendError(res,500,'حدث خطأ مؤقت في الخادم. حاول مرة أخرى.');}
});
setInterval(()=>{const cutoff=Date.now()-6*60*60*1000;for(const [c,r] of rooms){tick(r);if(r.createdAt<cutoff)rooms.delete(c)}const qcutoff=Date.now()-30*24*60*60*1000;for(const [c,q] of quizzes){if(q.createdAt<qcutoff)quizzes.delete(c)}},5000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`Fikra server listening on 0.0.0.0:${PORT}`));
