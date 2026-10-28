// Port of the DeadlinePlan 0.1.0 scheduling rules (Apache-2.0).
// Times are Int32 UTC minutes since Unix epoch. All intervals are [start, end).
const MIN = -2147483648;
const MAX = 2147483647;

class PlanError extends Error {
  constructor(kind, path, message) {
    super(message);
    this.kind = kind;
    this.path = path;
  }
}
const fail = (kind, path, message) => { throw new PlanError(kind, path, message); };
const object = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('WrongType', path, '应为对象');
  return value;
};
const fields = (value, path, required, optional = []) => {
  object(value, path);
  for (const key of required) if (!(key in value)) fail('MissingField', `${path}/${key}`, `缺少 ${key}`);
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) fail('UnexpectedField', `${path}/${key}`, `未知字段 ${key}`);
};
const array = (value, path) => {
  if (!Array.isArray(value)) fail('WrongType', path, '应为数组');
  return value;
};
const string = (value, path) => {
  if (typeof value !== 'string') fail('WrongType', path, '应为字符串');
};
const minute = (value, path) => {
  if (!Number.isInteger(value) || value < MIN || value > MAX) fail('WrongType', path, '应为 Int32 整数分钟');
};
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const normalize = (windows) => {
  const merged = [];
  for (const item of [...windows].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ start: item.start, end: item.end });
  }
  return merged;
};
const durationOf = (blocks, id) => blocks.filter((b) => b.task_id === id).reduce((n, b) => n + b.end - b.start, 0);
const finish = (id, blocks, completed) => {
  const times = [...blocks.filter((b) => b.task_id === id).map((b) => b.end), ...completed.filter((c) => c.id === id).map((c) => c.completed_at)];
  return times.length ? Math.max(...times) : null;
};

