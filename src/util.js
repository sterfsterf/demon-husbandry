export const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
export const nowMs = () => Date.now(); 