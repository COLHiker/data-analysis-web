(function () {
  'use strict';

  const BUILTIN = Array.isArray(window.BANK) ? window.BANK : [];
  const KEYS = {
    custom: 'EXAM_CUSTOM_QUESTIONS', records: 'EXAM_REVIEW_RECORDS',
    stats: 'EXAM_USER_STATS', settings: 'EXAM_SETTINGS',
    attempts: 'EXAM_ATTEMPTS', cursors: 'EXAM_CURSORS',
    session: 'EXAM_SESSION', savedSessions: 'EXAM_SAVED_SESSIONS',
    settingsVersion: 'EXAM_SETTINGS_VERSION', passProgress: 'EXAM_PASS_PROGRESS'
  };
  const DEFAULT_SETTINGS = { dailyNewLimit: 500, dailyReviewLimit: 200, shuffleOptions: false, wrongRedo: true };
  const DEFAULT_STATS = { totalDone: 0, totalCorrect: 0, streak: 0, lastStudyDate: '', masteredCount: 0 };
  const NAV = [
    ['home', '今日'], ['practice', '刷题'], ['wrong', '错题'],
    ['plan', '计划'], ['stats', '统计'], ['manage', '设置']
  ];
  const app = document.getElementById('app');
  const savedSettings = read(KEYS.settings, null);
  const state = {
    questions: read(KEYS.custom, null) || BUILTIN,
    records: read(KEYS.records, {}),
    stats: Object.assign({}, DEFAULT_STATS, read(KEYS.stats, {})),
    settings: Object.assign({}, DEFAULT_SETTINGS, savedSettings || {}),
    attempts: read(KEYS.attempts, []),
    cursors: read(KEYS.cursors, {}),
    passProgress: read(KEYS.passProgress, null),
    view: 'home', session: read(KEYS.session, null), savedSessions: read(KEYS.savedSessions, []),
    result: null, wrongFilter: '全部章节',
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
  if (read(KEYS.settingsVersion, 0) < 2) {
    if (savedSettings && savedSettings.dailyNewLimit === 20 && savedSettings.dailyReviewLimit === 50) {
      state.settings.dailyNewLimit = 500;
      state.settings.dailyReviewLimit = 200;
      write(KEYS.settings, state.settings);
    }
    write(KEYS.settingsVersion, 2);
  }
  function validSession(session, questions) {
    if (!session || !Array.isArray(session.ids) || !session.ids.length || !Number.isInteger(session.cursor) ||
        session.cursor < 0 || session.cursor >= session.ids.length || !session.states || typeof session.states !== 'object' ||
        !Number.isInteger(session.total) || !Number.isInteger(session.correct) || !Array.isArray(session.wrongIds)) return false;
    const ids = new Set(questions.map(q => q.id));
    return session.ids.every(id => ids.has(id));
  }
  if (!validSession(state.session, state.questions)) state.session = null;
  state.savedSessions = Array.isArray(state.savedSessions)
    ? state.savedSessions.filter(session => validSession(session, state.questions)) : [];
  function saveSession() { write(KEYS.session, state.session); }
  function switchSession(next, saved) {
    const previous = state.savedSessions;
    if (!write(KEYS.savedSessions, saved)) return false;
    if (!write(KEYS.session, next)) {
      write(KEYS.savedSessions, previous);
      return false;
    }
    state.savedSessions = saved;
    state.session = next;
    state.result = null;
    state.view = 'practice';
    render();
    return true;
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
  function initialPassProgress(questions, records) {
    const studied = questions.filter(q => hasStudied(records[q.id])).map(q => q.id);
    return studied.length === questions.length && questions.length
      ? { completed: 1, seenIds: [] }
      : { completed: 0, seenIds: studied };
  }
  function validPassProgress(progress, questions) {
    if (!progress || !Number.isInteger(progress.completed) || progress.completed < 0 ||
        !Array.isArray(progress.seenIds) || progress.seenIds.length >= questions.length) return false;
    const validIds = new Set(questions.map(q => q.id));
    return new Set(progress.seenIds).size === progress.seenIds.length && progress.seenIds.every(id => validIds.has(id));
  }
  if (!validPassProgress(state.passProgress, state.questions)) {
    state.passProgress = initialPassProgress(state.questions, state.records);
    write(KEYS.passProgress, state.passProgress);
  }
  function passPlan() {
    const seen = new Set(state.passProgress.seenIds);
    return { completed: state.passProgress.completed, done: seen.size,
      pending: state.questions.filter(q => !seen.has(q.id)) };
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
    if (!state.passProgress.seenIds.includes(q.id)) {
      state.passProgress.seenIds.push(q.id);
      if (state.passProgress.seenIds.length === state.questions.length) {
        state.passProgress.completed++;
        state.passProgress.seenIds = [];
      }
      write(KEYS.passProgress, state.passProgress);
    }
  }
  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  function startMode(mode, arg) {
    let list = state.questions.slice();
    let title = '全题库顺序刷题';
    if (mode === 'random') { list = shuffle(list); title = '全题库随机刷题'; }
    else if (mode === 'chapter') { list = list.filter(q => q.chapter === arg); title = arg || '章节刷题'; }
    else if (mode === 'wrong') { list = list.filter(q => state.records[q.id] && state.records[q.id].isWrong); title = '错题重练'; }
    else if (mode === 'favorite') { list = list.filter(q => state.records[q.id] && state.records[q.id].isFavorite); title = '收藏练习'; }
    else if (mode === 'unmastered') { list = list.filter(q => !state.records[q.id] || state.records[q.id].mastery !== 'mastered'); title = '未掌握题'; }
    else if (mode === 'pass') { const plan = passPlan(); list = plan.pending; title = `全题库第 ${plan.completed + 1} 遍`; }
    else if (mode === 'daily') { list = dailyPlan().questions; title = '今日复习'; }
    else if (mode === 'selection') { list = (arg || []).map(id => state.questions.find(q => q.id === id)).filter(Boolean); title = '计划复习'; }
    else if (mode === 'picked') { list = (arg || []).map(id => state.questions.find(q => q.id === id)).filter(Boolean); title = '自选题目'; }
    if (!list.length) { state.flash = '当前没有可练习的题目。'; state.view = 'home'; render(); return; }
    const next = { mode, arg, title, ids: list.map(q => q.id), cursor: 0, states: {}, redo: {}, total: 0, correct: 0, wrongIds: [] };
    const saved = state.session ? [state.session, ...state.savedSessions] : state.savedSessions;
    if (!switchSession(next, saved)) render();
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
      saveSession();
    }
    return session.states[session.cursor];
  }
  function saveSettings() { write(KEYS.settings, state.settings); render(); }
  function resetProgress() {
    state.records = {};
    state.stats = Object.assign({}, DEFAULT_STATS);
    state.attempts = [];
    state.cursors = {};
    state.passProgress = { completed: 0, seenIds: [] };
    state.session = null;
    state.savedSessions = [];
    state.result = null;
    write(KEYS.records, state.records);
    write(KEYS.stats, state.stats);
    write(KEYS.attempts, state.attempts);
    write(KEYS.cursors, state.cursors);
    write(KEYS.passProgress, state.passProgress);
    saveSession();
    write(KEYS.savedSessions, state.savedSessions);
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
    const pages = { home: renderHome, practice: renderPractice, wrong: renderWrong, plan: renderPlan,
      stats: renderStats, manage: renderManage, result: renderResult };
    app.innerHTML = (state.flash ? `<div class="card error-text" role="alert">${esc(state.flash)}</div>` : '') + (pages[state.view] || renderHome)();
    state.flash = '';
    if (!preserveScroll) window.scrollTo(0, 0);
  }
  function renderHome() {
    const pass = passPlan();
    const stats = state.stats;
    const accuracy = stats.totalDone ? Math.round(stats.totalCorrect / stats.totalDone * 100) : 0;
    const streak = [today(), addDays(today(), -1)].includes(stats.lastStudyDate) ? stats.streak : 0;
    const chapterMap = new Map();
    state.questions.forEach(q => {
      if (!chapterMap.has(q.chapter)) chapterMap.set(q.chapter, []);
      chapterMap.get(q.chapter).push(q);
    });
    const chapters = Array.from(chapterMap, ([name, questions]) => {
      const studied = questions.filter(q => hasStudied(state.records[q.id])).length;
      const mastered = questions.filter(q => state.records[q.id] && state.records[q.id].mastery === 'mastered').length;
      return { name, count: questions.length, studied, mastered };
    });
    const unfinished = (state.session ? [{ session: state.session, index: -1 }] : [])
      .concat(state.savedSessions.map((session, index) => ({ session, index })));
    const resume = unfinished.length ? `<section class="card resume-card"><div><span class="eyebrow">未完成练习</span><h2>保存的刷题断点</h2><p class="detail">开始其他练习时，这些断点会保留；已提交的答题记录会直接保存。</p></div><div class="session-list">${unfinished.map(({ session, index }) => `<div class="session-row"><div class="session-summary"><strong>${esc(session.title || '刷题练习')}</strong><small>第 ${session.cursor + 1} / ${session.ids.length} 题 · 已答 ${session.total} 题${index === -1 ? ' · 当前练习' : ''}</small></div>${btn(index === -1 ? 'resume' : 'resumeSaved','继续刷题',index === -1 ? '' : 'soft',index === -1 ? '' : `data-index="${index}"`)}${index === -1 ? '' : btn('removeSaved','删除断点','neutral',`data-index="${index}"`)}</div>`).join('')}</div></section>` : '';
    return `${resume}<div class="page-head"><div><h1>考试题库</h1><p class="sub">选择分类开始刷题，答错的题会优先再练。</p></div></div>
      <section class="card chapter-library"><div class="section-heading"><h2>分类题库</h2><p class="notice">共 ${chapters.length} 个分类、${state.questions.length} 道题。选择分类即可开始刷题。</p></div>
        <div class="chapter-list">${chapters.map((chapter, index) => `<div class="chapter-card"><span class="chapter-index">${String(index + 1).padStart(2, '0')}</span><div class="chapter-summary"><strong>${esc(chapter.name)}</strong><small>${chapter.count} 道题 · 已做 ${chapter.studied} · 已掌握 ${chapter.mastered}</small><span class="chapter-progress"><span style="width:${chapter.count ? Math.round(chapter.studied / chapter.count * 100) : 0}%"></span></span></div>${btn('chapterAll','开始刷题','soft',`data-chapter="${esc(chapter.name)}" aria-label="开始刷题：${esc(chapter.name)}"`)}</div>`).join('')}</div>
      </section>
      <section class="card practice-methods"><div class="section-heading"><h2>选择练习方式</h2><p class="notice">从全题库开始，或专练需要巩固的题目</p></div><div class="mode-grid">
        <button class="mode-tile" data-action="start" data-mode="all"><strong>全题库顺序刷题</strong><span>按题库顺序练习全部 ${state.questions.length} 道</span></button>
        <button class="mode-tile" data-action="start" data-mode="random"><strong>全题库随机刷题</strong><span>打乱全部 ${state.questions.length} 道题</span></button>
        <button class="mode-tile" data-action="start" data-mode="unmastered"><strong>未掌握题</strong><span>集中练习未熟练的题</span></button>
        <button class="mode-tile" data-action="start" data-mode="favorite"><strong>收藏练习</strong><span>回顾标记的重点题</span></button>
      </div></section>
      <section class="card pass-card"><div><h2>重复刷完整题库</h2><p class="notice">已刷完 <strong>${pass.completed}</strong> 遍 · 第 ${pass.completed + 1} 遍已做 ${pass.done} / ${state.questions.length} 道</p><div class="progress-track"><div class="progress-fill" style="width:${state.questions.length ? Math.round(pass.done / state.questions.length * 100) : 0}%"></div></div></div>${btn('start', `继续第 ${pass.completed + 1} 遍`, '', 'data-mode="pass"')}</section>
      <div class="metric-grid"><div class="card metric"><b>${state.questions.length}</b><span>题库总题</span></div><div class="card metric"><b>${stats.masteredCount}</b><span>已掌握</span></div><div class="card metric"><b>${accuracy}%</b><span>累计正确率</span></div><div class="card metric"><b>${streak} 天</b><span>连续学习</span></div></div>`;
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
      const mark = a.submitted && status === 'right' ? '<span class="option-mark right-mark">✓ 正确答案</span>' : a.submitted && status === 'wrong' ? '<span class="option-mark wrong-mark">✕ 误选</span>' : '';
      return `<button class="option ${status}" data-action="choose" data-key="${esc(option.key)}" ${a.submitted ? 'disabled' : ''}><span class="option-key">${esc(option.key)}</span><span class="option-text">${esc(option.text)}</span>${mark}</button>`;
    }).join('');
    return `<div class="page-head"><div><h1>${esc(s.mode === 'chapter' ? '章节练习' : s.title)}</h1><p class="sub">${s.mode === 'chapter' ? `${esc(s.arg)} · ` : ''}${s.cursor + 1} / ${s.ids.length} 题</p></div>${btn('end','结束本轮','neutral')}</div>
      <div class="quiz-meta"><span class="strong">第 ${s.cursor + 1} 题</span><span>${percent}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
      <section class="card question-card"><div class="tag-row"><span class="tag">${typeLabel(q.type)}</span><span class="tag gray">${esc(q.chapter)}</span><button class="favorite" data-action="favorite" aria-label="${record && record.isFavorite ? '取消收藏' : '收藏题目'}">${record && record.isFavorite ? '★ 已收藏' : '☆ 收藏'}</button></div>
        <div class="stem">${esc(q.question)}</div><div class="question-hint">${q.type === 'multiple' ? '可选择多个答案' : '请选择一个答案'}</div>${options}
        ${a.submitted ? `<div class="feedback ${a.correct ? 'good' : 'bad'}"><strong>${a.correct ? '✓ 回答正确' : '✕ 回答错误'}</strong><div class="answer-comparison">${a.correct ? '' : `<span class="answer-incorrect">你的答案：${esc(a.selected.join('、'))}</span>`}<span class="answer-correct">正确答案：${esc(q.answer.join('、'))}</span></div><span class="explanation">${esc(q.explanation || '本题暂无解析。')}</span></div>` : ''}
      </section><div class="quiz-actions">${btn('previous','上一题','neutral',s.cursor === 0 ? 'disabled' : '')}${a.submitted ? btn('next',s.cursor === s.ids.length - 1 ? '查看结果' : '下一题','') : btn('submit','提交答案','',a.selected.length ? '' : 'disabled')}</div>`;
  }
  function renderResult() {
    const result = state.result;
    if (!result) return `<div class="card empty">还没有本轮结果。</div>`;
    const accuracy = result.total ? Math.round(result.correct / result.total * 100) : 0;
    const wrong = result.wrongIds.map(id => state.questions.find(q => q.id === id)).filter(Boolean);
    return `<div class="page-head"><h1>本轮结果</h1></div><section class="card result-summary"><div class="result-score">${accuracy}%</div><p>共答 ${result.total} 题 · 答对 ${result.correct} 题</p></section>
      <section class="card"><h2>本轮答错 ${wrong.length} 题</h2>${wrong.length ? wrong.map(q => `<div class="list-item"><div class="list-meta">${esc(q.chapter)}</div><div class="list-title">${esc(q.question)}</div><div class="list-answer">正确答案：${esc(q.answer.join('、'))}</div></div>`).join('') : '<p class="notice">全部答对。</p>'}</section>
      <div class="btn-row">${btn('again',result.mode === 'pass' || result.mode === 'daily' ? `继续第 ${passPlan().completed + 1} 遍` : result.mode === 'chapter' ? '再刷本章一遍' : '再刷一遍','')}${btn('nav','查看错题','soft','data-view="wrong"')}${btn('nav','返回首页','neutral','data-view="home"')}</div>`;
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
      <section class="card"><h2>全题库已刷完 ${passPlan().completed} 遍</h2><p class="notice">每道题至少作答一次算完成一遍。当前这遍已做 ${passPlan().done} / ${state.questions.length} 道，答错重做同一题只计一次。</p></section>
      <section class="card"><h2>各章节正确率</h2>${Object.values(map).map(ch => { const pct = ch.done ? Math.round(ch.correct / ch.done * 100) : 0; return `<div class="stat-row"><div class="row"><span>${esc(ch.name)}</span><span>${pct}% · ${ch.done} 题</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`; }).join('')}</section>`;
  }
  function renderManage() {
    return `<div class="page-head"><div><h1>题库与设置</h1><p class="sub">当前 ${state.questions.length} 道题。学习记录只保存在这个浏览器中。</p></div></div>
      <section class="card"><h2>学习设置</h2>
        <label class="settings-row"><span>每日新题数<small>今日计划中的新题上限</small></span><input class="field" type="number" min="0" max="500" id="daily-new" value="${state.settings.dailyNewLimit}"></label>
        <label class="settings-row"><span>每日复习上限<small>错题仍会优先出现</small></span><input class="field" type="number" min="0" max="500" id="daily-review" value="${state.settings.dailyReviewLimit}"></label>
        <label class="settings-row"><span>乱序选项<small>答案字母仍对应原选项</small></span><input class="switch" type="checkbox" id="shuffle-options" ${state.settings.shuffleOptions ? 'checked' : ''}></label>
        <label class="settings-row"><span>答错本轮重做<small>错题在本轮末尾再出现一次</small></span><input class="switch" type="checkbox" id="wrong-redo" ${state.settings.wrongRedo ? 'checked' : ''}></label>
        <div class="btn-row" style="margin-top:14px">${btn('saveSettings','保存学习设置','')}</div>
      </section>
      <section class="card"><h2>学习数据备份</h2><p class="notice">同一手机的同一浏览器会自动保存学习进度和未完成的练习。更换浏览器、清理浏览数据或换手机前，请先备份；在新设备上导入即可恢复。</p><div class="btn-row" style="margin-top:16px">${btn('exportBackup','导出备份文件','')}<label class="btn soft" for="backup-file">导入备份文件</label><input class="visually-hidden" type="file" id="backup-file" accept=".json,application/json"></div><details class="backup-details"><summary>手机无法下载文件？使用文本备份</summary><p class="notice">生成后复制下面的内容保存到备忘录；恢复时粘贴回来。</p><div class="btn-row" style="margin-top:12px">${btn('copyBackup','生成并复制备份文本','soft')}${btn('importBackupText','从文本恢复','outline')}</div><textarea class="textarea backup-textarea" id="backup-text" aria-label="学习备份内容" placeholder="在此生成或粘贴学习备份内容"></textarea><p class="notice" id="backup-status" role="status"></p></details></section>
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
  function makeBackup() {
    return {
      format: 'exam-memory-backup', version: 1, exportedAt: new Date().toISOString(),
      customQuestions: read(KEYS.custom, null), records: state.records,
      stats: state.stats, settings: state.settings, attempts: state.attempts,
      session: state.session, savedSessions: state.savedSessions, passProgress: state.passProgress
    };
  }
  function exportBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(makeBackup())], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `考试题学习备份-${today()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function importBackup(data) {
    if (!data || data.format !== 'exam-memory-backup' || data.version !== 1 ||
        !data.records || typeof data.records !== 'object' || Array.isArray(data.records) ||
        !data.stats || typeof data.stats !== 'object' || !Array.isArray(data.attempts)) throw new Error('备份文件格式不正确。');
    const custom = data.customQuestions == null ? null : validateImport(data.customQuestions);
    const questions = custom || BUILTIN;
    const questionMap = new Map(questions.map(q => [q.id, q]));
    const records = {};
    Object.entries(data.records).forEach(([id, raw]) => {
      if (!questionMap.has(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const record = Object.assign(newRecord(id), raw, { questionId: id });
      if (typeof record.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate) ||
          !['new', 'learning', 'review', 'mastered'].includes(record.mastery) ||
          ['ease', 'interval', 'reps', 'lapses', 'correctCount', 'wrongCount', 'correctStreak'].some(key => !Number.isFinite(record[key]) || record[key] < 0)) return;
      records[id] = record;
    });
    const attempts = data.attempts.filter(a => a && questionMap.has(a.questionId) && typeof a.date === 'string' && typeof a.correct === 'boolean')
      .map(a => ({ questionId: a.questionId, chapter: questionMap.get(a.questionId).chapter, correct: a.correct, date: a.date }));
    const stats = Object.assign({}, DEFAULT_STATS, data.stats);
    if (!Number.isFinite(stats.totalDone) || !Number.isFinite(stats.totalCorrect) || !Number.isFinite(stats.streak) || typeof stats.lastStudyDate !== 'string') throw new Error('备份中的统计数据不正确。');
    stats.masteredCount = Object.values(records).filter(r => r.mastery === 'mastered').length;
    const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    if (!Number.isInteger(settings.dailyNewLimit) || settings.dailyNewLimit < 0 || settings.dailyNewLimit > 500 ||
        !Number.isInteger(settings.dailyReviewLimit) || settings.dailyReviewLimit < 0 || settings.dailyReviewLimit > 500) throw new Error('备份中的学习设置不正确。');
    const session = validSession(data.session, questions) ? data.session : null;
    const savedSessions = Array.isArray(data.savedSessions)
      ? data.savedSessions.filter(item => validSession(item, questions)) : [];
    const passProgress = validPassProgress(data.passProgress, questions) ? data.passProgress : initialPassProgress(questions, records);
    if (!window.confirm('导入备份会替换本机当前题库和全部学习进度，确定继续？')) return false;
    state.questions = questions;
    state.records = records;
    state.stats = stats;
    state.settings = settings;
    state.attempts = attempts;
    state.session = session;
    state.savedSessions = savedSessions;
    state.passProgress = passProgress;
    state.result = null;
    if (custom) write(KEYS.custom, custom); else localStorage.removeItem(KEYS.custom);
    write(KEYS.records, records);
    write(KEYS.stats, stats);
    write(KEYS.settings, settings);
    write(KEYS.attempts, attempts);
    write(KEYS.passProgress, passProgress);
    saveSession();
    write(KEYS.savedSessions, savedSessions);
    return true;
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'nav') { state.view = target.dataset.view; render(); return; }
    if (action === 'resume') { state.view = 'practice'; render(); return; }
    if (action === 'resumeSaved') {
      const index = Number(target.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.savedSessions.length) return;
      const saved = state.savedSessions.slice();
      const next = saved.splice(index, 1)[0];
      if (state.session) saved.unshift(state.session);
      if (!switchSession(next, saved)) render();
      return;
    }
    if (action === 'removeSaved') {
      const index = Number(target.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.savedSessions.length ||
          !window.confirm('删除这个未完成的练习断点？已提交的答题记录会保留。')) return;
      const saved = state.savedSessions.filter((_, i) => i !== index);
      if (write(KEYS.savedSessions, saved)) state.savedSessions = saved;
      render();
      return;
    }
    if (action === 'start') { startMode(target.dataset.mode || 'all'); return; }
    if (action === 'chapterAll') { startMode('chapter', target.dataset.chapter); return; }
    if (action === 'exportBackup') { exportBackup(); return; }
    if (action === 'copyBackup') {
      const field = document.getElementById('backup-text');
      const status = document.getElementById('backup-status');
      field.value = JSON.stringify(makeBackup());
      field.focus();
      field.select();
      status.textContent = '备份内容已生成。请复制并保存这段文本。';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(field.value).then(() => { status.textContent = '备份内容已复制到剪贴板，请粘贴到备忘录保存。'; })
          .catch(() => { status.textContent = '自动复制未成功，请长按文本框全选复制。'; });
      }
      return;
    }
    if (action === 'importBackupText') {
      try {
        const restored = importBackup(JSON.parse(document.getElementById('backup-text').value));
        if (restored) { state.flash = '学习进度已从备份恢复。'; state.view = 'home'; render(); }
      } catch (error) { document.getElementById('backup-status').textContent = error instanceof SyntaxError ? '备份文本不是有效的 JSON。' : error.message; }
      return;
    }
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
      saveSession();
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
      saveSession();
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
    if (action === 'previous') { if (state.session && state.session.cursor > 0) { state.session.cursor--; saveSession(); render(); } return; }
    if (action === 'next') {
      const s = state.session;
      if (!s || !currentAnswer().submitted) return;
      if (s.cursor < s.ids.length - 1) { s.cursor++; saveSession(); render(); }
      else finishSession();
      return;
    }
    if (action === 'end') { if (state.session && window.confirm('结束本轮并查看已完成的结果？')) finishSession(); return; }
    if (action === 'again') { const r = state.result; if (r) startMode(r.mode === 'daily' ? 'pass' : r.mode, r.arg); return; }
    if (action === 'saveSettings') {
      const dailyNewLimit = Number(document.getElementById('daily-new').value);
      const dailyReviewLimit = Number(document.getElementById('daily-review').value);
      if (![dailyNewLimit, dailyReviewLimit].every(n => Number.isInteger(n) && n >= 0 && n <= 500)) {
        state.flash = '请输入 0 到 500 的整数。'; render(); return;
      }
      state.settings.dailyNewLimit = dailyNewLimit;
      state.settings.dailyReviewLimit = dailyReviewLimit;
      state.settings.shuffleOptions = document.getElementById('shuffle-options').checked;
      state.settings.wrongRedo = document.getElementById('wrong-redo').checked;
      write(KEYS.settings, state.settings);
      state.flash = '学习设置已保存。';
      render(); return;
    }
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
    saveSession();
    state.view = 'result';
    render();
  }
  document.addEventListener('change', async event => {
    const id = event.target.id;
    if (id === 'backup-file') {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const restored = importBackup(JSON.parse(await file.text()));
        if (restored) { state.flash = '学习进度已从备份恢复。'; state.view = 'home'; render(); }
      } catch (error) { state.flash = error instanceof SyntaxError ? '备份文件不是有效的 JSON。' : error.message; render(); }
      return;
    }
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
