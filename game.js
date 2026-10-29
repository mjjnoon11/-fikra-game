const questions=window.fikraQuestions;
const STAGE_SIZE=5;
let selectedCategory='علوم واكتشافات',selectedMode='فردي',displayName=localStorage.getItem('fikraName')||'لاعب فضولي';
let roomState=null,roomCode='',playerId=localStorage.getItem('fikraPlayerId');
if(!playerId){playerId='p_'+crypto.randomUUID();localStorage.setItem('fikraPlayerId',playerId)}
let roomPoll=null,questionClock=null,answeredThisQuestion=false,currentQ=0,score=0,gameQuestions=[],gameCategory='',lastReactionSeen=0,gameReview=[];
let quizDraft=null,participantQuiz=null,participantName='';
const $=s=>document.querySelector(s),overlay=$('#overlay'),modal=$('#modal');
$('#profileName').textContent=displayName;$('#helloName').textContent=displayName==='لاعب فضولي'?'يا فضولي':displayName;

/* ===== أصوات، أصوات نُطق، وريأكشنز ===== */
let soundsOn=localStorage.getItem('fikraSounds')!=='off';
let audioCtx=null;
function ensureAudio(){if(!audioCtx){try{audioCtx=new (window.AudioContext||window.webkitAudioContext)()}catch(e){audioCtx=null}}return audioCtx}
function playTone(freq,dur=0.14,type='sine',gainAt=0.08,delay=0){if(!soundsOn)return;const ctx=ensureAudio();if(!ctx)return;const t0=ctx.currentTime+delay;const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,t0);gain.gain.setValueAtTime(0,t0);gain.gain.linearRampToValueAtTime(gainAt,t0+0.012);gain.gain.exponentialRampToValueAtTime(0.0001,t0+dur);osc.connect(gain);gain.connect(ctx.destination);osc.start(t0);osc.stop(t0+dur+0.02)}
function soundCorrect(){playTone(587,0.1,'sine',0.09,0);playTone(880,0.16,'sine',0.09,0.1)}
function soundWrong(){playTone(220,0.22,'sawtooth',0.06,0)}
function soundTick(){playTone(1000,0.045,'square',0.035,0)}
function soundStageEnd(){playTone(523,0.12,'triangle',0.08,0);playTone(659,0.12,'triangle',0.08,0.12);playTone(784,0.18,'triangle',0.09,0.24)}
function soundWin(){playTone(523,0.12,'triangle',0.09,0);playTone(659,0.12,'triangle',0.09,0.12);playTone(784,0.12,'triangle',0.09,0.24);playTone(1046,0.22,'triangle',0.1,0.36)}
function soundReaction(){playTone(740,0.08,'sine',0.05,0)}

/* ===== إحصائيات محلية ===== */
function loadStats(){try{return JSON.parse(localStorage.getItem('fikraStats')||'null')||{gamesPlayed:0,bestScore:0,totalScore:0,categories:{}}}catch(e){return{gamesPlayed:0,bestScore:0,totalScore:0,categories:{}}}}
function saveStats(myScore,category){try{const s=loadStats();s.gamesPlayed++;s.totalScore+=myScore;if(myScore>s.bestScore)s.bestScore=myScore;s.categories[category]=(s.categories[category]||0)+1;localStorage.setItem('fikraStats',JSON.stringify(s));return s}catch(e){return loadStats()}}
function favoriteCategory(s){const entries=Object.entries(s.categories||{});if(!entries.length)return null;return entries.sort((a,b)=>b[1]-a[1])[0][0]}
function statsHtml(){const s=loadStats();if(!s.gamesPlayed)return'';return `<div class="stats-box"><div class="stat-item"><span class="stat-num">${ar(s.gamesPlayed)}</span><span class="stat-lbl">تحدّيات لعبتها</span></div><div class="stat-item"><span class="stat-num">${ar(s.bestScore)}</span><span class="stat-lbl">أفضل نتيجة</span></div><div class="stat-item"><span class="stat-num">${ar(s.totalScore)}</span><span class="stat-lbl">إجمالي النقاط</span></div>${favoriteCategory(s)?`<div class="stat-item"><span class="stat-num" style="font-size:14px">${escapeHtml(favoriteCategory(s))}</span><span class="stat-lbl">المجال المفضّل</span></div>`:''}</div>`}

/* ===== مراجعة الأسئلة بعد النهاية ===== */
function reviewHtml(){
  if(!gameReview.length)return'';
  return `<details class="review-wrap"><summary>📋 مراجعة الأسئلة (${ar(gameReview.length)})</summary><div class="review-list">${gameReview.map((r,i)=>`<div class="review-row ${r.correct?'good':'bad'}"><span class="rv-icon">${r.correct?'✅':'❌'}</span><div class="rv-body"><div class="rv-q">${ar(i+1)}. ${escapeHtml(r.q)}</div>${r.img?`<img class="rv-img" src="${escapeHtml(r.img)}" alt="">`:''}<div class="rv-ans">${r.yourIndex===null?'لم تُجب في الوقت المحدد':`إجابتك: ${escapeHtml(r.options[r.yourIndex]||'')}`}${!r.correct?` — الصحيح: ${escapeHtml(r.options[r.correctIndex]||'')}`:''}</div></div></div>`).join('')}</div></details>`;
}

/* ===== إعادة اللعب (المضيف) ===== */
async function rematchGame(){if(roomState?.hostId!==playerId){toast('إعادة اللعب متاحة للمضيف فقط');return}selectedCategory=roomState.category;selectedMode=roomState.mode;closeModal();await createQuickChallenge()}

