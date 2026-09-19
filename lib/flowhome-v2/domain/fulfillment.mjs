export function makeInspectionTask({ taskId, commitmentId, partnerId, tick }) {
  return Object.freeze({ taskId, kind: 'INSPECTION', commitmentId, partnerId, status: 'PENDING', createdAtTick: tick, source: 'simulated' });
}

export function makeDeliveryTask({ taskId, assetId, reservationId, partnerId, tick }) {
  return Object.freeze({ taskId, kind: 'DELIVERY', assetId, reservationId, partnerId, status: 'PENDING', createdAtTick: tick, source: 'simulated' });
}

export function taskFor(state, taskId) { return state.tasks.find((task) => task.taskId === taskId); }
export function replaceTask(tasks, next) { return tasks.map((task) => task.taskId === next.taskId ? Object.freeze(next) : task); }
export function taskAcceptable(task) { return task && task.status === 'PENDING'; }
