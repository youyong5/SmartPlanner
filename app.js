import { runPlan } from './src/planner.js';
import { shortDateTime, parseShortDateTime } from './src/date-display.js';

// Display-only labels stay outside the versioned planning document and core API.
const SCENARIOS = {
  student: {
    file: './data/student-plan.v1.json',
    title: '学期安排',
    events: {
      'morning-lecture': { name: '数据结构课程', kind: '课程', place: '教学楼 302' },
      'afternoon-lecture': { name: '科研组会', kind: '会议', place: '科研楼 401' },
      'biology-exam': { name: '实训项目阶段评审', kind: '评审', place: '实训室 205' },
    },
    tasks: {
      'topic-announced': '实训需求确认',
      'calculus-homework': '数据结构实验',
      'biology-review': '实训项目开发',
      'exam-setup': '阶段演示准备',
    },
  },
  project: {
    file: './data/project-plan.v1.json',
    title: '项目交付',
    events: {
      'vendor-call': { name: '供应商沟通', kind: '会议', place: '线上会议室' },
    },
    tasks: {
      design: '交付方案设计',
      approval: '审批完成',
      release: '最终发布',
    },
  },
  custom: { title: '我的计划', events: {}, tasks: {} },
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

let scenarioKey = 'student';
let plan = null;
let displayEvents = {};
let displayTasks = {};
let temporaryEventNumber = 0;
let currentResult = null;
let lastValidResult = null;
let lastValidPlan = null;

function dateForMinute(minute) {
  const date = new Date(minute * 60_000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function localTime(minute, includeDate = true) {
  const date = dateForMinute(minute);
  if (!date) return `UTC 分钟 ${minute}`;
  const options = includeDate
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', hour12: false };
  return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

function localRange(start, end) {
  const first = dateForMinute(start);
  const last = dateForMinute(end);
  const sameDay = first && last && first.toDateString() === last.toDateString();
  return `${localTime(start)} — ${localTime(end, !sameDay)}`;
}

function setDateInput(input, minute) {
  input.value = shortDateTime(minute);
  input.dataset.anchorMinute = String(minute);
  input.setCustomValidity('');
}

function readDateInput(input) {
  const minute = parseShortDateTime(input.value, Number(input.dataset.anchorMinute));
  input.setCustomValidity(minute === null ? '请按“月/日 时:分”输入，例如 10/21 17:00' : '');
  if (minute === null) input.reportValidity();
  return minute;
}

document.addEventListener('input', (event) => {
  if (event.target.matches('.short-date-input')) event.target.setCustomValidity('');
});

function taskName(id) {
  return displayTasks[id] ?? id;
}

function eventDisplay(event) {
  return displayEvents[event.id] ?? { name: event.id, kind: '固定事件', place: '' };
}

function renderEvents() {
  $('#event-count').textContent = String(plan.fixed_events.length);
  $('#event-list').innerHTML = plan.fixed_events.map((event) => {
    const info = eventDisplay(event);
    return `<div class="event-mini"><div class="event-mini-body"><strong>${escapeHtml(info.name)}</strong><small>${escapeHtml(localRange(event.start, event.end))}${info.place ? ` · ${escapeHtml(info.place)}` : ''}</small></div><button class="remove-event" type="button" data-event-id="${escapeHtml(event.id)}" aria-label="移除 ${escapeHtml(info.name)}">×</button></div>`;
  }).join('');
}

function renderAvailability() {
  $('#availability-count').textContent = String(plan.availability.length);
  $('#availability-list').innerHTML = plan.availability.map((w, i) => `<div class="event-mini"><div class="event-mini-body"><strong>${escapeHtml(localRange(w.start, w.end))}</strong></div><button class="remove-event" type="button" data-availability-index="${i}" aria-label="移除可用时间 ${i + 1}">×</button></div>`).join('');
}

function renderTaskEditors() {
  $('#task-count').textContent = String(plan.tasks.length);
  const completedIds = new Set(plan.completed.map((record) => record.id));
  const confirmedIds = new Set(plan.confirmed_blocks.map((block) => block.task_id));
  $('#task-list').innerHTML = plan.tasks.map((task, index) => {
    const done = completedIds.has(task.id);
    const confirmed = confirmedIds.has(task.id);
    const confirmedMinutes = plan.confirmed_blocks.filter((b) => b.task_id === task.id).reduce((n, b) => n + b.end - b.start, 0);
    const status = done ? '已完成' : confirmedMinutes === task.duration_minutes ? '已确认' : confirmed ? '部分确认' : '待排程';
    const meta = task.minimum_block_minutes ? [`可拆分 · 最短 ${task.minimum_block_minutes} 分钟`] : [];
    if (task.earliest_start !== undefined) meta.push(`最早 ${localTime(task.earliest_start)}`);
    if (task.dependencies.length) meta.push(`前置：${task.dependencies.map(taskName).join('、')}`);
    return `<details class="task-editor"><summary class="task-editor-summary"><span class="task-editor-head"><strong>${escapeHtml(taskName(task.id))}</strong><span class="status-chip ${done ? 'done' : ''}">${status}</span></span><span class="task-preview">${task.duration_minutes} 分 · 截止 <span class="task-deadline-preview">${escapeHtml(shortDateTime(task.deadline))}</span></span></summary><div class="task-editor-body">${meta.length ? `<p class="task-meta">${escapeHtml(meta.join(' · '))}</p>` : ''}<div class="task-fields"><label>工时 / 分<input class="duration-input" data-task-index="${index}" type="number" min="1" step="1" value="${task.duration_minutes}" ${done ? 'disabled' : ''} /></label><label>截止时间<input class="deadline-input short-date-input" data-task-index="${index}" data-anchor-minute="${task.deadline}" type="text" inputmode="text" value="${escapeHtml(shortDateTime(task.deadline))}" placeholder="10/21 17:00" ${done ? 'disabled' : ''} /></label></div><div class="task-actions"><button type="button" data-action="${done ? 'reopen' : 'complete'}" data-task-id="${escapeHtml(task.id)}">${done ? '恢复待办' : '标记完成'}</button><button type="button" data-action="delete" data-task-id="${escapeHtml(task.id)}">删除任务</button></div></div></details>`;
  }).join('');
  $('#task-dependency').innerHTML = '<option value="">无</option>' + plan.tasks.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(taskName(t.id))}</option>`).join('');
}

function reasonText(reason) {
  switch (reason.code) {
    case 'NoContinuousSlot': return '现有空档中没有满足工时与截止时间的连续时间块。';
    case 'SplitWorkIncomplete': return `当前已占用时间下仍有 ${reason.remaining_minutes} 分钟无法安排；换一个任务顺序可能有解。`;
    case 'DependencyNotScheduled': return `前置任务 ${taskName(reason.dependency_id)} 未完整安排。`;
    default: return reason.code;
  }
}

function renderTimeline(result, shownPlan) {
  const entries = [
    ...shownPlan.fixed_events.map((event) => ({ ...event, type: 'event' })),
    ...result.blocks.map((block) => ({ ...block, type: 'task' })),
  ];
  entries.sort((a, b) => a.start - b.start || (a.type === 'event' ? -1 : 1));
  $('#timeline').innerHTML = entries.length ? entries.map((entry) => {
    const fixed = entry.type === 'event';
    const info = fixed ? eventDisplay(entry) : null;
    const kind = fixed ? info.kind : entry.confirmed ? '已确认' : '工作块';
    const style = fixed ? `event ${kind === '考试' ? 'exam' : ''}` : entry.confirmed ? 'confirmed' : '';
    const name = fixed ? info.name : taskName(entry.task_id);
    const detail = fixed ? escapeHtml(info.place) : '';
    return `<div class="timeline-item ${style}" data-item-id="${escapeHtml(fixed ? entry.id : entry.task_id)}"><div class="timeline-item-head"><strong>${escapeHtml(name)}</strong><span class="kind-pill">${escapeHtml(kind)}</span></div><div class="timeline-when">${escapeHtml(localRange(entry.start, entry.end))}</div>${detail || !fixed ? `<div class="timeline-detail">${detail}${!fixed ? `<button type="button" class="lock-block" data-task-id="${escapeHtml(entry.task_id)}" data-start="${entry.start}" data-end="${entry.end}" data-mode="${entry.confirmed ? 'unlock' : 'lock'}">${entry.confirmed ? '解除锁定' : '锁定此时段'}</button>` : ''}</div>` : ''}</div>`;
  }).join('') : '<div class="empty-state">此时间段尚无事件或工作块。</div>';
}

function renderResult() {
  const error = currentResult?.ok ? null : currentResult?.error;
  const banner = $('#validation-banner');
  banner.hidden = !error;
  if (error) {
    banner.innerHTML = `<strong>这份计划需要调整</strong><code>${escapeHtml(error.kind)}${error.path ? ` · ${escapeHtml(error.path)}` : ''}</code><br>${escapeHtml(error.message)}<br>${lastValidResult ? '下方保留上一次有效排程供对照。' : '修正输入后即可重新计算。'}`;
  }
  const shown = currentResult?.ok ? currentResult : lastValidResult;
  $('#metric-blocks').textContent = shown ? String(shown.blocks.length) : '—';
  $('#metric-confirmed').textContent = shown ? String(shown.blocks.filter((block) => block.confirmed).length) : '—';
  $('#metric-unscheduled').textContent = shown ? String(shown.unscheduled.length) : '—';
  if (shown) renderTimeline(shown, currentResult?.ok ? plan : lastValidPlan);
  else $('#timeline').innerHTML = '<div class="empty-state">尚无有效排程。</div>';
  $('#unscheduled-list').innerHTML = !shown
    ? '<div class="empty-state">请修正输入后重新排程。</div>'
    : shown.unscheduled.length
      ? shown.unscheduled.map((item) => `<div class="unscheduled-item" data-unscheduled-id="${escapeHtml(item.task_id)}"><strong>${escapeHtml(taskName(item.task_id))}</strong><span>${escapeHtml(reasonText(item.reason))} <code>${escapeHtml(item.reason.code)}</code></span></div>`).join('')
      : '<div class="all-good">所有待办任务均已安排。</div>';
}

function recalculate() {
  currentResult = runPlan(plan);
  if (currentResult.ok) { lastValidResult = currentResult; lastValidPlan = structuredClone(plan); }
  renderResult();
  saveState();
}

const storageKey = (key) => `smartplanner:v1:${key}`;
function saveState() {
  try {
    localStorage.setItem(storageKey(scenarioKey), JSON.stringify({ plan, displayEvents, displayTasks, temporaryEventNumber }));
    $('#save-status').textContent = '已自动保存';
  } catch {
    $('#save-status').textContent = '本设备无法自动保存，请导出 JSON 备份';
  }
}

function emptyPlan() {
  const day = new Date(); day.setHours(9, 0, 0, 0);
  const availability = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(day); date.setDate(day.getDate() + i);
    const start = Math.floor(date.getTime() / 60000);
    const endDate = new Date(date); endDate.setHours(19);
    return { start, end: Math.floor(endDate.getTime() / 60000) };
  });
  return { schema_version: 1, availability, fixed_events: [], tasks: [], completed: [], confirmed_blocks: [] };
}

function installPlan(nextPlan, key, events = {}, tasks = {}, serial = 0) {
  scenarioKey = key;
  try { localStorage.setItem('smartplanner:last-scenario', key); } catch { /* storage may be unavailable */ }
  plan = structuredClone(nextPlan);
  displayEvents = { ...events };
  displayTasks = { ...tasks };
  temporaryEventNumber = serial;
  currentResult = null;
  lastValidResult = null;
  lastValidPlan = null;
  $('#scenario-title').textContent = SCENARIOS[key].title;
  for (const button of document.querySelectorAll('.scenario-button')) {
    const active = button.dataset.scenario === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  updateDates();
  renderAvailability(); renderEvents(); renderTaskEditors(); recalculate();
}

function updateDates() {
  const sorted = [...plan.availability].sort((a, b) => a.start - b.start);
  const first = sorted[0]?.start ?? Math.floor(Date.now() / 60000);
  const end = sorted.at(-1)?.end ?? first + 480;
  $('#day-caption').textContent = `可用时间 ${localRange(first, end)}`;
  setDateInput($('#event-start'), first + 180);
  setDateInput($('#event-end'), first + 210);
  setDateInput($('#availability-start'), end + 60);
  setDateInput($('#availability-end'), end + 180);
  setDateInput($('#task-deadline'), end);
}

async function loadScenario(key) {
  const scenario = SCENARIOS[key];
  const saved = localStorage.getItem(storageKey(key));
  if (saved) {
    try {
      const state = JSON.parse(saved);
      if (state.plan?.schema_version === 1 && Array.isArray(state.plan.tasks) && Array.isArray(state.plan.availability) && Array.isArray(state.plan.fixed_events)) {
        // Refresh built-in labels for plans saved before an example's wording changed.
        // Preserve labels for user-added events and tasks.
        installPlan(state.plan, key,
          { ...state.displayEvents, ...scenario.events },
          { ...state.displayTasks, ...scenario.tasks },
          state.temporaryEventNumber);
        return;
      }
    } catch { /* use clean example */ }
  }
  if (key === 'custom') { installPlan(emptyPlan(), key); return; }
  const response = await fetch(scenario.file);
  if (!response.ok) throw new Error(`无法读取 ${scenario.file}: HTTP ${response.status}`);
  const nextPlan = await response.json();
  installPlan(nextPlan, key, scenario.events, scenario.tasks);
}

document.querySelectorAll('.scenario-button').forEach((button) => button.addEventListener('click', () => {
  loadScenario(button.dataset.scenario).catch(showLoadError);
}));
$('#task-list').addEventListener('input', (event) => {
  const input = event.target;
  const index = Number(input.dataset.taskIndex);
  if (!Number.isInteger(index) || !plan?.tasks[index]) return;
  if (input.classList.contains('duration-input')) {
    if (input.value === '') return;
    plan.tasks[index].duration_minutes = Number(input.value);
  } else return;
  input.closest('.task-editor').querySelector('.task-preview').firstChild.textContent = `${plan.tasks[index].duration_minutes} 分 · 截止 `;
  recalculate();
});
$('#task-list').addEventListener('change', (event) => {
  const input = event.target;
  if (!input.classList.contains('deadline-input')) return;
  const index = Number(input.dataset.taskIndex);
  if (!plan?.tasks[index]) return;
  const minute = readDateInput(input);
  if (minute === null) return;
  plan.tasks[index].deadline = minute;
  setDateInput(input, minute);
  input.closest('.task-editor').querySelector('.task-deadline-preview').textContent = shortDateTime(minute);
  recalculate();
});
$('#event-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const start = readDateInput($('#event-start')), end = readDateInput($('#event-end'));
  if (start === null || end === null || end <= start) { $('#save-status').textContent = '固定安排的结束须晚于开始'; return; }
  const id = `temporary-${++temporaryEventNumber}`;
  plan.fixed_events.push({ id, start, end });
  displayEvents[id] = { name: $('#event-name').value.trim(), kind: '临时', place: $('#event-place').value.trim() };
  renderEvents();
  recalculate();
});
$('#event-list').addEventListener('click', (event) => {
  const button = event.target.closest('.remove-event');
  if (!button) return;
  plan.fixed_events = plan.fixed_events.filter((item) => item.id !== button.dataset.eventId);
  delete displayEvents[button.dataset.eventId];
  renderEvents();
  recalculate();
});

$('#availability-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const start = readDateInput($('#availability-start')), end = readDateInput($('#availability-end'));
  if (start == null || end == null || end <= start) { $('#save-status').textContent = '可用时间的结束须晚于开始'; return; }
  plan.availability.push({ start, end });
  renderAvailability(); updateDates(); recalculate();
});
$('#availability-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-availability-index]');
  if (!button) return;
  plan.availability.splice(Number(button.dataset.availabilityIndex), 1);
  renderAvailability(); updateDates(); recalculate();
});
$('#task-split').addEventListener('change', () => { $('#minimum-wrap').hidden = !$('#task-split').checked; });
$('#task-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#task-name').value.trim();
  const duration = Number($('#task-duration').value);
  const deadline = readDateInput($('#task-deadline'));
  const minimum = Number($('#task-minimum').value);
  if (!name || !Number.isInteger(duration) || duration < 1 || deadline == null || ($('#task-split').checked && (!Number.isInteger(minimum) || minimum < 1 || minimum > duration))) {
    $('#save-status').textContent = '请检查任务名称、工时、截止时间和最短块'; return;
  }
  const id = `task-${Date.now().toString(36)}-${++temporaryEventNumber}`;
  const task = { id, duration_minutes: duration, deadline, dependencies: $('#task-dependency').value ? [$('#task-dependency').value] : [] };
  if ($('#task-split').checked) task.minimum_block_minutes = minimum;
  plan.tasks.push(task);
  displayTasks[id] = name;
  renderTaskEditors(); recalculate();
  $('#task-form').reset(); $('#minimum-wrap').hidden = true;
  setDateInput($('#task-deadline'), deadline);
});
$('#task-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.dataset.taskId;
  if (button.dataset.action === 'delete') {
    if (plan.tasks.some((t) => t.dependencies.includes(id))) { $('#save-status').textContent = '请先删除依赖此任务的后继任务'; return; }
    plan.tasks = plan.tasks.filter((t) => t.id !== id);
    plan.completed = plan.completed.filter((c) => c.id !== id);
    plan.confirmed_blocks = plan.confirmed_blocks.filter((b) => b.task_id !== id);
    delete displayTasks[id];
  } else if (button.dataset.action === 'complete') {
    plan.confirmed_blocks = plan.confirmed_blocks.filter((b) => b.task_id !== id);
    plan.completed.push({ id, completed_at: Math.floor(Date.now() / 60000) });
  } else if (button.dataset.action === 'reopen') {
    plan.completed = plan.completed.filter((c) => c.id !== id);
  }
  renderTaskEditors(); recalculate();
});
$('#timeline').addEventListener('click', (event) => {
  const button = event.target.closest('.lock-block');
  if (!button || !currentResult?.ok) return;
  const id = button.dataset.taskId;
  if (button.dataset.mode === 'unlock') {
    plan.confirmed_blocks = plan.confirmed_blocks.filter((b) => !(b.task_id === id && b.start === Number(button.dataset.start) && b.end === Number(button.dataset.end)));
    renderTaskEditors(); recalculate(); return;
  }
  const task = plan.tasks.find((t) => t.id === id);
  const candidates = task.minimum_block_minutes == null
    ? currentResult.blocks.filter((b) => b.task_id === id && !b.confirmed)
    : [{ task_id: id, start: Number(button.dataset.start), end: Number(button.dataset.end) }];
  for (const b of candidates) plan.confirmed_blocks.push({ task_id: id, start: b.start, end: b.end });
  renderTaskEditors(); recalculate();
});

$('#new-plan').addEventListener('click', () => {
  installPlan(emptyPlan(), 'custom');
});
$('#reset-plan').addEventListener('click', () => {
  localStorage.removeItem(storageKey(scenarioKey));
  if (scenarioKey === 'custom') installPlan(emptyPlan(), 'custom');
  else loadScenario(scenarioKey).catch(showLoadError);
});
$('#export-plan').addEventListener('click', () => {
  const payload = { app_version: 1, plan, display: { events: displayEvents, tasks: displayTasks } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `smartplanner-${scenarioKey}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#import-plan').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const source = JSON.parse(await file.text());
    const next = source.app_version === 1 ? source.plan : source;
    const result = runPlan(next);
    if (!result.ok) throw new Error(`${result.error.message} ${result.error.path}`);
    installPlan(next, 'custom', source.display?.events ?? {}, source.display?.tasks ?? {});
    $('#save-status').textContent = '导入成功，已保存在此浏览器';
  } catch (error) { $('#save-status').textContent = `导入失败：${error.message}`; }
  event.target.value = '';
});

function showLoadError(error) {
  $('#validation-banner').hidden = false;
  $('#validation-banner').textContent = `示例加载失败：${error.message}`;
}

window.__smartPlanner = { getState: () => ({ scenario: scenarioKey, plan, result: currentResult }) };
let initialScenario = 'student';
try { initialScenario = localStorage.getItem('smartplanner:last-scenario') || 'student'; } catch { /* use sample */ }
loadScenario(SCENARIOS[initialScenario] ? initialScenario : 'student').catch(showLoadError);
