// 시간대별 교통량/보행자 밀도 곡선 (0~1) 및 러시아워 판정
const CAR_KEYS = [[0, 0.12], [2, 0.05], [4, 0.07], [6, 0.35], [7.5, 0.85], [8.5, 1.0], [9.5, 0.7], [12, 0.55], [13, 0.6], [16, 0.62], [17.5, 0.95], [18.5, 1.0], [19.5, 0.75], [21, 0.45], [23, 0.2], [24, 0.12]];
// 고속도로(강변 고가 등) 교통량: 저녁부터 자정까지 최대, 자정 이후 감소
const HW_KEYS = [[0, 0.9], [1, 0.6], [2, 0.35], [3, 0.2], [5, 0.2], [6, 0.45], [7.5, 0.85], [9, 0.9], [12, 0.7], [16, 0.8], [18, 1.0], [21, 1.0], [23.5, 0.95], [24, 0.9]];
const PED_KEYS = [[0, 0.06], [3, 0.02], [6, 0.2], [8, 0.85], [9, 0.7], [12, 0.95], [13, 0.9], [15, 0.7], [18, 1.0], [19, 0.85], [21, 0.55], [23, 0.2], [24, 0.06]];

function lerpKeys(keys, h) {
  h = ((h % 24) + 24) % 24;
  for (let i = 0; i < keys.length - 1; i++) {
    const [h0, v0] = keys[i], [h1, v1] = keys[i + 1];
    if (h >= h0 && h <= h1) { const t = (h - h0) / (h1 - h0); return v0 + (v1 - v0) * (t * t * (3 - 2 * t)); }
  }
  return keys[0][1];
}
export const carDensity = (h) => lerpKeys(CAR_KEYS, h);
export const pedDensity = (h) => lerpKeys(PED_KEYS, h);
export const highwayDensity = (h) => lerpKeys(HW_KEYS, h);
export const isRushHour = (h) => (h >= 7 && h < 9.5) || (h >= 17 && h < 19.5);
// 러시아워 정체: 밀도가 높을수록 제한속도 하향
export function speedFactor(density) {
  const t = Math.min(1, Math.max(0, (density - 0.65) / 0.35));
  return 1 - 0.4 * t * t * (3 - 2 * t);
}
