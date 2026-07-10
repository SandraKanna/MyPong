import { describe, it, expect } from 'vitest';
import { predictBallY } from '../src/bot/ballPredictor';

// All tests use fieldHeight=600, ballRadius=10, so minY=10, maxY=590, range=580, period=1160.

describe('predictBallY', () => {
  it('returns current Y when steps=0', () => {
    expect(predictBallY(300, 5, 0, 600, 10)).toBe(300);
  });

  it('returns correct Y with no wall bounce', () => {
    // Ball at y=100, vy=5, 10 steps → y=150 (well within [10, 590])
    expect(predictBallY(100, 5, 10, 600, 10)).toBe(150);
  });

  it('correctly reflects off the bottom wall', () => {
    // Ball at y=570, vy=5, 10 steps → unbounded y=620.
    // 620 > 590 → bounces: 590 - (620 - 590) = 560.
    expect(predictBallY(570, 5, 10, 600, 10)).toBeCloseTo(560);
  });

  it('correctly reflects off the top wall', () => {
    // Ball at y=30, vy=-5, 10 steps → unbounded y=-20.
    // -20 < 10 → reflects: 10 + (10 - (-20)) = 40.
    expect(predictBallY(30, -5, 10, 600, 10)).toBeCloseTo(40);
  });

  it('handles multiple wall bounces', () => {
    // Ball at y=300, vy=50, 100 steps → unbounded y=5300.
    // range=580, period=1160.
    // shifted = ((300 - 10 + 5000) % 1160 + 1160) % 1160 = 5290 % 1160 = 5290 - 4*1160 = 5290 - 4640 = 650.
    // 650 > 580 → fold: maxY - (650 - 580) = 590 - 70 = 520.
    expect(predictBallY(300, 50, 100, 600, 10)).toBeCloseTo(520);
  });

  it('result is always within the valid bounce range [ballRadius, fieldHeight - ballRadius]', () => {
    const fieldHeight = 600;
    const ballRadius  = 10;
    const cases: [number, number, number][] = [
      [300, 7,   200],
      [10,  -3,  50 ],
      [590, 3,   80 ],
      [400, -11, 300],
    ];
    for (const [y, vy, steps] of cases) {
      const result = predictBallY(y, vy, steps, fieldHeight, ballRadius);
      expect(result).toBeGreaterThanOrEqual(ballRadius);
      expect(result).toBeLessThanOrEqual(fieldHeight - ballRadius);
    }
  });

  it('handles zero vertical velocity — Y is unchanged', () => {
    expect(predictBallY(250, 0, 50, 600, 10)).toBe(250);
  });
});
