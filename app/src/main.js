import './style.css'
import { registerSW } from 'virtual:pwa-register'

// keep the app fresh; autoUpdate handles reload
registerSW({ immediate: true })

const BASE = import.meta.env.BASE_URL
const asset = (p) => `${BASE}${p}`.replace(/([^:])\/\//g, '$1/')

const PASS_MARK = 17         // 17 of 33 to pass the real Einbürgerungstest
const EXAM_GENERAL = 30
const EXAM_NDS = 3
const EXAM_MINUTES = 60

// ---------- storage ----------
const LS = {
  ru: 'eb_ru',
  mistakes: 'eb_mistakes',
  seen: 'eb_seen',
  trainPos: 'eb_train_pos'   // last opened training question: { filter, idx }
}
const getBool = (k, d) => { const v = localStorage.getItem(k); return v === null ? d : v === '1' }
const setBool = (k, v) => localStorage.setItem(k, v ? '1' : '0')
const getArr = (k) => { try { return JSON.parse(localStorage.getItem(k)) || [] } catch { return [] } }
const setArr = (k, a) => localStorage.setItem(k, JSON.stringify(a))

const state = {
  ru: getBool(LS.ru, false),
  questions: [],
  byId: new Map()
}
function mistakes() { return getArr(LS.mistakes) }
function addMistake(id) { const m = new Set(mistakes()); m.add(id); setArr(LS.mistakes, [...m].sort((a, b) => a - b)) }
function removeMistake(id) { setArr(LS.mistakes, mistakes().filter(x => x !== id)) }
function clearMistakes() { setArr(LS.mistakes, []) }
function markSeen(id) { const s = new Set(getArr(LS.seen)); s.add(id); setArr(LS.seen, [...s]) }
function seenCount() { return getArr(LS.seen).length }

// ---------- training resume position ----------
const TRAIN_FILTERS = ['all', 'general', 'niedersachsen']
function getTrainPos() {
  try {
    const p = JSON.parse(localStorage.getItem(LS.trainPos))
    if (!p || !TRAIN_FILTERS.includes(p.filter) || typeof p.idx !== 'number' || p.idx < 0) return null
    return p
  } catch { return null }
}
function setTrainPos(filter, idx) { localStorage.setItem(LS.trainPos, JSON.stringify({ filter, idx })) }
function clearTrainPos() { localStorage.removeItem(LS.trainPos) }

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue
    if (k === 'class') e.className = v
    else if (k === 'html') e.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v)
    else if (k === 'disabled') { if (v) e.setAttribute('disabled', '') }
    else e.setAttribute(k, v)
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return e
}

// ---------- timer bookkeeping ----------
let activeTimer = null
function clearActiveTimer() { if (activeTimer) { clearInterval(activeTimer); activeTimer = null } }

// ---------- shuffle ----------
function sample(arr, n) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return a.slice(0, n)
}

// ---------- layout ----------
const appEl = document.getElementById('app')

function topbar(title, onBack) {
  const ruBtn = h('div', {
    class: 'ru-toggle' + (state.ru ? ' on' : ''),
    role: 'switch',
    onclick: () => { state.ru = !state.ru; setBool(LS.ru, state.ru); rerender() }
  }, h('span', {}, 'RU'), h('span', { class: 'dot' }))

  const left = h('div', { class: 'left' })
  if (onBack) left.append(h('button', { class: 'iconbtn', onclick: onBack }, '‹ Меню'))
  left.append(h('h1', {}, title))

  return h('div', { class: 'topbar' }, left, ruBtn)
}

let rerender = () => {}
function mount(topbarEl, mainEl) {
  appEl.replaceChildren(topbarEl, mainEl)
}