/* ===== اختبار تعليمي مخصّص (للمعلّم) ===== */
function newQuizQuestion(){return{id:'q'+Math.random().toString(36).slice(2,9),q:'',options:['','','',''],correct:0,img:''}}
function myQuizzes(){try{return JSON.parse(localStorage.getItem('fikraMyQuizzes')||'[]')}catch(e){return[]}}
function saveMyQuiz(code,title){try{const list=myQuizzes().filter(x=>x.code!==code);list.unshift({code,title,createdAt:Date.now()});localStorage.setItem('fikraMyQuizzes',JSON.stringify(list.slice(0,40)))}catch(e){}}
function quizBuilderModal(){quizDraft=quizDraft||{title:'',questions:[newQuizQuestion()]};renderQuizBuilder()}
function syncQuizDraftFromDOM(){
  if(!quizDraft)return;
  const t=$('#quizTitle');if(t)quizDraft.title=t.value;
  quizDraft.questions.forEach(qq=>{
    const qEl=$('#qz_q_'+qq.id);if(qEl)qq.q=qEl.value;
    qq.options=qq.options.map((o,i)=>{const oEl=$('#qz_o_'+qq.id+'_'+i);return oEl?oEl.value:o});
    const imgEl=$('#qz_img_'+qq.id);if(imgEl)qq.img=imgEl.value;
    const checked=document.querySelector(`input[name="qz_c_${qq.id}"]:checked`);if(checked)qq.correct=Number(checked.value);
  });
}
function addQuizQuestion(){syncQuizDraftFromDOM();quizDraft.questions.push(newQuizQuestion());renderQuizBuilder()}
function removeQuizQuestion(id){syncQuizDraftFromDOM();quizDraft.questions=quizDraft.questions.filter(x=>x.id!==id);if(!quizDraft.questions.length)quizDraft.questions.push(newQuizQuestion());renderQuizBuilder()}
function renderQuizBuilder(){
  overlay.classList.add('show');
  modal.innerHTML=`<div class="modal-head"><div><h2>اختبار تعليمي مخصّص 📝</h2><p>أضف أسئلتك الخاصة، شارك الرابط مع الطلاب، وصدّر نتائجهم بعد إدخال أسمائهم.</p></div><button class="close" onclick="closeModal()">×</button></div><label class="field-label">عنوان الاختبار</label><input id="quizTitle" class="input" placeholder="مثال: اختبار الوحدة الثالثة" value="${escapeHtml(quizDraft.title)}"><div class="quiz-q-list">${quizDraft.questions.map((qq,qi)=>`<div class="quiz-q-card"><div class="quiz-q-head"><b>السؤال ${ar(qi+1)}</b>${quizDraft.questions.length>1?`<button class="mini-btn danger" onclick="removeQuizQuestion('${qq.id}')">حذف</button>`:''}</div><input id="qz_q_${qq.id}" class="input" placeholder="نص السؤال" value="${escapeHtml(qq.q)}"><input id="qz_img_${qq.id}" class="input qz-icon" placeholder="رمز اختياري 🧪" maxlength="4" value="${escapeHtml(qq.img||'')}"><div class="quiz-opts">${qq.options.map((op,oi)=>`<div class="quiz-opt-row"><input type="radio" name="qz_c_${qq.id}" value="${oi}" ${qq.correct===oi?'checked':''} title="حدّد الإجابة الصحيحة"><input id="qz_o_${qq.id}_${oi}" class="input" placeholder="اختيار ${ar(oi+1)}" value="${escapeHtml(op)}"></div>`).join('')}</div><div style="font-size:10.5px;color:var(--muted);margin-top:4px">اختر الدائرة بجانب الإجابة الصحيحة</div></div>`).join('')}</div><button class="mini-btn" style="width:100%;margin-top:10px" onclick="addQuizQuestion()">+ أضف سؤالاً</button><div class="modal-footer"><button class="btn secondary" onclick="quizDraft=null;closeModal()">إلغاء</button><button class="btn" onclick="saveQuiz()">انشر الاختبار وشاركه ←</button></div>`;
}
async function saveQuiz(){
  syncQuizDraftFromDOM();
  const title=(quizDraft.title||'').trim()||'اختبار';
  const questions=[];
  for(const qq of quizDraft.questions){
    const q=(qq.q||'').trim();
    const optsRaw=qq.options.map(o=>(o||'').trim());
    const keepIdx=[],options=[];
    optsRaw.forEach((o,i)=>{if(o){options.push(o);keepIdx.push(i)}});
    if(!q||options.length<2)continue;
    let correct=keepIdx.indexOf(qq.correct);if(correct===-1)correct=0;
    questions.push({q,options,correct,img:(qq.img||'').trim().slice(0,4)});
  }
  if(!questions.length){toast('أضف سؤالاً واحداً صحيحاً على الأقل (نص السؤال وخياران على الأقل)');return}
  try{
    const quiz=await api('/api/quizzes',{method:'POST',body:JSON.stringify({creatorId:playerId,title,questions})});
    saveMyQuiz(quiz.code,quiz.title);
    quizDraft=null;
    quizInviteModal(quiz);
  }catch(e){toast(e.message)}
}
function quizUrl(code){const u=new URL(location.pathname,location.origin);u.searchParams.set('quiz',code);return u.toString()}
function quizInviteModal(quiz){
  overlay.classList.add('show');
  const link=quizUrl(quiz.code),titleEsc=(quiz.title||'').replace(/'/g,"\\'");
  modal.innerHTML=`<div class="modal-head"><div><h2>الاختبار جاهز! 🎉</h2><p>${escapeHtml(quiz.title)} · شارك الرابط مع طلابك</p></div><button class="close" onclick="closeModal()">×</button></div><button class="big-share-btn" onclick="shareQuizInvite('auto','${quiz.code}','${titleEsc}')">📤 شارك رابط الاختبار الآن</button><label class="field-label">رابط الاختبار</label><div class="codebox" style="gap:10px"><span dir="ltr" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%">${escapeHtml(link)}</span><button class="mini-btn" onclick="copyText('${link}')">نسخ الرابط</button></div><div style="font-size:11px;color:var(--muted);margin-top:-6px">كل من يفتح الرابط يُدخل اسمه ويبدأ الاختبار مباشرة — نتيجته تظهر له فوراً، وتُحفظ لك لتصديرها.</div><div class="qr-wrap"><div class="qr-box" id="qzQrBox"></div><div class="qr-hint">امسح الرمز بكاميرا الجوال لفتح الاختبار مباشرة</div></div><div class="modal-footer"><button class="btn secondary" onclick="quizResultsModal('${quiz.code}')">عرض النتائج</button><button class="btn" onclick="closeModal()">تم</button></div>`;
  renderQuizQR(quiz.code);
}
function renderQuizQR(code){
  const box=$('#qzQrBox');if(!box)return;box.innerHTML='';
  if(typeof QRCode==='undefined'){box.remove();const wrap=document.querySelectorAll('.qr-wrap');if(wrap[wrap.length-1])wrap[wrap.length-1].remove();return}
  try{new QRCode(box,{text:quizUrl(code),width:148,height:148,colorDark:'#173f38',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M})}catch(e){const wrap=document.querySelectorAll('.qr-wrap');if(wrap[wrap.length-1])wrap[wrap.length-1].remove()}
}
function shareQuizInvite(kind,code,title){
  const link=quizUrl(code);
  const msg=`📝 دعوة لأداء اختبار: ${title}\nافتح الرابط وابدأ: ${link}`;
  if((kind==='auto'||kind==='native')&&navigator.share){navigator.share({title:'دعوة لاختبار',text:msg,url:link}).catch(e=>{if(e.name!=='AbortError')copyText(msg)});return}
  if(kind==='auto'||kind==='whatsapp'){openWhatsApp('https://wa.me/?text='+encodeURIComponent(msg),msg);return}
  copyText(msg);
}
function myQuizzesModal(){
  const list=myQuizzes();
  overlay.classList.add('show');
  modal.innerHTML=`<div class="modal-head"><div><h2>اختباراتي 📝</h2><p>الاختبارات التي أنشأتها من هذا الجهاز.</p></div><button class="close" onclick="closeModal()">×</button></div>${list.length?`<div class="quiz-list">${list.map(x=>{const t=escapeHtml(x.title),tEsc=(x.title||'').replace(/'/g,"\\'");return`<div class="quiz-list-row"><div><strong>${t}</strong><small>الرمز: ${x.code}</small></div><div style="display:flex;gap:6px"><button class="mini-btn" onclick="quizInviteModal({code:'${x.code}',title:'${tEsc}'})">الدعوة</button><button class="mini-btn" onclick="quizResultsModal('${x.code}')">النتائج</button></div></div>`}).join('')}</div>`:`<p style="color:var(--muted);font-size:13px">لم تُنشئ اختباراً بعد. أنشئ أول اختبار وشاركه مع طلابك.</p>`}<div class="modal-footer"><button class="btn secondary" onclick="closeModal()">إغلاق</button><button class="btn" onclick="quizDraft=null;quizBuilderModal()">+ اختبار جديد</button></div>`;
}
async function quizResultsModal(code){
  overlay.classList.add('show');
  modal.innerHTML=`<div class="modal-head"><div><h2>نتائج الاختبار</h2><p>جارٍ التحميل…</p></div><button class="close" onclick="closeModal()">×</button></div>`;
  try{
    const data=await api(`/api/quizzes/${encodeURIComponent(code)}/results?creatorId=${encodeURIComponent(playerId)}`);
    const rows=data.submissions||[],titleEsc=(data.title||'').replace(/'/g,"\\'");
    modal.innerHTML=`<div class="modal-head"><div><h2>${escapeHtml(data.title)}</h2><p>${ar(rows.length)} مشاركاً · ${ar(data.questionCount)} سؤالاً</p></div><button class="close" onclick="closeModal()">×</button></div>${rows.length?`<div class="quiz-results-list">${rows.map((s,i)=>`<div class="quiz-result-row"><span class="num">${ar(i+1)}</span><strong>${escapeHtml(s.name)}</strong><span>${ar(s.score)} / ${ar(s.total)}</span></div>`).join('')}</div>`:`<p style="color:var(--muted);font-size:13px">لا توجد نتائج بعد — شارك الرابط مع الطلاب أولاً.</p>`}<div class="modal-footer"><button class="btn secondary" onclick="quizInviteModal({code:'${code}',title:'${titleEsc}'})">رابط الدعوة</button><button class="btn" onclick="exportQuizResults('${code}')">⬇ تصدير النتائج CSV</button></div>`;
  }catch(e){toast(e.message);closeModal()}
}
function exportQuizResults(code){
  const url=`/api/quizzes/${encodeURIComponent(code)}/export?creatorId=${encodeURIComponent(playerId)}`;
  const a=document.createElement('a');a.href=url;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
}

/* ===== اختبار تعليمي مخصّص (للمشارك/الطالب) ===== */
async function openQuizForParticipant(code){
  try{const quiz=await api(`/api/quizzes/${encodeURIComponent(code)}`);quizNameModal(quiz)}
  catch(e){toast(e.message)}
}
function quizNameModal(quiz){
  participantQuiz=quiz;
  overlay.classList.add('show');
  modal.innerHTML=`<div class="modal-head"><div><h2>${escapeHtml(quiz.title)} 📝</h2><p>اختبار من ${ar(quiz.questionCount)} سؤالاً. أدخل اسمك للبدء.</p></div><button class="close" onclick="closeModal()">×</button></div><label class="field-label">اسمك</label><input id="quizNameInput" class="input" placeholder="اكتب اسمك الكامل" value="${escapeHtml(displayName==='لاعب فضولي'?'':displayName)}" maxlength="40"><div class="modal-footer"><button class="btn secondary" onclick="closeModal();history.replaceState(null,'',location.pathname)">إلغاء</button><button class="btn" onclick="startQuizTaking()">ابدأ الاختبار ←</button></div>`;
}
function startQuizTaking(){
  const input=$('#quizNameInput'),name=input.value.trim();
  if(!name){toast('أدخل اسمك أولاً');input.focus();return}
  quizTakeModal(participantQuiz,name);
}
function quizTakeModal(quiz,name){
  participantQuiz=quiz;participantName=name;
  overlay.classList.add('show');
  modal.innerHTML=`<div class="modal-head"><div><h2>${escapeHtml(quiz.title)}</h2><p>مرحباً ${escapeHtml(name)}، أجب عن ${ar(quiz.questionCount)} سؤالاً ثم اضغط "إرسال الإجابات".</p></div></div><div class="quiz-take-list">${quiz.questions.map((q,qi)=>`<div class="quiz-q-card"><div class="quiz-q-head"><b>${ar(qi+1)}. ${escapeHtml(q.q)}</b></div>${q.img?`<div class="qimg" style="font-size:40px">${escapeHtml(q.img)}</div>`:''}<div class="quiz-take-opts">${q.options.map((op,oi)=>`<label class="quiz-take-opt"><input type="radio" name="take_${qi}" value="${oi}">${escapeHtml(op)}</label>`).join('')}</div></div>`).join('')}</div><div class="modal-footer"><button class="btn secondary" onclick="closeModal();history.replaceState(null,'',location.pathname)">إلغاء</button><button class="btn" onclick="submitQuizAnswers()">إرسال الإجابات ←</button></div>`;
}
async function submitQuizAnswers(){
  if(!participantQuiz)return;
  const answers=participantQuiz.questions.map((q,qi)=>{const sel=document.querySelector(`input[name="take_${qi}"]:checked`);return sel?Number(sel.value):null});
  try{
    const res=await api(`/api/quizzes/${encodeURIComponent(participantQuiz.code)}/submit`,{method:'POST',body:JSON.stringify({name:participantName,answers})});
    quizResultScreen(res);
  }catch(e){toast(e.message)}
}
function quizResultScreen(res){
  overlay.classList.add('show');
  const pct=res.total?Math.round(res.score/res.total*100):0;
  modal.innerHTML=`<div class="game-end"><div class="trophy">${pct>=50?'🏆':'📝'}</div><h2>انتهى الاختبار!</h2><p>نتيجتك: ${ar(res.score)} من ${ar(res.total)} (${ar(pct)}٪)</p><details class="review-wrap"><summary>📋 مراجعة إجاباتك</summary><div class="review-list">${res.details.map((d,i)=>`<div class="review-row ${d.correct?'good':'bad'}"><span class="rv-icon">${d.correct?'✅':'❌'}</span><div class="rv-body"><div class="rv-q">${ar(i+1)}. ${escapeHtml(participantQuiz.questions[i].q)}</div><div class="rv-ans">${d.yourIndex===null?'لم تُجب':`إجابتك: ${escapeHtml(participantQuiz.questions[i].options[d.yourIndex]||'')}`}${!d.correct?` — الصحيح: ${escapeHtml(participantQuiz.questions[i].options[d.correctIndex]||'')}`:''}</div></div></div>`).join('')}</div></details><div class="modal-footer"><button class="btn" onclick="closeModal();history.replaceState(null,'',location.pathname)">تم</button></div></div>`;
}
function speak(text,lang='ar-SA',rate=1){if(!soundsOn)return;if(!('speechSynthesis' in window))return;try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=lang;u.rate=rate;speechSynthesis.speak(u)}catch(e){}}
const CORRECT_PHRASES=['أحسنت!','ممتاز!','إجابة صحيحة!','رائع!','موفّق!'];
const WRONG_PHRASES=['حظ أوفر!','ليست هذه المرة','حاول في القادمة'];
function toggleSounds(){soundsOn=!soundsOn;localStorage.setItem('fikraSounds',soundsOn?'on':'off');updateSoundIcons();if(soundsOn)playTone(700,0.08,'sine',0.06);toast(soundsOn?'الأصوات مُفعّلة 🔊':'الأصوات مكتومة 🔇')}
function updateSoundIcons(){const icon=soundsOn?'🔊':'🔇';const a=$('#soundToggle');if(a)a.textContent=icon;const b=$('#soundToggleTop');if(b)b.textContent=icon}
updateSoundIcons();
const REACTION_SET=['👏','😂','🔥','😮','👎','❤️','🎉','🤔'];
async function sendReaction(emoji){if(!roomCode)return;try{await api(`/api/rooms/${roomCode}/react`,{method:'POST',body:JSON.stringify({playerId,emoji})})}catch(e){}}
function spawnFloatingReaction(emoji){let layer=document.getElementById('reactionLayer');if(!layer){layer=document.createElement('div');layer.id='reactionLayer';layer.style.position='fixed';layer.style.inset='0';layer.style.pointerEvents='none';layer.style.zIndex='60';layer.style.overflow='hidden';document.body.appendChild(layer)}const el=document.createElement('div');el.textContent=emoji;el.style.position='absolute';el.style.left=(10+Math.random()*80)+'%';el.style.bottom='70px';el.style.fontSize=(26+Math.random()*18)+'px';el.style.animation='floatUp 2.6s ease-out forwards';layer.appendChild(el);setTimeout(()=>el.remove(),2700)}
function handleIncomingReactions(){if(!roomState||!roomState.reactions)return;const seq=roomState.reactionSeq||0;if(seq<=lastReactionSeen){if(seq<lastReactionSeen)lastReactionSeen=seq;return}const fresh=roomState.reactions.filter(r=>r.id>lastReactionSeen);lastReactionSeen=seq;fresh.forEach(r=>{spawnFloatingReaction(r.emoji);if(r.playerId!==playerId)soundReaction()})}
function reactionBarHtml(){return `<div class="reaction-bar">${REACTION_SET.map(e=>`<button class="reaction-btn" onclick="sendReaction('${e}')">${e}</button>`).join('')}</div>`}
async function api(path,options={}){const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.error||'تعذّر الاتصال بالخادم.');return data}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('show'),3200)}
function openModal(type){overlay.classList.add('show');if(type==='new')newModal();if(type==='join')joinModal();if(type==='invite')inviteModal(false);if(type==='profile')profileModal();if(type==='help')helpModal();if(type==='learn')learnModal();if(type==='quizzes')myQuizzesModal()}

let learnSet='words',learnIndex=0,learnFlipped=false,learnDone=new Set();
function learnCards(){return (window.fikraLearn&&window.fikraLearn[learnSet])||[]}
function learnModal(){learnIndex=0;learnFlipped=false;renderLearn()}
function renderLearn(){
  const cards=learnCards(),total=cards.length,card=cards[learnIndex]||{term:'',meaning:''};
  const progressPct=total?Math.round(((learnIndex+1)/total)*100):0;
  modal.innerHTML=`<div class="modal-head"><div><h2>تعلّم إنجليزي 🔤</h2><p>بطاقات مراجعة حرّة بدون منافسة — اضغط البطاقة لرؤية المعنى.</p></div><button class="close" onclick="closeModal()">×</button></div>
  <div class="learn-tabs"><button class="learn-tab ${learnSet==='words'?'selected':''}" onclick="switchLearnSet('words')">🔤 كلمات (${(window.fikraLearn?.words||[]).length})</button><button class="learn-tab ${learnSet==='idioms'?'selected':''}" onclick="switchLearnSet('idioms')">💬 Idioms (${(window.fikraLearn?.idioms||[]).length})</button></div>
  <div class="learn-progress"><div class="progress"><i style="width:${progressPct}%"></i></div><small>${ar(learnIndex+1)} / ${ar(total)}</small></div>
  <div class="learn-card ${learnFlipped?'flipped':''}" onclick="flipLearn()">
    <button class="learn-speak" onclick="event.stopPropagation();speakTerm('${(card.term||'').replace(/'/g,"\\'")}')" title="استمع للنطق">🔊</button>
    <div class="learn-face front"><span class="learn-term" dir="ltr">${escapeHtml(card.term||'')}</span><small class="learn-hint">اضغط لرؤية المعنى 👆</small></div>
    <div class="learn-face back"><span class="learn-meaning">${escapeHtml(card.meaning||'')}</span></div>
  </div>
  <div class="learn-nav"><button class="btn secondary" onclick="learnStep(-1)" ${learnIndex===0?'disabled':''}>→ السابقة</button><button class="btn" onclick="learnStep(1)">${learnIndex>=total-1?'ابدأ من جديد ↻':'التالية ←'}</button></div>`;
}
function switchLearnSet(set){learnSet=set;learnIndex=0;learnFlipped=false;renderLearn()}
function flipLearn(){learnFlipped=!learnFlipped;const c=$('.learn-card');if(c)c.classList.toggle('flipped',learnFlipped)}
function learnStep(dir){const total=learnCards().length;if(!total)return;learnFlipped=false;if(dir>0&&learnIndex>=total-1){learnIndex=0}else{learnIndex=Math.min(Math.max(0,learnIndex+dir),total-1)}renderLearn()}
function closeModal(){overlay.classList.remove('show');clearInterval(questionClock)}
async function leaveGame(){
  if(!confirm('هل تريد مغادرة الجولة؟ لن تتمكن من العودة إليها لاحقاً.'))return;
  clearInterval(questionClock);clearInterval(roomPoll);
  const code=roomCode,pid=playerId;
  roomCode='';roomState=null;sessionStorage.removeItem('fikraRoom');
  closeModal();
  if(code){try{await api(`/api/rooms/${code}/leave`,{method:'POST',body:JSON.stringify({playerId:pid})})}catch(e){}}
  toast('غادرت الجولة. يمكنك بدء تحدٍّ جديد في أي وقت.');
}

overlay.addEventListener('click',e=>{if(e.target===overlay)closeModal()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
function newModal(){modal.innerHTML=`<div class="modal-head"><div><h2>جهّز تحدّيك ✨</h2><p>٥ مراحل في الجلسة · ٥ أسئلة في كل مرحلة · ٢٥ سؤالاً لكل مجال.</p></div><button class="close" onclick="closeModal()">×</button></div><label class="field-label">مجال المعرفة</label><div class="choice-grid">${[['علوم واكتشافات','🧪','تجارب وفضاء'],['عالم حولنا','🌍','جغرافيا وثقافة'],['تاريخ وحضارات','🏺','قصص من الماضي'],['لغة وألغاز','🧩','كلمات وذكاء'],['تقنية وابتكار','💻','تقنية وحوسبة'],['طبيعة وحياة','🌿','كائنات وبيئة'],['رياضيات ومنطق','🔢','أرقام وتفكير'],['ثقافة عامة','🎭','رياضة وفنون'],['كلمات إنجليزية','🔤','مفردات ومعاني'],['Idioms إنجليزية','💬','تعبيرات شائعة']].map(x=>`<button class="choice ${selectedCategory===x[0]?'selected':''}" onclick="pickCat('${x[0]}',this)"><span class="ci">${x[1]}</span><span><strong>${x[0]}</strong><small>${x[2]}</small></span></button>`).join('')}</div><label class="field-label">أسلوب التحدّي</label><div class="mode-row"><button class="mode ${selectedMode==='فردي'?'selected':''}" onclick="pickMode('فردي',this)">👤 فردي — كل لاعب لنفسه</button><button class="mode ${selectedMode==='فرق'?'selected':''}" onclick="pickMode('فرق',this)">👥 فرق — توزيع تلقائي</button></div><div class="modal-footer"><button class="btn secondary" onclick="closeModal()">إلغاء</button><button class="btn" onclick="createChallenge()">أنشئ غرفة وادعُهم ←</button></div>`}
function pickCat(c,b){selectedCategory=c;document.querySelectorAll('.choice').forEach(x=>x.classList.remove('selected'));b.classList.add('selected')}
function pickMode(c,b){selectedMode=c;document.querySelectorAll('.mode').forEach(x=>x.classList.remove('selected'));b.classList.add('selected')}
async function createChallenge(){try{const qs=questions[selectedCategory]||questions['علوم واكتشافات'];roomState=await api('/api/rooms',{method:'POST',body:JSON.stringify({playerId,name:displayName,category:selectedCategory,mode:selectedMode,questionCount:Math.min(STAGE_SIZE*5,qs.length),stageSize:STAGE_SIZE})});roomCode=roomState.code;sessionStorage.setItem('fikraRoom',roomCode);history.replaceState(null,'',location.pathname);inviteModal(true);beginPolling()}catch(e){toast(e.message)}}
function roomUrl(code=roomCode){const u=new URL(location.pathname,location.origin);u.searchParams.set('join',code);return u.toString()}
function inviteText(){return `🧠 انضم إليّ في تحدّي فِكرة!\nالمجال: ${roomState?.category||selectedCategory}\nرمز الدخول: ${roomCode}\nافتح الرابط للانضمام: ${roomUrl()}`}
function inviteModal(created=false){overlay.classList.add('show');const isHost=roomState?.hostId===playerId,link=roomUrl();modal.innerHTML=`<div class="modal-head"><div><h2>${created?'غرفتك جاهزة! 🎉':'وصلت إلى غرفة التحدّي'}</h2><p>${roomState?.category||selectedCategory} · ${roomState?.mode==='فرق'?'فرق':'تنافس فردي'} · ${isHost?'أرسل رابط الغرفة عبر واتساب':'بانتظار المضيف لبدء اللعب'}</p></div><button class="close" onclick="closeModal()">×</button></div><button class="big-share-btn" onclick="shareInvite('auto')">📤 شارك الدعوة الآن</button><label class="field-label">رابط الدخول المباشر</label><div class="codebox" style="gap:10px"><span dir="ltr" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%">${escapeHtml(link)}</span><button class="mini-btn" onclick="copyRoomLink()">نسخ الرابط</button></div><div style="font-size:11px;color:var(--muted);margin-top:-6px">أي شخص يفتح الرابط يستطيع الانضمام إلى هذه الغرفة قبل بدء الجولة.</div><div class="qr-wrap"><div class="qr-box" id="qrBox"></div><div class="qr-hint">امسح الرمز بكاميرا الجوال للانضمام مباشرة — مثالي للّعب في نفس المكان</div></div><label class="field-label">رمز احتياطي للانضمام</label><div class="codebox"><span>اللاعبون: <b id="playerCount">${ar(roomState?.players?.length||1)}</b></span><strong>${roomCode}</strong><button class="mini-btn" onclick="copyRoomCode()">نسخ الرمز</button></div><label class="field-label">إرسال مباشرة عبر واتساب إلى رقم</label><div class="invite-row"><input class="input" id="phone" type="tel" inputmode="tel" placeholder="رقم واتساب 05xxxxxxxx" dir="ltr"><button class="btn" onclick="sendWhatsAppToNumber()">فتح واتساب ↗</button></div><div class="share-grid"><button class="share" onclick="shareInvite('whatsapp')"><span>🟢</span>واتساب</button><button class="share" onclick="copyRoomLink()"><span>🔗</span>نسخ الرابط</button><button class="share" onclick="shareInvite('native')"><span>📲</span>مشاركة أخرى</button></div><label class="field-label">اللاعبون في الغرفة</label><div class="people" id="peopleList">${renderPlayerChips()}</div><div style="font-size:11px;color:var(--muted);margin-top:10px" id="roomHint">${isHost?'ابدأ عندما ينضم أصدقاؤك. يمكن لما يصل إلى ٢٤ لاعباً الانضمام.':'ستبدأ الجولة تلقائياً عندما يبدأ المضيف.'}</div><div class="modal-footer">${isHost?`<button class="btn secondary" onclick="closeModal()">أكمل لاحقاً</button><button class="btn" onclick="startGame()">ابدأ اللعب (${ar(roomState?.players?.length||1)}) ←</button>`:`<button class="btn secondary" onclick="closeModal()">انتظار في الخلفية</button>`}</div>`;renderInviteQR()}
function renderInviteQR(){
  const box=$('#qrBox');
  if(!box)return;
  box.innerHTML='';
  if(typeof QRCode==='undefined'){box.remove();const wrap=document.querySelector('.qr-wrap');if(wrap)wrap.remove();return}
  try{
    new QRCode(box,{text:roomUrl(),width:148,height:148,colorDark:'#173f38',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
  }catch(e){const wrap=document.querySelector('.qr-wrap');if(wrap)wrap.remove()}
}
function renderPlayerChips(){return(roomState?.players||[]).map((p,i)=>`<span class="person-chip">${p.team==='الفريق ١'?'🟢 ':p.team==='الفريق ٢'?'🟣 ':['🧑🏻','👩🏻','🧑🏽','👨🏻'][i%4]+' '}${escapeHtml(p.name)} ${p.isHost?'<small>المضيف</small>':p.team?`<small>${p.team}</small>`:''}</span>`).join('')}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
const AR_DIGITS=['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
function ar(n){return String(n).replace(/[0-9]/g,d=>AR_DIGITS[d])}
let lastTickSecond=null;
function updateTimer(){
  const timerEl=$('#timer');
  if(!timerEl)return;
  if(!roomState?.deadline){timerEl.textContent='⏱ —';return}
  const left=Math.max(0,Math.ceil((roomState.deadline-Date.now())/1000));
  timerEl.textContent=`⏱ ${ar(left)} ثانية`;
  timerEl.classList.toggle('warn',left<=5);
  if(left<=5&&left>0&&left!==lastTickSecond&&!answeredThisQuestion){lastTickSecond=left;soundTick()}
  if(left>5)lastTickSecond=null;
  if(left<=0&&!answeredThisQuestion){
    answeredThisQuestion=true;
    document.querySelectorAll('.answer').forEach(x=>x.disabled=true);
    const st=$('#answerStatus');if(st)st.textContent='⌛ انتهى الوقت… بانتظار بقية اللاعبين';
    const q=gameQuestions[currentQ];if(q)gameReview.push({q:q.q,img:q.img,options:q.a,correctIndex:q.c,yourIndex:null,correct:false});
  }
}
async function copyText(text){try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(text);else{const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();if(!document.execCommand('copy'))throw Error();t.remove()}toast('تم نسخ الدعوة والرابط — الصقهما في واتساب 🔗')}catch{prompt('انسخ الدعوة والصقها في واتساب:',text)}}
function copyInvite(){copyText(inviteText())}
function copyRoomLink(){copyText(roomUrl())}
function copyRoomCode(){copyText(roomCode)}
function openWhatsApp(url,fallback){const win=window.open(url,'_blank');if(win){win.opener=null;return true}copyText(fallback);toast('لم يسمح إطار المعاينة بفتح واتساب؛ نُسخت الدعوة لتلصقها في المحادثة.');return false}
function shareInvite(kind){const msg=inviteText();if((kind==='auto'||kind==='native')&&navigator.share){navigator.share({title:'تحدّي فِكرة',text:msg,url:roomUrl()}).catch(e=>{if(e.name!=='AbortError')copyText(msg)});return}if(kind==='auto'||kind==='whatsapp'){openWhatsApp('https://wa.me/?text='+encodeURIComponent(msg),msg);return}copyText(msg)}
function normalizePhone(raw){let n=raw.replace(/\D/g,'');if(n.startsWith('00'))n=n.slice(2);if(n.startsWith('0'))n='966'+n.slice(1);else if(n.startsWith('5')&&n.length===9)n='966'+n;return n}
function sendWhatsAppToNumber(){const input=$('#phone'),raw=input.value.trim();if(!raw){toast('أدخل رقم واتساب أولاً');input.focus();return}const n=normalizePhone(raw);if(n.length<8||n.length>15){toast('رقم غير صحيح؛ للسعودية اكتب 05xxxxxxxx');return}openWhatsApp('https://wa.me/'+n+'?text='+encodeURIComponent(inviteText()),inviteText())}
function beginPolling(){clearInterval(roomPoll);if(!roomCode)return;roomPoll=setInterval(refreshRoom,1100);refreshRoom()}
async function refreshRoom(){if(!roomCode)return;try{const fresh=await api(`/api/rooms/${encodeURIComponent(roomCode)}?playerId=${encodeURIComponent(playerId)}`);const oldStatus=roomState?.status,oldQ=roomState?.questionIndex;roomState=fresh;selectedCategory=fresh.category;selectedMode=fresh.mode;if(fresh.status==='waiting'){if($('#peopleList')){const people=$('#peopleList');people.innerHTML=renderPlayerChips();const cnt=$('#playerCount');if(cnt)cnt.textContent=ar(fresh.players.length);const host=fresh.hostId===playerId;const hint=$('#roomHint');if(hint)hint.textContent=host?'ابدأ عندما ينضم أصدقاؤك. يمكن لما يصل إلى ٢٤ لاعباً الانضمام.':'ستبدأ الجولة تلقائياً عندما يبدأ المضيف.';const start=modal.querySelector('.modal-footer .btn:not(.secondary)');if(start)start.textContent=`ابدأ اللعب (${ar(fresh.players.length)}) ←`}}else if(fresh.status==='playing'){if(oldStatus!=='playing'||oldQ!==fresh.questionIndex||!$('.game-wrap'))renderQuestion();else{updateTimer();updateLiveBoard();handleIncomingReactions()}}else if(fresh.status==='intermission'){if(oldStatus!=='intermission'||!$('.stage-break'))renderStageBreak();else handleIncomingReactions()}else if(fresh.status==='finished'){if(oldStatus!=='finished')showResults()}}catch(e){if(e.message.includes('لم نعثر')){clearInterval(roomPoll);toast('انتهت صلاحية غرفة التحدّي. أنشئ غرفة جديدة.')}}}
async function startGame(){if(roomState?.hostId!==playerId){toast('المضيف هو من يبدأ الجولة');return}try{roomState=await api(`/api/rooms/${roomCode}/start`,{method:'POST',body:JSON.stringify({playerId})});closeModal();beginPolling();renderQuestion()}catch(e){toast(e.message)}}
function startCategory(cat){selectedCategory=cat;selectedMode='فردي';createQuickChallenge()}
async function createQuickChallenge(){try{const qs=questions[selectedCategory]||questions['علوم واكتشافات'];roomState=await api('/api/rooms',{method:'POST',body:JSON.stringify({playerId,name:displayName,category:selectedCategory,mode:selectedMode,questionCount:Math.min(STAGE_SIZE*5,qs.length),stageSize:STAGE_SIZE})});roomCode=roomState.code;sessionStorage.setItem('fikraRoom',roomCode);inviteModal(true);beginPolling()}catch(e){toast(e.message)}}
function resumeGame(cat){startCategory(cat)}
function joinModal(){modal.innerHTML=`<div class="modal-head"><div><h2>انضم إلى لعبة 🚀</h2><p>أدخل الرمز الذي أرسله لك المضيف عبر واتساب.</p></div><button class="close" onclick="closeModal()">×</button></div><label class="field-label">اسمك في اللعبة</label><input id="joinName" class="input" maxlength="22" value="${escapeHtml(displayName)}" placeholder="اكتب اسمك"><label class="field-label">رمز الانضمام</label><div class="invite-row"><input class="input" id="joinCode" placeholder="مثال: A7K9Q2" maxlength="8" style="text-transform:uppercase;letter-spacing:2px" dir="ltr"><button class="btn" onclick="joinByCode()">انضمام ←</button></div><div style="font-size:11px;color:var(--muted);margin-top:14px">ما عندك رمز؟ اطلب من المضيف إرسال رابط الدعوة لك على واتساب.</div>`}
async function joinByCode(){const input=$('#joinCode'),c=input.value.trim().toUpperCase(),nm=$('#joinName').value.trim()||displayName;if(c.length<4){toast('أدخل رمزاً صحيحاً للانضمام');input.focus();return}try{const joined=await api(`/api/rooms/${encodeURIComponent(c)}/join`,{method:'POST',body:JSON.stringify({playerId,name:nm})});displayName=nm;localStorage.setItem('fikraName',nm);$('#profileName').textContent=nm;$('#helloName').textContent=nm;roomCode=joined.code;roomState=joined;sessionStorage.setItem('fikraRoom',roomCode);history.replaceState(null,'',location.pathname);inviteModal(false);beginPolling()}catch(e){toast(e.message)}}
function openJoinLink(){const val=prompt('الصق رابط دعوة فِكرة هنا:');if(!val)return;try{const u=new URL(val);const c=u.searchParams.get('join');if(c){openModal('join');$('#joinCode').value=c.toUpperCase()}else toast('الرابط لا يحتوي على رمز لعبة')}catch{toast('تحقق من الرابط المنسوخ')}}
function joinByNearby(){toast('للانضمام من أي مكان، استخدم رمز الدعوة المرسل عبر واتساب. 📲')}
function profileModal(){modal.innerHTML=`<div class="modal-head"><div><h2>ملفك الشخصي</h2><p>اسمك الذي سيظهر لأصدقائك في التحدّي.</p></div><button class="close" onclick="closeModal()">×</button></div><label class="field-label">اسم اللاعب</label><input id="nameInput" class="input" value="${escapeHtml(displayName)}" maxlength="22">${statsHtml()?`<label class="field-label" style="margin-top:16px">إحصائياتك</label>${statsHtml()}`:''}<div class="modal-footer"><button class="btn" onclick="saveProfile()">حفظ التغييرات</button></div>`}
function saveProfile(){const n=$('#nameInput').value.trim()||'لاعب فضولي';displayName=n;localStorage.setItem('fikraName',n);$('#profileName').textContent=n;$('#helloName').textContent=n;closeModal();toast('تم تحديث ملفك الشخصي ✨')}
function helpModal(){modal.innerHTML=`<div class="modal-head"><div><h2>كيف تلعب فِكرة؟ 💡</h2><p>تحدٍّ مباشر مع أصدقائك.</p></div><button class="close" onclick="closeModal()">×</button></div><div style="display:grid;gap:12px;font-size:13px"><div class="person-chip">١ · أنشئ غرفة واختر المجال أو أسلوب الفرق.</div><div class="person-chip">٢ · أرسل رمز/رابط الغرفة عبر واتساب.</div><div class="person-chip">٣ · ينضم أصدقاؤك من أجهزتهم، وتظهر أسماؤهم مباشرة.</div><div class="person-chip">٤ · يبدأ المضيف، وتتزامن الأسئلة والنتائج للجميع.</div></div><div class="modal-footer"><button class="btn" onclick="closeModal()">تمام!</button></div>`}
function launchGame(){if(roomState?.hostId===playerId)startGame();else toast('بانتظار المضيف لبدء اللعبة')}
function seededRandom(seedStr){let h=1779033703^seedStr.length;for(let i=0;i<seedStr.length;i++){h=Math.imul(h^seedStr.charCodeAt(i),3432918353);h=h<<13|h>>>19}return function(){h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);h^=h>>>16;return (h>>>0)/4294967296}}
function makeQuestionSet(category){const pool=[...(questions[category]||questions['علوم واكتشافات'])];const rand=seededRandom((roomCode||'seed')+'::'+category);for(let i=pool.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}const picked=pool.slice(0,Math.min(STAGE_SIZE*5,pool.length));return picked.map(item=>{const options=item.a.map((text,i)=>({text,correct:i===item.c})).sort(()=>Math.random()-.5);return{q:item.q,a:options.map(x=>x.text),c:options.findIndex(x=>x.correct),img:item.img||null,term:item.term||null}})}
function speakTerm(term){speak(term,'en-US',0.92)}
function renderQuestion(){clearInterval(questionClock);if(!roomState)return;currentQ=roomState.questionIndex;if(gameCategory!==roomState.category||!gameQuestions.length){gameCategory=roomState.category;gameQuestions=makeQuestionSet(gameCategory);lastReactionSeen=roomState.reactionSeq||0;gameReview=[]}if(currentQ>=gameQuestions.length){showResults();return}answeredThisQuestion=false;const q=gameQuestions[currentQ],withinStage=currentQ%roomState.stageSize+1,stageNo=Math.floor(currentQ/roomState.stageSize)+1;const me=roomState.players.find(p=>p.id===playerId);score=me?.score||0;const englishTerm=q.term||null;overlay.classList.add('show');modal.innerHTML=`<div class="game-wrap"><div class="game-top"><div><b>فِكرة <span style="color:#a9b9ae">·</span> ${escapeHtml(roomState.category)}</b><br><small>المرحلة ${stageNo} من ${Math.ceil(roomState.questionCount/roomState.stageSize)} · ${roomState.mode==='فرق'?'نمط الفرق':'تنافس فردي'} · ${ar(roomState.players.length)} لاعبين</small></div><span class="game-counter">${ar(currentQ+1)} / ${ar(gameQuestions.length)}</span><div class="game-top-right"><span class="timer" id="timer">⏱ ٢٠ ثانية</span><button class="sound-toggle" id="soundToggle" onclick="toggleSounds()">${soundsOn?'🔊':'🔇'}</button><button class="leave-btn" onclick="leaveGame()">خروج ✕</button></div></div><div class="progress" style="width:100%;height:6px"><i style="width:${(currentQ/gameQuestions.length)*100}%"></i></div><div class="question-card"><div class="qtag">المرحلة ${ar(stageNo)} · السؤال ${ar(withinStage)} من ${ar(roomState.stageSize)}</div>${q.img?`<div class="qimg">${q.img}</div>`:""}<h2>${q.q}${englishTerm?` <button class="speak-btn" onclick="speakTerm('${englishTerm.replace(/'/g,"\\'")}')" title="استمع للنطق">🔊</button>`:''}</h2></div><div class="answers">${q.a.map((x,i)=>`<button class="answer" onclick="answerQuestion(${i},this)"><span style="color:#98a49b;margin-left:8px">${['أ','ب','ج','د'][i]}</span>${x}</button>`).join('')}</div><div class="scorebar"><span>⭐ رصيدك: <b style="color:var(--ink)">${ar(score)}</b></span><span id="answerStatus">💡 أجب قبل انتهاء الوقت</span></div>${reactionBarHtml()}<div class="panel" style="padding:12px;margin-top:8px"><div class="panel-title"><h3>النتائج المباشرة</h3><small id="answerCount">${ar(roomState.players.filter(p=>p.answered).length)}/${ar(roomState.players.length)} أجابوا</small></div><div class="rank-list" id="liveScores">${renderScoreRows()}</div></div></div>`;updateTimer();questionClock=setInterval(updateTimer,250);handleIncomingReactions()}
function renderStageBreak(){clearInterval(questionClock);soundStageEnd();const completed=Math.floor(roomState.questionIndex/roomState.stageSize),total=Math.ceil(roomState.questionCount/roomState.stageSize),isHost=roomState.hostId===playerId;overlay.classList.add('show');modal.innerHTML=`<div class="game-end stage-break"><div class="trophy">🎯</div><h2>أُنجزت المرحلة ${ar(completed)}!</h2><p>أحسنتم! خذوا نفساً قصيراً ثم واصلوا إلى المرحلة ${ar(completed+1)} من ${ar(total)}.</p><div class="panel" style="text-align:right;margin:18px 0"><div class="rank-list">${renderScoreRows()}</div></div>${reactionBarHtml()}<div style="font-size:12px;color:var(--muted)">${isHost?'المضيف يبدأ المرحلة التالية عندما يكون الجميع مستعدين.':'بانتظار المضيف لبدء المرحلة التالية…'}</div><div class="modal-footer"><button class="btn secondary" onclick="leaveGame()">مغادرة الجولة</button>${isHost?`<button class="btn" onclick="continueStage()">ابدأ المرحلة ${ar(completed+1)} ←</button>`:''}</div></div>`;handleIncomingReactions()}
async function continueStage(){try{roomState=await api(`/api/rooms/${roomCode}/continue`,{method:'POST',body:JSON.stringify({playerId})});renderQuestion()}catch(e){toast(e.message)}}
function updateLiveBoard(){const board=$('#liveScores');if(board)board.innerHTML=renderScoreRows();const count=$('#answerCount');if(count)count.textContent=`${ar(roomState.players.filter(p=>p.answered).length)}/${ar(roomState.players.length)} أجابوا`;const me=roomState.players.find(p=>p.id===playerId);const sb=$('.scorebar b');if(sb&&me)sb.textContent=ar(me.score)}
function renderScoreRows(){return [...(roomState?.players||[])].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="rank-row"><span class="num">${i+1}</span><span class="r-avatar">${p.team==='الفريق ١'?'🟢':p.team==='الفريق ٢'?'🟣':['🧑🏻','👩🏻','🧑🏽','👨🏻'][i%4]}</span><strong>${escapeHtml(p.name)} ${p.id===playerId?'<small>(أنت)</small>':''}</strong><span>${ar(p.score)} نقطة ${p.answered?'✓':''}</span></div>`).join('')}
async function answerQuestion(index,button){if(answeredThisQuestion)return;answeredThisQuestion=true;const q=gameQuestions[currentQ],all=document.querySelectorAll('.answer'),correct=index===q.c;all.forEach(x=>x.disabled=true);button.classList.add(correct?'correct':'wrong');if(!correct)all[q.c].classList.add('correct');$('#answerStatus').textContent=correct?'إجابة صحيحة! أحسنت 🎉':'ليست الإجابة الصحيحة، حظاً أوفر!';gameReview.push({q:q.q,img:q.img,options:q.a,correctIndex:q.c,yourIndex:index,correct});if(correct){soundCorrect();speak(CORRECT_PHRASES[Math.floor(Math.random()*CORRECT_PHRASES.length)])}else{soundWrong();speak(WRONG_PHRASES[Math.floor(Math.random()*WRONG_PHRASES.length)])}const left=Math.max(0,Math.ceil((roomState.deadline-Date.now())/1000));try{const result=await api(`/api/rooms/${roomCode}/answer`,{method:'POST',body:JSON.stringify({playerId,questionIndex:currentQ,correct,points:correct?Math.max(10,left*5):0})});roomState=result.room;score=result.score;const sb=$('.scorebar b');if(sb)sb.textContent=ar(score)}catch(e){toast(e.message)}}
function showResults(){clearInterval(questionClock);clearInterval(roomPoll);sessionStorage.removeItem('fikraRoom');overlay.classList.add('show');const sorted=[...(roomState?.players||[])].sort((a,b)=>b.score-a.score);const winner=sorted[0];const me=sorted.find(p=>p.id===playerId);const isHost=roomState?.hostId===playerId;soundWin();speak(winner&&winner.id===playerId?'تهانينا! أنت الفائز':'انتهى التحدّي');saveStats(me?.score||0,roomState?.category||selectedCategory);modal.innerHTML=`<div class="game-end"><div class="trophy">🏆</div><h2>انتهى التحدّي!</h2><p>${winner?`المتصدر: ${escapeHtml(winner.name)} برصيد ${ar(winner.score)} نقطة`:'أحسنتم جميعاً!'}</p><div class="panel" style="text-align:right;margin:18px 0"><div class="rank-list">${sorted.map((p,i)=>`<div class="rank-row"><span class="num">${i+1}</span><span class="r-avatar">${p.team==='الفريق ١'?'🟢':p.team==='الفريق ٢'?'🟣':['🧑🏻','👩🏻','🧑🏽','👨🏻'][i%4]}</span><strong>${escapeHtml(p.name)} ${p.id===playerId?'<small>(أنت)</small>':''}</strong><span>${ar(p.score)} نقطة</span></div>`).join('')}</div></div><p>رصيدك النهائي: ⭐ ${ar(me?.score||0)} نقطة</p>${statsHtml()}${reviewHtml()}<div class="modal-footer"><button class="btn secondary" onclick="closeModal()">العودة للرئيسية</button>${isHost?`<button class="btn secondary" onclick="rematchGame()">🔁 إعادة اللعب</button>`:''}<button class="btn" onclick="shareInvite('whatsapp')">تحدّ صديقاً عبر واتساب ↗</button></div></div>`}
function joinByPhone(){toast('اطلب من المضيف إرسال رابط الدعوة أو رمز الغرفة عبر واتساب.')}
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>openModal(b.dataset.action)));
async function restoreRoom(){const saved=sessionStorage.getItem('fikraRoom');if(!saved)return;try{roomCode=saved;roomState=await api(`/api/rooms/${encodeURIComponent(roomCode)}?playerId=${encodeURIComponent(playerId)}`);selectedCategory=roomState.category;selectedMode=roomState.mode;if(roomState.status==='waiting'){inviteModal(false);beginPolling()}else if(roomState.status==='playing'){beginPolling();renderQuestion()}else if(roomState.status==='finished'){showResults()}}catch(e){sessionStorage.removeItem('fikraRoom');roomCode=''}}
async function autoJoinFromLink(code){
  try{
    const joined=await api(`/api/rooms/${encodeURIComponent(code)}/join`,{method:'POST',body:JSON.stringify({playerId,name:displayName})});
    roomCode=joined.code;roomState=joined;sessionStorage.setItem('fikraRoom',roomCode);history.replaceState(null,'',location.pathname);
    if(roomState.status==='playing')renderQuestion();else if(roomState.status==='intermission')renderStageBreak();else if(roomState.status==='finished')showResults();else inviteModal(false);
    beginPolling();
    toast(`انضممت إلى غرفة ${roomState.category} 🎉`);
  }catch(e){
    openModal('join');$('#joinCode').value=code.toUpperCase();toast(e.message);
  }
}
const urlParams=new URLSearchParams(location.search);const joinParam=urlParams.get('join');const quizParam=urlParams.get('quiz');
if(quizParam){setTimeout(()=>openQuizForParticipant(quizParam.toUpperCase()),150)}
else if(joinParam){setTimeout(()=>autoJoinFromLink(joinParam.toUpperCase()),150)}
else restoreRoom();
