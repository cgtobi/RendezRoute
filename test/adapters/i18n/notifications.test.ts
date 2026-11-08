import { describe, expect, it } from "vite-plus/test";
import { notificationText } from "../../../src/adapters/i18n/notifications.ts";
import { NOTIFICATION_KINDS } from "../../../src/domain/notification.ts";

describe("notification texts (spec 6 feature 3, decision P7)", () => {
  it("exist for every kind in every language, titled with the plan", () => {
    for (const language of ["en", "de", "fr"]) {
      for (const kind of NOTIFICATION_KINDS) {
        const text = notificationText({ kind, planTitle: "Sunday run", language });
        expect(text.title).toBe("Sunday run");
        expect(text.body.length).toBeGreaterThan(10);
      }
    }
  });

  it("use the recipient's stored language, falling back to English", () => {
    const body = (language: string) =>
      notificationText({ kind: "cancelled", planTitle: "x", language }).body;
    expect(body("de")).toBe("Das Treffen wurde abgesagt.");
    expect(body("fr")).toBe("La sortie a été annulée.");
    expect(body("it")).toBe("The plan was cancelled.");
  });
});