// ================= MENU =================
function viewMenu() {
  clearActiveTimer()
  rerender = viewMenu
  const main = h('main', {})

  main.append(
    h('div', { class: 'hero' },
      h('div', { class: 'flag' },
        h('i', { style: 'background:#000' }), h('i', { style: 'background:#DD0000' }), h('i', { style: 'background:#FFCE00' })),
      h('h2', {}, 'Einbürgerungstest'),
      h('p', {}, 'Тренажёр · Niedersachsen · 310 вопросов')
    )
  )

  const menu = h('div', { class: 'menu' })
  menu.append(
    card('📚', 'Тренировка', 'Все 310 вопросов подряд, ответ сразу', () => viewTrainingEntry()),
    card('📝', 'Экзамен (билет)', '33 вопроса · 60 минут · как на экзамене', () => viewExamStart()),
    card('🔁', `Работа над ошибками${mistakes().length ? ' · ' + mistakes().length : ''}`, 'Повторить вопросы с ошибками', () => viewErrors(), mistakes().length === 0)
  )
  main.append(menu)

  main.append(
    h('div', { class: 'stats' },
      stat(seenCount(), 'пройдено', false),
      stat(mistakes().length, 'в ошибках', true)
    )
  )

  main.append(h('div', { class: 'footnote' }, 'Данные: официальный каталог BAMF. Работает офлайн.'))

  mount(topbar('Einbürgerungstest Trainer', null), main)
}
function card(emoji, title, sub, onclick, disabled = false) {
  return h('button', { class: 'card' + (disabled ? ' secondary' : ''), onclick: disabled ? null : onclick, disabled },
    h('span', { class: 'emoji' }, emoji),
    h('span', { class: 'body' }, h('div', { class: 'title' }, title), h('div', { class: 'sub' }, sub)),
    h('span', { class: 'chev' }, '›'))
}
function stat(n, label, warn) {
  return h('div', { class: 'stat' + (warn ? ' warn' : '') }, h('div', { class: 'n' }, String(n)), h('div', { class: 'l' }, label))
}

// ================= QUESTION CARD =================
// opts: { revealed:bool, selected:idx|null, onSelect:fn, disabled:bool }
function questionCard(q, o = {}) {
  const wrap = h('div', {})
  wrap.append(h('span', { class: 'q-scope' }, q.scope === 'niedersachsen' ? 'Niedersachsen' : 'Allgemein'))
  wrap.append(h('div', { class: 'q-de' }, q.de.question))
  if (state.ru) wrap.append(h('div', { class: 'q-ru' }, q.ru.question))

  const isImgOptions = q.image && q.image.kind === 'options'
  const isImgQuestion = q.image && q.image.kind === 'question'

  if (isImgQuestion) {
    wrap.append(h('img', { class: 'q-image-single', src: asset(q.image.file), alt: 'Bild', loading: 'lazy' }))
  }

  if (isImgOptions) {
    const grid = h('div', { class: 'opt-images' })
    q.image.files.forEach((file, i) => {
      const cls = ['opt-img']
      if (o.revealed) {
        if (i === q.correct) cls.push('correct')
        else if (i === o.selected) cls.push('wrong')
      } else if (i === o.selected) cls.push('selected')
      const tile = h('button', {
        class: cls.join(' '), disabled: o.disabled,
        onclick: o.disabled ? null : () => o.onSelect(i)
      },
        h('img', { src: asset(file), alt: q.de.options[i], loading: 'lazy' }),
        h('span', { class: 'cap' }, state.ru ? `${q.de.options[i]} · ${q.ru.options[i]}` : q.de.options[i]))
      grid.append(tile)
    })
    wrap.append(grid)
  } else {
    const list = h('div', { class: 'options' })
    q.de.options.forEach((opt, i) => {
      const cls = ['opt']
      if (o.revealed) {
        if (i === q.correct) cls.push('correct')
        else if (i === o.selected) cls.push('wrong')
      } else if (i === o.selected) cls.push('selected')
      const mark = h('span', { class: 'mark' }, String.fromCharCode(65 + i))
      const txt = h('span', { class: 'txt' }, h('span', { class: 'de' }, opt))
      if (state.ru) txt.append(h('span', { class: 'ru' }, q.ru.options[i]))
      list.append(h('button', {
        class: cls.join(' '), disabled: o.disabled,
        onclick: o.disabled ? null : () => o.onSelect(i)
      }, mark, txt))
    })
    wrap.append(list)
  }
  return wrap
}

