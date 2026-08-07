// Живые лог-стримы: id → остановка. Активный стрим держит соединение в пуле занятым
export const logStreams = new Map<string, () => void>();

export function stopAllLogStreams(): void {
  for (const stop of logStreams.values()) stop();
}
