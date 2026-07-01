export class Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly radius: number;
  private readonly minSpeed: number;
  private readonly maxSpeed: number;

  constructor(
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    minSpeed: number,
    maxSpeed: number,
  ) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.radius = radius;
    this.minSpeed = minSpeed;
    this.maxSpeed = maxSpeed;
  }

  update(fieldHeight: number): void {
    this.x += this.vx;
    this.y += this.vy;

    if (this.y - this.radius <= 0) {
      this.vy = Math.abs(this.vy);
      this.y = this.radius;
    } else if (this.y + this.radius >= fieldHeight) {
      this.vy = -Math.abs(this.vy);
      this.y = fieldHeight - this.radius;
    }
  }

  reverseX(): void {
    this.vx = -this.vx;
  }

  // Clamps the magnitude of the velocity vector to [minSpeed, maxSpeed],
  // preserving direction. A zero vector is set to (minSpeed, 0).
  setSpeed(vx: number, vy: number): void {
    const mag = Math.sqrt(vx * vx + vy * vy);
    if (mag === 0) {
      this.vx = this.minSpeed;
      this.vy = 0;
      return;
    }
    const clamped = Math.max(this.minSpeed, Math.min(this.maxSpeed, mag));
    this.vx = (vx / mag) * clamped;
    this.vy = (vy / mag) * clamped;
  }

  reset(x: number, y: number, vx: number, vy: number): void {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
  }
}