// ================= TRAINING =================
// Entry from the menu: offer "continue" if a saved position exists, else start at #1.
function viewTrainingEntry() {
  clearActiveTimer()
  const pos = getTrainPos()
  if (pos && pos.idx > 0) { viewTrainingResume(pos); return }
  viewTraining(pos ? pos.filter : 'all', pos ? pos.idx : 0)
}

const FILTER_LABEL = { all: 'Все', general: 'Общие', niedersachsen: 'Земля' }

function viewTrainingResume(pos) {
  clearActiveTimer()
  rerender = () => viewTrainingResume(pos)
  const main = h('main', {})

  main.append(h('div', { class: 'hero' },
    h('h2', {}, 'Продолжить тренировку?'),
    h('p', {}, `Вы остановились на вопросе №${pos.idx + 1} · фильтр «${FILTER_LABEL[pos.filter]}»`)))

  const menu = h('div', { class: 'menu' })
  menu.append(
    card('▶️', `Продолжить с вопроса №${pos.idx + 1}`, `Фильтр: ${FILTER_LABEL[pos.filter]}`,
      () => viewTraining(pos.filter, pos.idx)),
    card('🔄', 'Начать сначала', 'С первого вопроса (сбросит сохранённую позицию)',
      () => { clearTrainPos(); viewTraining('all', 0) })
  )
  main.append(menu)

  mount(topbar('Тренировка', viewMenu), main)
  window.scrollTo(0, 0)
}

function viewTraining(filter, idx = 0, answers = new Map()) {
  clearActiveTimer()
  const pool = state.questions.filter(q =>
    filter === 'all' ? true : filter === 'general' ? q.scope === 'general' : q.scope === 'niedersachsen')
  if (idx < 0) idx = 0
  if (idx >= pool.length) idx = pool.length - 1
  setTrainPos(filter, idx)   // remember last opened question (per filter) for "continue"
  rerender = () => viewTraining(filter, idx, answers)

  const q = pool[idx]
  const main = h('main', {})

  // filter segmented control
  const seg = h('div', { class: 'seg' },
    segBtn('Все', filter === 'all', () => viewTraining('all', 0, new Map())),
    segBtn('Общие', filter === 'general', () => viewTraining('general', 0, new Map())),
    segBtn('Земля', filter === 'niedersachsen', () => viewTraining('niedersachsen', 0, new Map())))
  main.append(seg, h('div', { class: 'spacer' }))

  // progress
  main.append(h('div', { class: 'subbar' },
    h('span', { class: 'count' }, `Вопрос ${idx + 1} из ${pool.length}`),
    h('div', { class: 'progress' }, h('i', { style: `width:${((idx + 1) / pool.length) * 100}%` }))))

  const answered = answers.has(q.id)
  const selected = answered ? answers.get(q.id) : null

  const card = questionCard(q, {
    revealed: answered, selected, disabled: answered,
    onSelect: (i) => {
      answers.set(q.id, i)
      markSeen(q.id)
      if (i !== q.correct) addMistake(q.id); else removeMistake(q.id)
      viewTraining(filter, idx, answers)
    }
  })
  main.append(card)

  if (answered) {
    const ok = selected === q.correct
    main.append(h('div', { class: 'feedback ' + (ok ? 'ok' : 'no') },
      ok ? '✓ Правильно' : `✗ Неправильно — верный ответ: ${String.fromCharCode(65 + q.correct)}`))
  }

  main.append(h('div', { class: 'navbar' },
    h('button', { class: 'btn', disabled: idx === 0, onclick: () => viewTraining(filter, idx - 1, answers) }, '‹ Назад'),
    h('button', { class: 'btn primary', disabled: idx >= pool.length - 1, onclick: () => viewTraining(filter, idx + 1, answers) }, 'Дальше ›')))

  mount(topbar('Тренировка', viewMenu), main)
  window.scrollTo(0, 0)
}
function segBtn(label, active, onclick) { return h('button', { class: active ? 'active' : '', onclick }, label) }

