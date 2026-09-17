(function () {
  'use strict';

  const BUILTIN = Array.isArray(window.BANK) ? window.BANK : [];
  const KEYS = {
    custom: 'EXAM_CUSTOM_QUESTIONS', records: 'EXAM_REVIEW_RECORDS',
    stats: 'EXAM_USER_STATS', settings: 'EXAM_SETTINGS',
    attempts: 'EXAM_ATTEMPTS', cursors: 'EXAM_CURSORS'
  };
  const DEFAULT_SETTINGS = { dailyNewLimit: 20, dailyReviewLimit: 50, shuffleOptions: false, wrongRedo: true };
  const DEFAULT_STATS = { totalDone: 0, totalCorrect: 0, streak: 0, lastStudyDate: '', masteredCount: 0 };
  const NAV = [
    ['home', '今日'], ['practice', '刷题'], ['wrong', '错题'],
    ['plan', '计划'], ['stats', '统计'], ['manage', '设置']
  ];
  const app = document.getElementById('app');
  const state = {
    questions: read(KEYS.custom, null) || BUILTIN,
    records: read(KEYS.records, {}),
    stats: Object.assign({}, DEFAULT_STATS, read(KEYS.stats, {})),
    settings: Object.assign({}, DEFAULT_SETTINGS, read(KEYS.settings, {})),
    attempts: read(KEYS.attempts, []),
    cursors: read(KEYS.cursors, {}),
    view: 'home', session: null, result: null, wrongFilter: '全部章节',
    planGroups: [], flash: ''
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { state.flash = '浏览器存储空间不足，学习记录可能无法保存。'; return false; }
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function today() { return formatDate(new Date()); }
  function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function addDays(day, n) {
    const [y, m, d] = day.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + n);
    return formatDate(date);
  }
  function newRecord(id) {
    return { questionId: id, ease: 2.5, interval: 0, dueDate: today(), reps: 0, lapses: 0,
      correctCount: 0, wrongCount: 0, isWrong: false, isFavorite: false, mastery: 'new',
      correctStreak: 0, lastCorrectDate: '', lastAnsweredDate: '', firstStudyDate: '', lastReviewedDate: '' };
  }
  function hasStudied(record) {
    return !!(record && (record.firstStudyDate || record.correctCount || record.wrongCount));
  }
  function isDue(record, day) {
    return record.dueDate <= day || (record.isWrong && record.lastCorrectDate !== day);
  }
  function dailyPlan() {
    const day = today();
    const due = state.questions.filter(q => hasStudied(state.records[q.id]) && isDue(state.records[q.id], day));
    due.sort((a, b) => {
      const left = state.records[a.id], right = state.records[b.id];
      return Number(right.isWrong) - Number(left.isWrong) || left.dueDate.localeCompare(right.dueDate);
    });
    const records = Object.values(state.records);
    const reviewedToday = records.filter(r => r.lastReviewedDate === day).length;
    const newToday = records.filter(r => r.firstStudyDate === day).length;
    const wrong = due.filter(q => state.records[q.id].isWrong);
    const other = due.filter(q => !state.records[q.id].isWrong && state.records[q.id].lastReviewedDate !== day);
    const newWrong = wrong.filter(q => state.records[q.id].lastReviewedDate !== day).length;
    const slots = Math.max(0, state.settings.dailyReviewLimit - reviewedToday - newWrong);
    const review = wrong.concat(other.slice(0, slots));
    const fresh = state.questions.filter(q => !hasStudied(state.records[q.id]))
      .slice(0, Math.max(0, state.settings.dailyNewLimit - newToday));
    return { review, fresh, questions: review.concat(fresh), dueTotal: due.length };
  }
  function grade(q, correct) {
    const day = today();
    const record = Object.assign(newRecord(q.id), state.records[q.id] || {});
    const studied = !!record.firstStudyDate;
    if (!record.firstStudyDate) record.firstStudyDate = day;
    if (studied || !correct) record.lastReviewedDate = day;
    if (correct) {
      record.reps++;
      record.correctCount++;
      record.correctStreak++;
      const steps = [1, 3, 7, 15, 30];
      record.interval = record.reps <= 5 ? steps[record.reps - 1] : Math.round(Math.max(30, record.interval) * record.ease);
      record.ease = Math.min(3, Math.round((record.ease + .05) * 100) / 100);
      record.dueDate = addDays(day, record.interval);
      record.lastCorrectDate = day;
      if (record.isWrong && record.correctStreak >= 2) record.isWrong = false;
      record.mastery = record.correctStreak >= 5 || record.interval >= 30 ? 'mastered' : record.reps >= 2 ? 'review' : 'learning';
    } else {
      record.lapses++;
      record.wrongCount++;
      record.reps = 0;
      record.correctStreak = 0;
      record.interval = 1;
      record.ease = Math.max(1.3, Math.round((record.ease - .2) * 100) / 100);
      record.dueDate = addDays(day, 1);
      record.isWrong = true;
      record.lastCorrectDate = '';
      record.mastery = 'learning';
    }
    record.lastAnsweredDate = day;
    state.records[q.id] = record;
    write(KEYS.records, state.records);
    if (state.stats.lastStudyDate !== day) {
      state.stats.streak = state.stats.lastStudyDate === addDays(day, -1) ? state.stats.streak + 1 : 1;
      state.stats.lastStudyDate = day;
    }
    state.stats.totalDone++;
    if (correct) state.stats.totalCorrect++;
    state.stats.masteredCount = Object.values(state.records).filter(r => r.mastery === 'mastered').length;
    write(KEYS.stats, state.stats);
    state.attempts.push({ questionId: q.id, chapter: q.chapter, correct, date: day });
    write(KEYS.attempts, state.attempts);
  }
  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  function batch(key, list, max) {
    if (list.length <= max) return list;
    const start = (state.cursors[key] || 0) % list.length;
    const chosen = Array.from({ length: max }, (_, i) => list[(start + i) % list.length]);
    state.cursors[key] = (start + max) % list.length;
    write(KEYS.cursors, state.cursors);
    return chosen;
  }
  function startMode(mode, arg) {
    let list = state.questions.slice();
    let title = '顺序刷题';
    if (mode === 'random') { list = shuffle(list).slice(0, 20); title = '随机刷题'; }
    else if (mode === 'chapter') { list = list.filter(q => q.chapter === arg); title = arg || '章节刷题'; }
    else if (mode === 'wrong') { list = list.filter(q => state.records[q.id] && state.records[q.id].isWrong); title = '错题重练'; }
    else if (mode === 'favorite') { list = list.filter(q => state.records[q.id] && state.records[q.id].isFavorite); title = '收藏练习'; }
    else if (mode === 'unmastered') { list = list.filter(q => !state.records[q.id] || state.records[q.id].mastery !== 'mastered'); title = '未掌握题'; }
    else if (mode === 'daily') { list = dailyPlan().questions; title = '今日复习'; }
    else if (mode === 'selection') { list = (arg || []).map(id => state.questions.find(q => q.id === id)).filter(Boolean); title = '计划复习'; }
    if (mode !== 'daily' && mode !== 'random') {
      const key = mode === 'selection' ? `selection:${list.length}:${list[0] ? list[0].id : ''}:${list[list.length - 1] ? list[list.length - 1].id : ''}` : `${mode}:${arg || ''}`;
      list = batch(key, list, 20);
    }
    if (!list.length) { state.flash = '当前没有可练习的题目。'; state.view = 'home'; render(); return; }
    state.session = { mode, arg, title, ids: list.map(q => q.id), cursor: 0, states: {}, redo: {}, total: 0, correct: 0, wrongIds: [] };
    state.result = null;
    state.view = 'practice';
    render();
  }
  function currentQuestion() {
    if (!state.session) return null;
    return state.questions.find(q => q.id === state.session.ids[state.session.cursor]) || null;
  }
  function currentAnswer() {
    const session = state.session;
    if (!session) return null;
    if (!session.states[session.cursor]) {
      const q = currentQuestion();
      session.states[session.cursor] = { selected: [], submitted: false, correct: false,
        options: state.settings.shuffleOptions ? shuffle(q.options) : q.options.slice() };
    }
    return session.states[session.cursor];
  }
  function saveSettings() { write(KEYS.settings, state.settings); render(); }
  function resetProgress() {
    state.records = {};
    state.stats = Object.assign({}, DEFAULT_STATS);
    state.attempts = [];
    state.cursors = {};
    state.session = null;
    state.result = null;
    write(KEYS.records, state.records);
    write(KEYS.stats, state.stats);
    write(KEYS.attempts, state.attempts);
    write(KEYS.cursors, state.cursors);
  }
  function typeLabel(type) { return type === 'multiple' ? '多选' : type === 'judge' ? '判断' : '单选'; }
  function btn(action, label, kind, extra) {
    return `<button class="btn ${kind || ''}" data-action="${action}" ${extra || ''}>${label}</button>`;
  }
  function renderNav() {
    const active = state.view === 'result' ? 'practice' : state.view;
    const html = NAV.map(([view, label]) => `<button class="nav-btn ${active === view ? 'active' : ''}" data-action="nav" data-view="${view}" ${active === view ? 'aria-current="page"' : ''}>${label}</button>`).join('');
    document.getElementById('desktop-nav').innerHTML = html;
    document.getElementById('mobile-nav').innerHTML = html;
  }
  function render(preserveScroll) {
    renderNav();
    document.getElementById('header-date').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
    document.getElementById('top-count').textContent = `${state.questions.length} 道题`;
    const pages = { home: renderHome, practice: renderPractice, wrong: renderWrong, plan: renderPlan,
      stats: renderStats, manage: renderManage, result: renderResult };
    app.innerHTML = (state.flash ? `<div class="card error-text" role="alert">${esc(state.flash)}</div>` : '') + (pages[state.view] || renderHome)();
    state.flash = '';
    if (!preserveScroll) window.scrollTo(0, 0);
  }
  function renderHome() {
    const plan = dailyPlan();
    const stats = state.stats;
    const accuracy = stats.totalDone ? Math.round(stats.totalCorrect / stats.totalDone * 100) : 0;
    const streak = [today(), addDays(today(), -1)].includes(stats.lastStudyDate) ? stats.streak : 0;
    const chapters = Array.from(new Set(state.questions.map(q => q.chapter)));
    return `<div class="page-head"><div><h1>今日学习</h1><p class="sub">按计划复习，答错的题会优先再练。</p></div></div>
      <section class="card hero"><div><span class="eyebrow">今日计划</span><h2>${plan.questions.length} 道待完成</h2><p class="detail">到期复习 ${plan.dueTotal} 道 · 新题 ${plan.fresh.length} 道</p></div>${btn('start', '开始今日复习', 'white', 'data-mode="daily"')}</section>
      <div class="metric-grid"><div class="card metric"><b>${state.questions.length}</b><span>题库总题</span></div><div class="card metric"><b>${stats.masteredCount}</b><span>已掌握</span></div><div class="card metric"><b>${accuracy}%</b><span>累计正确率</span></div><div class="card metric"><b>${streak} 天</b><span>连续学习</span></div></div>
      <div class="split"><section class="card"><h2>选择练习方式</h2><div class="mode-grid">
        <button class="mode-tile" data-action="start" data-mode="all"><strong>顺序刷题</strong><span>每轮 20 道，接着上轮继续</span></button>
        <button class="mode-tile" data-action="start" data-mode="random"><strong>随机刷题</strong><span>每轮随机抽取 20 道</span></button>
        <button class="mode-tile" data-action="start" data-mode="unmastered"><strong>未掌握题</strong><span>集中练习未熟练的题</span></button>
        <button class="mode-tile" data-action="start" data-mode="favorite"><strong>收藏练习</strong><span>回顾标记的重点题</span></button>
      </div><div class="filter-row" style="margin-top:19px;margin-bottom:0"><label for="chapter-home">按章节练习</label><select class="field" id="chapter-home"><option value="">选择章节</option>${chapters.map(ch => `<option value="${esc(ch)}">${esc(ch)}</option>`).join('')}</select></div>${btn('chapter', '开始章节练习', 'soft', 'style="width:100%;margin-top:11px"')}</section>
      <section class="card"><h2>学习记录</h2><p class="notice">每次提交都会立即保存。错题连续答对两次后移出错题本；连续答对五次可标记为已掌握。</p><div style="margin-top:20px" class="btn-row">${btn('nav','查看错题','outline','data-view="wrong"')}${btn('nav','复习计划','soft','data-view="plan"')}</div></section></div>`;
  }
  function renderPractice() {
    if (!state.session) return `<div class="page-head"><div><h1>开始刷题</h1><p class="sub">选择一个练习方式。</p></div></div><div class="card"><div class="btn-row">${btn('start','顺序刷题','', 'data-mode="all"')}${btn('start','随机刷题','soft','data-mode="random"')}${btn('start','错题重练','soft','data-mode="wrong"')}${btn('start','今日复习','soft','data-mode="daily"')}</div></div>`;
    const s = state.session, q = currentQuestion(), a = currentAnswer();
    if (!q) return `<div class="card empty">这道题已不在当前题库中。${btn('nav','返回首页','soft','data-view="home"')}</div>`;
    const percent = Math.round((s.cursor + 1) / s.ids.length * 100);
    const record = state.records[q.id];
    const options = a.options.map(option => {
      let status = a.selected.includes(option.key) ? 'selected' : '';
      if (a.submitted && q.answer.includes(option.key)) status = 'right';
      else if (a.submitted && status) status = 'wrong';
      return `<button class="option ${status}" data-action="choose" data-key="${esc(option.key)}" ${a.submitted ? 'disabled' : ''}><span class="option-key">${esc(option.key)}</span><span>${esc(option.text)}</span></button>`;
    }).join('');
    return `<div class="page-head"><div><h1>${esc(s.title)}</h1><p class="sub">${s.cursor + 1} / ${s.ids.length} 题</p></div>${btn('end','结束本轮','neutral')}</div>
      <div class="quiz-meta"><span class="strong">第 ${s.cursor + 1} 题</span><span>${percent}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
      <section class="card question-card"><div class="tag-row"><span class="tag">${typeLabel(q.type)}</span><span class="tag gray">${esc(q.chapter)}</span><button class="favorite" data-action="favorite" aria-label="${record && record.isFavorite ? '取消收藏' : '收藏题目'}">${record && record.isFavorite ? '★ 已收藏' : '☆ 收藏'}</button></div>
        <div class="stem">${esc(q.question)}</div><div class="question-hint">${q.type === 'multiple' ? '可选择多个答案' : '请选择一个答案'}</div>${options}
        ${a.submitted ? `<div class="feedback ${a.correct ? 'good' : 'bad'}"><strong>${a.correct ? '回答正确' : '回答错误'} · 正确答案：${esc(q.answer.join('、'))}</strong><span>${esc(q.explanation || '本题暂无解析。')}</span></div>` : ''}
      </section><div class="quiz-actions">${btn('previous','上一题','neutral',s.cursor === 0 ? 'disabled' : '')}${a.submitted ? btn('next',s.cursor === s.ids.length - 1 ? '查看结果' : '下一题','') : btn('submit','提交答案','',a.selected.length ? '' : 'disabled')}</div>`;
  }
  function renderResult() {
    const result = state.result;
    if (!result) return `<div class="card empty">还没有本轮结果。</div>`;
    const accuracy = result.total ? Math.round(result.correct / result.total * 100) : 0;
    const wrong = result.wrongIds.map(id => state.questions.find(q => q.id === id)).filter(Boolean);
    return `<div class="page-head"><h1>本轮结果</h1></div><section class="card result-summary"><div class="result-score">${accuracy}%</div><p>共答 ${result.total} 题 · 答对 ${result.correct} 题</p></section>
      <section class="card"><h2>本轮答错 ${wrong.length} 题</h2>${wrong.length ? wrong.map(q => `<div class="list-item"><div class="list-meta">${esc(q.chapter)}</div><div class="list-title">${esc(q.question)}</div><div class="list-answer">正确答案：${esc(q.answer.join('、'))}</div></div>`).join('') : '<p class="notice">全部答对。</p>'}</section>
      <div class="btn-row">${btn('again','再来一轮','')}${btn('nav','查看错题','soft','data-view="wrong"')}${btn('nav','返回首页','neutral','data-view="home"')}</div>`;
  }
  function renderWrong() {
    const all = state.questions.filter(q => state.records[q.id] && state.records[q.id].isWrong);
    const chapters = ['全部章节'].concat(Array.from(new Set(all.map(q => q.chapter))));
    if (!chapters.includes(state.wrongFilter)) state.wrongFilter = '全部章节';
    const visible = state.wrongFilter === '全部章节' ? all : all.filter(q => q.chapter === state.wrongFilter);
    return `<div class="page-head"><div><h1>错题本</h1><p class="sub">答错自动收录，连续答对两次移出。</p></div></div><div class="card"><div class="filter-row"><span>${visible.length} 道错题</span><select id="wrong-filter" class="field" aria-label="按章节筛选">${chapters.map(ch => `<option value="${esc(ch)}" ${state.wrongFilter === ch ? 'selected' : ''}>${esc(ch)}</option>`).join('')}</select></div>${btn('wrongPractice','开始错题练习','',visible.length ? '' : 'disabled')}</div>
      <section class="card">${visible.length ? visible.map(q => `<div class="list-item"><div class="list-meta">${esc(q.chapter)} · ${typeLabel(q.type)}</div><div class="list-title">${esc(q.question)}</div><div class="list-action"><span class="list-answer">答案：${esc(q.answer.join('、'))}</span><button class="text-button" data-action="removeWrong" data-id="${esc(q.id)}">移出错题本</button></div></div>`).join('') : '<div class="empty">目前没有错题。</div>'}</section>`;
  }
  function renderPlan() {
    const day = today(), tomorrow = addDays(day, 1), seven = addDays(day, 7), plan = dailyPlan();
    const groups = [
      { title: '今天', items: [] }, { title: '明天', items: [] },
      { title: '未来 7 天', items: [] }, { title: '更晚', items: [] }
    ];
    state.questions.forEach(q => {
      const record = state.records[q.id];
      if (!hasStudied(record)) return;
      const index = isDue(record, day) ? 0 : record.dueDate <= tomorrow ? 1 : record.dueDate <= seven ? 2 : 3;
      groups[index].items.push(q);
    });
    plan.fresh.forEach(q => groups[0].items.push(q));
    state.planGroups = groups;
    return `<div class="page-head"><div><h1>复习计划</h1><p class="sub">今日新题 ${plan.fresh.length} 道，每日常规复习上限 ${state.settings.dailyReviewLimit} 道；错题优先。</p></div></div>
      <div class="plan-grid">${groups.map((group, index) => `<section class="card plan-card"><div class="row"><h2>${group.title}</h2><span class="count">${group.items.length}</span></div><div class="btn-row">${btn('planStart','开始复习',index === 0 ? '' : 'soft',`data-index="${index}" ${group.items.length ? '' : 'disabled'}`)}</div>${group.items.length ? group.items.slice(0, 3).map(q => `<p class="plan-preview">${esc(q.question)}</p>`).join('') : '<p class="notice" style="margin-top:12px">暂无安排</p>'}${group.items.length > 3 ? `<p class="notice" style="margin-top:9px">另有 ${group.items.length - 3} 道题</p>` : ''}</section>`).join('')}</div>`;
  }
  function renderStats() {
    const stats = state.stats, day = today();
    const todayDone = state.attempts.filter(a => a.date === day).length;
    const accuracy = stats.totalDone ? Math.round(stats.totalCorrect / stats.totalDone * 100) : 0;
    const streak = [day, addDays(day, -1)].includes(stats.lastStudyDate) ? stats.streak : 0;
    const map = {};
    state.questions.forEach(q => { if (!map[q.chapter]) map[q.chapter] = { name: q.chapter, done: 0, correct: 0 }; });
    state.attempts.forEach(a => { if (map[a.chapter]) { map[a.chapter].done++; if (a.correct) map[a.chapter].correct++; } });
    return `<div class="page-head"><div><h1>学习统计</h1><p class="sub">每次提交计为一次做题。</p></div></div>
      <div class="metric-grid"><div class="card metric"><b>${todayDone}</b><span>今日做题</span></div><div class="card metric"><b>${stats.totalDone}</b><span>累计做题</span></div><div class="card metric"><b>${accuracy}%</b><span>正确率</span></div><div class="card metric"><b>${streak} 天</b><span>连续学习</span></div></div>
      <section class="card"><h2>已掌握 ${stats.masteredCount} 题</h2><p class="notice">连续答对 5 次或复习间隔达到 30 天的题目会标记为已掌握。</p></section>
      <section class="card"><h2>各章节正确率</h2>${Object.values(map).map(ch => { const pct = ch.done ? Math.round(ch.correct / ch.done * 100) : 0; return `<div class="stat-row"><div class="row"><span>${esc(ch.name)}</span><span>${pct}% · ${ch.done} 题</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`; }).join('')}</section>`;
  }
  function renderManage() {
    return `<div class="page-head"><div><h1>题库与设置</h1><p class="sub">当前 ${state.questions.length} 道题。学习记录只保存在这个浏览器中。</p></div></div>
      <section class="card"><h2>学习设置</h2>
        <label class="settings-row"><span>每日新题数<small>今日计划中的新题上限</small></span><input class="field" type="number" min="0" max="500" id="daily-new" value="${state.settings.dailyNewLimit}"></label>
        <label class="settings-row"><span>每日复习上限<small>错题仍会优先出现</small></span><input class="field" type="number" min="0" max="500" id="daily-review" value="${state.settings.dailyReviewLimit}"></label>
        <label class="settings-row"><span>乱序选项<small>答案字母仍对应原选项</small></span><input class="switch" type="checkbox" id="shuffle-options" ${state.settings.shuffleOptions ? 'checked' : ''}></label>
        <label class="settings-row"><span>答错本轮重做<small>错题在本轮末尾再出现一次</small></span><input class="switch" type="checkbox" id="wrong-redo" ${state.settings.wrongRedo ? 'checked' : ''}></label>
      </section>
      <section class="card"><h2>题库管理</h2><p class="notice">粘贴 Question 对象数组的 JSON。导入后将替换当前题库并清空学习进度。</p><textarea class="textarea" id="json-input" placeholder='[{"id":"q1","type":"single","chapter":"示例章节",...}]' aria-label="题库 JSON"></textarea><div class="btn-row">${btn('import','验证并导入','')}${btn('restore','恢复原始题库','soft')}</div></section>
      <section class="card"><h2>清理数据</h2><p class="notice">清空进度会删除答题记录、错题和收藏，保留当前题库。</p><div style="margin-top:14px">${btn('clear','清空学习进度','danger')}</div></section>`;
  }

  function validateImport(value) {
    if (!Array.isArray(value) || !value.length) throw new Error('请粘贴非空题目数组。');
    const ids = new Set();
    value.forEach((q, i) => {
      const n = i + 1;
      if (!q || typeof q.id !== 'string' || !q.id.trim() || ids.has(q.id)) throw new Error(`第 ${n} 题的 id 缺失或重复。`);
      ids.add(q.id);
      if (!['single', 'multiple', 'judge'].includes(q.type)) throw new Error(`第 ${n} 题的题型不正确。`);
      if (typeof q.chapter !== 'string' || !q.chapter.trim() || typeof q.question !== 'string' || !q.question.trim()) throw new Error(`第 ${n} 题缺少章节或题干。`);
      if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`第 ${n} 题至少需要两个选项。`);
      const keys = new Set();
      q.options.forEach(option => {
        if (!option || !/^[A-H]$/.test(option.key) || keys.has(option.key) || typeof option.text !== 'string' || !option.text.trim()) throw new Error(`第 ${n} 题选项格式不正确。`);
        keys.add(option.key);
      });
      if (!Array.isArray(q.answer) || !q.answer.length || new Set(q.answer).size !== q.answer.length || q.answer.some(key => !keys.has(key)) || (q.type !== 'multiple' && q.answer.length !== 1)) throw new Error(`第 ${n} 题答案不正确。`);
      if (typeof q.explanation !== 'string' || !Array.isArray(q.tags) || q.tags.some(tag => typeof tag !== 'string') || ![1, 2, 3].includes(q.difficulty)) throw new Error(`第 ${n} 题解析、标签或难度不正确。`);
    });
    return value;
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'nav') { state.view = target.dataset.view; render(); return; }
    if (action === 'start') { startMode(target.dataset.mode || 'all'); return; }
    if (action === 'chapter') { const value = document.getElementById('chapter-home').value; if (value) startMode('chapter', value); else { state.flash = '请先选择章节。'; render(); } return; }
    if (action === 'wrongPractice') {
      const list = state.questions.filter(q => state.records[q.id] && state.records[q.id].isWrong && (state.wrongFilter === '全部章节' || q.chapter === state.wrongFilter));
      startMode('selection', list.map(q => q.id)); return;
    }
    if (action === 'planStart') {
      const i = Number(target.dataset.index);
      if (i === 0) startMode('daily');
      else startMode('selection', state.planGroups[i].items.map(q => q.id));
      return;
    }
    if (action === 'choose') {
      const q = currentQuestion(), a = currentAnswer(), key = target.dataset.key;
      if (!q || a.submitted) return;
      if (q.type === 'multiple') a.selected = a.selected.includes(key) ? a.selected.filter(k => k !== key) : a.selected.concat(key);
      else a.selected = [key];
      render(true); return;
    }
    if (action === 'submit') {
      const q = currentQuestion(), a = currentAnswer(), s = state.session;
      if (!q || a.submitted || !a.selected.length) return;
      a.correct = a.selected.slice().sort().join(',') === q.answer.slice().sort().join(',');
      a.submitted = true;
      grade(q, a.correct);
      s.total++;
      if (a.correct) s.correct++;
      else {
        if (!s.wrongIds.includes(q.id)) s.wrongIds.push(q.id);
        if (state.settings.wrongRedo && !s.redo[q.id]) { s.ids.push(q.id); s.redo[q.id] = true; }
      }
      render(true); return;
    }
    if (action === 'favorite') {
      const q = currentQuestion(); if (!q) return;
      const record = Object.assign(newRecord(q.id), state.records[q.id] || {});
      record.isFavorite = !record.isFavorite;
      state.records[q.id] = record;
      write(KEYS.records, state.records);
      render(true); return;
    }
    if (action === 'previous') { if (state.session && state.session.cursor > 0) { state.session.cursor--; render(); } return; }
    if (action === 'next') {
      const s = state.session;
      if (!s || !currentAnswer().submitted) return;
      if (s.cursor < s.ids.length - 1) { s.cursor++; render(); }
      else finishSession();
      return;
    }
    if (action === 'end') { if (state.session && window.confirm('结束本轮并查看已完成的结果？')) finishSession(); return; }
    if (action === 'again') { const r = state.result; if (r) startMode(r.mode, r.arg); return; }
    if (action === 'removeWrong') {
      const id = target.dataset.id;
      if (!window.confirm('把这道题移出错题本？答题记录会保留。')) return;
      if (state.records[id]) { state.records[id].isWrong = false; write(KEYS.records, state.records); render(); }
      return;
    }
    if (action === 'import') {
      try {
        const value = validateImport(JSON.parse(document.getElementById('json-input').value));
        state.questions = value;
        write(KEYS.custom, value);
        resetProgress();
        state.flash = `已导入 ${value.length} 道题。`;
      } catch (error) { state.flash = error instanceof SyntaxError ? 'JSON 格式错误，请检查引号和标点。' : error.message; }
      render(); return;
    }
    if (action === 'restore') {
      if (!window.confirm('恢复原始题库会清空当前学习进度，确定继续？')) return;
      state.questions = BUILTIN;
      localStorage.removeItem(KEYS.custom);
      resetProgress();
      state.flash = `已恢复 ${BUILTIN.length} 道原始题。`;
      render(); return;
    }
    if (action === 'clear') {
      if (!window.confirm('确定清空全部学习进度、错题和收藏？')) return;
      resetProgress();
      state.flash = '学习进度已清空。';
      render();
    }
  });
  function finishSession() {
    const s = state.session;
    state.result = { mode: s.mode, arg: s.arg, total: s.total, correct: s.correct, wrongIds: s.wrongIds.slice() };
    state.session = null;
    state.view = 'result';
    render();
  }
  document.addEventListener('change', event => {
    const id = event.target.id;
    if (id === 'wrong-filter') { state.wrongFilter = event.target.value; render(); }
    if (id === 'daily-new' || id === 'daily-review') {
      const n = Number(event.target.value);
      if (!Number.isInteger(n) || n < 0 || n > 500) { state.flash = '请输入 0 到 500 的整数。'; render(); return; }
      state.settings[id === 'daily-new' ? 'dailyNewLimit' : 'dailyReviewLimit'] = n;
      saveSettings();
    }
    if (id === 'shuffle-options' || id === 'wrong-redo') {
      state.settings[id === 'shuffle-options' ? 'shuffleOptions' : 'wrongRedo'] = event.target.checked;
      saveSettings();
    }
  });

  if (!BUILTIN.length) app.innerHTML = '<div class="card empty">题库加载失败，请刷新页面。</div>';
  else render();
})();
