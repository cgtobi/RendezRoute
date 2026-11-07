import type { IdGenerator } from "../../src/application/ports.ts";

export class SequentialIdGenerator implements IdGenerator {
  #plans = 0;
  #rows = 0;

  planId(): string {
    return `plan-${String(++this.#plans).padStart(4, "0")}`;
  }

  rowId(): string {
    return `row-${String(++this.#rows).padStart(4, "0")}`;
  }
}