// ================= EXAM =================
function buildTicket() {
  const gen = state.questions.filter(q => q.scope === 'general')
  const nds = state.questions.filter(q => q.scope === 'niedersachsen')
  return [...sample(gen, EXAM_GENERAL), ...sample(nds, EXAM_NDS)]
}

function viewExamStart() {
  const ticket = buildTicket()
  const deadline = Date.now() + EXAM_MINUTES * 60 * 1000
  viewExam({ ticket, answers: new Map(), idx: 0, deadline })
}

function viewExam(ex) {
  clearActiveTimer()
  rerender = () => viewExam(ex)
  const { ticket, answers, deadline } = ex
  let { idx } = ex
  const q = ticket[idx]
  const main = h('main', {})

  const timerEl = h('div', { class: 'timer' }, '')
  main.append(h('div', { class: 'subbar' },
    h('span', { class: 'count' }, `${idx + 1} / ${ticket.length}`),
    h('div', { class: 'progress' }, h('i', { style: `width:${((idx + 1) / ticket.length) * 100}%` })),
    timerEl))

  const selected = answers.has(q.id) ? answers.get(q.id) : null
  main.append(questionCard(q, {
    revealed: false, selected, disabled: false,
    onSelect: (i) => { answers.set(q.id, i); ex.idx = idx; viewExam(ex) }
  }))

  const answeredCount = ticket.filter(t => answers.has(t.id)).length
  main.append(h('div', { class: 'navbar' },
    h('button', { class: 'btn', disabled: idx === 0, onclick: () => { ex.idx = idx - 1; viewExam(ex) } }, '‹'),
    h('button', { class: 'btn', disabled: idx >= ticket.length - 1, onclick: () => { ex.idx = idx + 1; viewExam(ex) } }, '›'),
    h('button', { class: 'btn primary grow2', onclick: () => finishExam(ex) },
      `Проверить (${answeredCount}/${ticket.length})`)))

  main.append(h('div', { class: 'footnote' }, 'Ответы можно менять. Верно/неверно покажем после проверки.'))

  mount(topbar('Экзамен', () => { if (confirm('Выйти из билета? Прогресс билета не сохранится.')) viewMenu() }), main)
  window.scrollTo(0, 0)

  // timer
  const tick = () => {
    const left = Math.max(0, deadline - Date.now())
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000)
    timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    timerEl.classList.toggle('warn', left <= 5 * 60000)
    if (left <= 0) { clearActiveTimer(); finishExam(ex, true) }
  }
  tick()
  activeTimer = setInterval(tick, 1000)
}

function finishExam(ex, byTimeout = false) {
  clearActiveTimer()
  const { ticket, answers } = ex
  let correct = 0
  ticket.forEach(q => {
    const a = answers.has(q.id) ? answers.get(q.id) : null
    markSeen(q.id)
    if (a === q.correct) { correct++; removeMistake(q.id) }
    else addMistake(q.id)
  })
  viewExamResult(ticket, answers, correct, byTimeout)
}

// one review row: label + DE option (main) + RU option (muted) — same index mapping as training
function reviewLine(label, cls, idx, q) {
  const line = h('div', { class: 'review-line ' + cls })
  line.append(h('span', { class: 'lbl' }, label))
  if (idx == null) { line.append('— (без ответа)'); return line }
  const letter = String.fromCharCode(65 + idx)
  line.append(h('span', { class: 'rl-de' }, `${letter}) ${q.de.options[idx]}`))
  if (state.ru) line.append(h('span', { class: 'rl-ru' }, q.ru.options[idx]))
  return line
}

