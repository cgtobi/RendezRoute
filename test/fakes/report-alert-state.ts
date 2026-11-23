import type { ReportAlertState } from "../../src/application/ports.ts";

/** The persisted time of the latest report alert, in memory: share one to simulate a restart. */
export class FakeReportAlertState implements ReportAlertState {
  at: Date | undefined;

  read() {
    return Promise.resolve(this.at);
  }

  write(at: Date) {
    this.at = at;
    return Promise.resolve();
  }
}
