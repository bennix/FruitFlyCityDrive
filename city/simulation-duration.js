export function simulationDuration(value) {
  const seconds=Number(value);
  return Number.isFinite(seconds)&&seconds>=1?seconds:1000;
}