function viewExamResult(ticket, answers, correct, byTimeout) {
  clearActiveTimer()
  rerender = () => viewExamResult(ticket, answers, correct, byTimeout)
  const pass = correct >= PASS_MARK
  const main = h('main', {})

  main.append(h('div', { class: 'result-hero ' + (pass ? 'pass' : 'fail') },
    h('div', { class: 'big' }, `${correct} / ${ticket.length}`),
    h('div', { class: 'verdict' }, pass ? 'ПРОЙДЕНО ✓' : 'НЕ ПРОЙДЕНО ✗'),
    h('div', { class: 'small' }, (byTimeout ? 'Время вышло. ' : '') + `Порог сдачи: ${PASS_MARK} из ${ticket.length}`)))

  main.append(h('div', { class: 'navbar' },
    h('button', { class: 'btn primary', onclick: viewExamStart }, 'Новый билет'),
    h('button', { class: 'btn', onclick: viewMenu }, 'В меню')))

  main.append(h('div', { class: 'spacer' }))
  main.append(h('div', { class: 'q-scope' }, 'Разбор билета'))

  ticket.forEach((q, n) => {
    const a = answers.has(q.id) ? answers.get(q.id) : null
    const ok = a === q.correct
    const item = h('div', { class: 'review-item' })
    item.append(h('div', { class: 'rq' }, `${n + 1}. ${q.de.question}`))
    if (state.ru) item.append(h('div', { class: 'q-ru' }, q.ru.question))
    item.append(reviewLine(ok ? '✓ Ваш ответ: ' : '✗ Ваш ответ: ', ok ? 'ok' : 'no', a, q))
    if (!ok) item.append(reviewLine('✓ Верно: ', 'ok', q.correct, q))
    main.append(item)
  })

  mount(topbar('Результат', viewMenu), main)
  window.scrollTo(0, 0)
}

// ================= ERRORS =================
function viewErrors(idx = 0, answers = new Map()) {
  clearActiveTimer()
  const pool = mistakes().map(id => state.byId.get(id)).filter(Boolean)
  rerender = () => viewErrors(idx, answers)

  const main = h('main', {})
  if (pool.length === 0) {
    main.append(h('div', { class: 'empty' }, h('div', { style: 'font-size:40px' }, '🎉'),
      h('div', {}, 'Список ошибок пуст.'), h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: viewMenu }, 'В меню')))
    mount(topbar('Работа над ошибками', viewMenu), main)
    return
  }
  if (idx >= pool.length) idx = pool.length - 1
  const q = pool[idx]

  main.append(h('div', { class: 'subbar' },
    h('span', { class: 'count' }, `Ошибка ${idx + 1} из ${pool.length}`),
    h('div', { class: 'progress' }, h('i', { style: `width:${((idx + 1) / pool.length) * 100}%` }))))

  const answered = answers.has(q.id)
  const selected = answered ? answers.get(q.id) : null
  main.append(questionCard(q, {
    revealed: answered, selected, disabled: answered,
    onSelect: (i) => {
      answers.set(q.id, i); markSeen(q.id)
      if (i === q.correct) removeMistake(q.id)
      viewErrors(idx, answers)
    }
  }))

  if (answered) {
    const ok = selected === q.correct
    main.append(h('div', { class: 'feedback ' + (ok ? 'ok' : 'no') },
      ok ? '✓ Правильно — вопрос убран из ошибок' : `✗ Неправильно — верный: ${String.fromCharCode(65 + q.correct)}`))
  }

  main.append(h('div', { class: 'navbar' },
    h('button', { class: 'btn', disabled: idx === 0, onclick: () => viewErrors(idx - 1, answers) }, '‹ Назад'),
    h('button', { class: 'btn primary', disabled: idx >= pool.length - 1, onclick: () => viewErrors(idx + 1, answers) }, 'Дальше ›')))

  main.append(h('div', { class: 'spacer' }))
  main.append(h('button', { class: 'btn danger', onclick: () => { if (confirm('Очистить весь список ошибок?')) { clearMistakes(); viewMenu() } } }, 'Очистить список ошибок'))

  mount(topbar('Работа над ошибками', viewMenu), main)
  window.scrollTo(0, 0)
}

// ================= BOOT =================
async function boot() {
  appEl.append(h('main', {}, h('div', { class: 'empty' }, 'Загрузка вопросов…')))
  try {
    const res = await fetch(asset('questions.json'))
    state.questions = await res.json()
    state.byId = new Map(state.questions.map(q => [q.id, q]))
    viewMenu()
  } catch (e) {
    appEl.replaceChildren(h('main', {}, h('div', { class: 'empty' }, 'Ошибка загрузки данных: ' + e.message)))
  }
}
boot()
