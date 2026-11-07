import type { Clock } from "../../src/application/ports.ts";

export class FakeClock implements Clock {
  #now: number;

  constructor(start: string | Date = "2026-06-01T08:00:00Z") {
    this.#now = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.#now);
  }

  set(time: string | Date): void {
    this.#now = new Date(time).getTime();
  }

  advance({
    days = 0,
    hours = 0,
    minutes = 0,
    seconds = 0,
  }: {
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
  }): void {
    this.#now += (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  }
}
