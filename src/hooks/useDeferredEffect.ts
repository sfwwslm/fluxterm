/** 在微任务阶段延后执行副作用，并在依赖切换或卸载时取消尚未开始的任务。 */
export function scheduleDeferredTask(task: () => void) {
  let active = true;
  queueMicrotask(() => {
    if (!active) return;
    task();
  });
  return () => {
    active = false;
  };
}
