import type { MatchRowTs } from '../services/match.service';

export class MatchmakingQueue {
  private readonly queue: number[] = [];

  constructor(
    private readonly send:            (msg: object) => void,
    private readonly createMatchFn:   (p1: number, p2: number) => Promise<MatchRowTs>,
    private readonly findActiveMatch: (userId: number) => Promise<MatchRowTs | null>,
  ) {}

  async handleJoin(userId: number): Promise<void> {
    const active = await this.findActiveMatch(userId);
    if (active !== null) {
      this.send({
        type:    'match:rejected',
        to:      [userId],
        payload: { reason: 'already_in_match', message: 'You are already in an active match.' },
      });
      return;
    }

    if (this.queue.includes(userId)) return;
    this.queue.push(userId);

    if (this.queue.length >= 2) {
      const first  = this.queue.shift()!;
      const second = this.queue.shift()!;

      let match: MatchRowTs;
      try {
        match = await this.createMatchFn(first, second);
      } catch (err) {
        console.error('[match-service] createMatch failed:', err);
        return;
      }

      const players = { [first]: 'left', [second]: 'right' } as Record<number, 'left' | 'right'>;

      this.send({
        type:    'match:matched',
        to:      [first, second],
        payload: { matchId: match.id, players },
      });

      this.send({
        type:    'game:assign',
        payload: { matchId: match.id, players },
      });
    }
  }

  handleCancel(userId: number): void {
    const i = this.queue.indexOf(userId);
    if (i !== -1) this.queue.splice(i, 1);
  }

  handleDisconnect(userId: number): void {
    const i = this.queue.indexOf(userId);
    if (i !== -1) this.queue.splice(i, 1);
  }

  queueLength(): number {
    return this.queue.length;
  }
}