export function validatePlan(plan) {
  fields(plan, '', ['schema_version', 'availability', 'fixed_events', 'tasks', 'completed', 'confirmed_blocks']);
  minute(plan.schema_version, '/schema_version');
  if (plan.schema_version !== 1) fail('UnsupportedSchemaVersion', '/schema_version', `不支持版本 ${plan.schema_version}`);
  for (const key of ['availability', 'fixed_events', 'tasks', 'completed', 'confirmed_blocks']) array(plan[key], `/${key}`);
  for (const [i, w] of plan.availability.entries()) {
    const p = `/availability/${i}`;
    fields(w, p, ['start', 'end']); minute(w.start, `${p}/start`); minute(w.end, `${p}/end`);
    if (w.start >= w.end) fail('InvalidWindow', p, '可用时间起点应早于终点');
  }
  for (const [i, e] of plan.fixed_events.entries()) {
    const p = `/fixed_events/${i}`;
    fields(e, p, ['id', 'start', 'end']); string(e.id, `${p}/id`); minute(e.start, `${p}/start`); minute(e.end, `${p}/end`);
    if (e.start >= e.end) fail('InvalidWindow', p, '固定事件起点应早于终点');
  }
  const byId = new Map();
  for (const [i, task] of plan.tasks.entries()) {
    const p = `/tasks/${i}`;
    fields(task, p, ['id', 'duration_minutes', 'deadline', 'dependencies'], ['earliest_start', 'minimum_block_minutes']);
    string(task.id, `${p}/id`); minute(task.duration_minutes, `${p}/duration_minutes`); minute(task.deadline, `${p}/deadline`);
    if (!task.id.trim()) fail('InvalidTaskId', `${p}/id`, '任务 ID 不能为空');
    if (task.duration_minutes <= 0) fail('InvalidTaskDuration', `${p}/duration_minutes`, '工时须大于 0');
    if (byId.has(task.id)) fail('DuplicateTaskId', `${p}/id`, `重复任务 ID：${task.id}`);
    byId.set(task.id, i);
    array(task.dependencies, `${p}/dependencies`);
    task.dependencies.forEach((d, j) => string(d, `${p}/dependencies/${j}`));
    if (task.earliest_start != null) {
      minute(task.earliest_start, `${p}/earliest_start`);
      if (task.earliest_start >= task.deadline) fail('InvalidEarliestStart', `${p}/earliest_start`, '最早开始须早于截止时间');
    }
    if (task.minimum_block_minutes != null) {
      minute(task.minimum_block_minutes, `${p}/minimum_block_minutes`);
      if (task.minimum_block_minutes <= 0 || task.minimum_block_minutes > task.duration_minutes)
        fail('InvalidMinimumBlock', `${p}/minimum_block_minutes`, '最短块应在 1 到总工时之间');
    }
  }
  plan.tasks.forEach((t, i) => t.dependencies.forEach((d, j) => {
    if (!byId.has(d)) fail('UnknownDependency', `/tasks/${i}/dependencies/${j}`, `未知前置任务：${d}`);
  }));
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) fail('DependencyCycle', `/tasks/${byId.get(id)}/dependencies`, '任务之间存在依赖环');
    if (state.get(id) === 2) return;
    state.set(id, 1);
    plan.tasks[byId.get(id)].dependencies.forEach(visit);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id);
  const done = new Set();
  for (const [i, c] of plan.completed.entries()) {
    const p = `/completed/${i}`;
    fields(c, p, ['id', 'completed_at']); string(c.id, `${p}/id`); minute(c.completed_at, `${p}/completed_at`);
    if (!byId.has(c.id)) fail('UnknownCompletedTaskId', `${p}/id`, `未知任务：${c.id}`);
    if (done.has(c.id)) fail('DuplicateCompletedTaskId', `${p}/id`, `重复完成记录：${c.id}`);
    done.add(c.id);
  }
  const available = normalize(plan.availability);
  for (const [i, b] of plan.confirmed_blocks.entries()) {
    const p = `/confirmed_blocks/${i}`;
    fields(b, p, ['task_id', 'start', 'end']); string(b.task_id, `${p}/task_id`); minute(b.start, `${p}/start`); minute(b.end, `${p}/end`);
    if (!byId.has(b.task_id)) fail('UnknownConfirmedTaskId', `${p}/task_id`, `未知任务：${b.task_id}`);
    if (done.has(b.task_id)) fail('CompletedAndConfirmedTaskId', p, '同一任务不能同时完成和确认');
    if (b.start >= b.end) fail('InvalidConfirmedWindow', p, '确认块起点应早于终点');
    const task = plan.tasks[byId.get(b.task_id)];
    if (task.earliest_start != null && b.start < task.earliest_start) fail('ConfirmedBeforeEarliestStart', p, '确认块早于最早开始');
    if (b.end > task.deadline) fail('ConfirmedAfterDeadline', p, '确认块晚于截止时间');
    if (task.minimum_block_minutes != null && b.end - b.start < task.minimum_block_minutes)
      fail('ConfirmedBlockTooShort', p, '确认块短于任务最短块');
    if (!available.some((w) => b.start >= w.start && b.end <= w.end)) fail('ConfirmedOutsideAvailability', p, '确认块不在可用时间内');
    const event = plan.fixed_events.find((e) => overlap(b, e));
    if (event) fail('ConfirmedOverlapsFixedEvent', p, `与固定事件 ${event.id} 冲突`);
    const prior = plan.confirmed_blocks.slice(0, i).find((other) => overlap(b, other));
    if (prior) fail('ConfirmedBlocksOverlap', p, `与 ${prior.task_id} 的确认块冲突`);
  }
  for (const [i, task] of plan.tasks.entries()) {
    const confirmed = plan.confirmed_blocks.filter((b) => b.task_id === task.id);
    const total = durationOf(confirmed, task.id);
    if (confirmed.length && task.minimum_block_minutes == null && confirmed.length !== 1)
      fail('InvalidConfirmedBlockCount', `/tasks/${i}`, '连续任务只能确认一块');
    if (total > task.duration_minutes || (confirmed.length && task.minimum_block_minutes == null && total !== task.duration_minutes))
      fail('ConfirmedDurationMismatch', `/tasks/${i}/duration_minutes`, '确认工时超过总工时，或连续任务未完整确认');
  }
  // Actual completed/confirmed work must have a resolved predecessor timeline.
  const actuals = [
    ...plan.tasks.filter((t) => plan.confirmed_blocks.some((b) => b.task_id === t.id)).map((t) => ({ task: t, at: Math.min(...plan.confirmed_blocks.filter((b) => b.task_id === t.id).map((b) => b.start)) })),
    ...plan.completed.map((c) => ({ task: plan.tasks[byId.get(c.id)], at: c.completed_at })),
  ];
  for (const { task, at } of actuals) for (const dep of task.dependencies) {
    const resolved = done.has(dep) || durationOf(plan.confirmed_blocks, dep) === plan.tasks[byId.get(dep)].duration_minutes;
    if (!resolved) fail('UnresolvedPriorDependency', `/tasks/${byId.get(task.id)}/dependencies`, `前置任务 ${dep} 未完成`);
    if (finish(dep, plan.confirmed_blocks, plan.completed) > at)
      fail('PriorDependencyFinishesLate', `/tasks/${byId.get(task.id)}/dependencies`, `前置任务 ${dep} 完成得太晚`);
  }
  return plan;
}

function freeIntervals(availability, occupied, earliest, deadline) {
  const blockers = normalize(occupied);
  const gaps = [];
  for (const window of availability) {
    let cursor = Math.max(window.start, earliest ?? MIN);
    const limit = Math.min(window.end, deadline);
    for (const b of blockers) {
      if (cursor >= limit) break;
      if (b.start < limit && b.end > cursor) {
        if (b.start > cursor) gaps.push({ start: cursor, end: b.start });
        cursor = Math.max(cursor, b.end);
      }
    }
    if (cursor < limit) gaps.push({ start: cursor, end: limit });
  }
  return gaps;
}

// Largest current block that leaves a feasible suffix of regular blocks,
// optionally with a single final short block after confirmed progress.
function feasibleTake(gaps, index, remaining, minimum, allowShortFinal) {
  const capacity = gaps[index].end - gaps[index].start;
  if (allowShortFinal && remaining < minimum) return capacity >= remaining ? remaining : null;
  if (capacity < minimum) return null;
  const future = gaps.slice(index + 1).map((g) => g.end - g.start).sort((a, b) => a - b);
  let suffixCapacity = 0, best = 0, searching = true;
  for (let count = 0; searching && count <= future.length && count * minimum <= remaining; count++) {
    const lower = Math.max(minimum, remaining - suffixCapacity);
    const upper = Math.min(capacity, remaining - count * minimum);
    if (lower <= upper) best = Math.max(best, upper);
    if (count < future.length) {
      const largest = future[future.length - 1 - count];
      if (allowShortFinal && minimum > 1) {
        const maximumSuffix = Math.min(remaining, suffixCapacity + Math.min(minimum - 1, largest));
        const lowerShort = Math.max(minimum, remaining - maximumSuffix);
        const upperShort = Math.min(capacity, remaining - count * minimum - 1);
        if (lowerShort <= upperShort) best = Math.max(best, upperShort);
      }
      if (largest >= minimum) suffixCapacity = Math.min(remaining, suffixCapacity + largest);
      else searching = false;
    }
  }
  return best >= minimum ? best : null;
}

export function schedule(plan) {
  validatePlan(plan);
  const availability = normalize(plan.availability);
  const blocks = plan.confirmed_blocks.map((b) => ({ ...b, confirmed: true }));
  const unscheduled = [];
  const byId = new Map(plan.tasks.map((t, i) => [t.id, i]));
  const status = plan.tasks.map((t) => plan.completed.some((c) => c.id === t.id) || durationOf(blocks, t.id) === t.duration_minutes ? 1 : 0);
  while (status.includes(0)) {
    let next = -1;
    for (let i = 0; i < plan.tasks.length; i++) {
      if (status[i] !== 0 || !plan.tasks[i].dependencies.every((d) => status[byId.get(d)] === 1)) continue;
      if (next < 0 || plan.tasks[i].deadline < plan.tasks[next].deadline) next = i;
    }
    if (next < 0) {
      next = status.indexOf(0);
      const dep = plan.tasks[next].dependencies.find((d) => status[byId.get(d)] !== 1);
      unscheduled.push({ task_id: plan.tasks[next].id, reason: { code: 'DependencyNotScheduled', dependency_id: dep } });
      status[next] = 2;
      continue;
    }
    const task = plan.tasks[next];
    const remaining = task.duration_minutes - durationOf(plan.confirmed_blocks, task.id);
    const deps = task.dependencies.map((d) => finish(d, blocks, plan.completed));
    const earliest = Math.max(task.earliest_start ?? MIN, ...deps);
    const occupied = [...plan.fixed_events, ...blocks];
    const gaps = freeIntervals(availability, occupied, earliest, task.deadline);
    let tentative = [];
    if (task.minimum_block_minutes == null) {
      const gap = gaps.find((g) => g.end - g.start >= remaining);
      if (gap) tentative = [{ task_id: task.id, start: gap.start, end: gap.start + remaining, confirmed: false }];
      else unscheduled.push({ task_id: task.id, reason: { code: 'NoContinuousSlot' } });
    } else {
      let left = remaining;
      for (let i = 0; i < gaps.length && left > 0; i++) {
        const take = feasibleTake(gaps, i, left, task.minimum_block_minutes, remaining < task.duration_minutes);
        if (take == null) continue;
        tentative.push({ task_id: task.id, start: gaps[i].start, end: gaps[i].start + take, confirmed: false });
        left -= take;
      }
      if (left) {
        tentative = []; // rollback trial blocks, retain existing confirmation
        unscheduled.push({ task_id: task.id, reason: { code: 'SplitWorkIncomplete', remaining_minutes: remaining } });
      }
    }
    if (tentative.length) { blocks.push(...tentative); status[next] = 1; }
    else status[next] = 2;
  }
  return { blocks: blocks.sort((a, b) => a.start - b.start || a.end - b.end), unscheduled };
}

export function runPlan(source) {
  try {
    let plan;
    try { plan = typeof source === 'string' ? JSON.parse(source) : source; }
    catch (e) { fail('JsonSyntax', '', e.message); }
    return { ok: true, ...schedule(plan) };
  } catch (e) {
    if (!(e instanceof PlanError)) throw e;
    return { ok: false, error: { kind: e.kind, path: e.path, message: e.message } };
  }
}
