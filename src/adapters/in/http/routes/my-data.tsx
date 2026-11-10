// "My data on this device" (spec 3.2, 3.7, decision I45): the overview, exports of everything, of
// one hosted plan or of one's own response, and "Delete my data".
import type { Context, Hono } from "hono";
import {
  deleteMyData,
  type ExportScope,
  exportMyData,
  viewMyData,
} from "../../../../application/my-data.ts";
import type { AppEnv } from "../app.tsx";
import { clearDeviceToken, readDeviceToken } from "../device-cookie.ts";
import { exportZip, zipDownload } from "../export-zip.ts";
import { DeleteMyDataPage, MyDataPage } from "../views/my-data.tsx";
import { newNonce, type RouteDeps, signedOutCount } from "./shared.tsx";

export function registerMyDataRoutes(
  app: Hono<AppEnv>,
  { config, planDeps, vapidPublicKey }: RouteDeps,
) {
  const deviceToken = (c: Context<AppEnv>) => readDeviceToken(c, config);

  app.get("/my-data", async (c) => {
    const data = await viewMyData(planDeps, { deviceToken: deviceToken(c) });
    c.header("cache-control", "private, no-store");
    return c.render(
      <MyDataPage
        t={c.get("t")}
        language={c.get("language")}
        timeZone={config.defaultTimezone}
        data={data}
        csrfToken={c.get("csrfToken")()}
        vapidPublicKey={vapidPublicKey}
        nonce={newNonce}
        signedOut={signedOutCount(c)}
      />,
      { title: c.get("t")("myData.heading") },
    );
  });

  /**
   * A ZIP made on demand and never stored (spec 3.7). A GET: it only marks the device as seen today,
   * as opening the plan pages does.
   */
  const download = async (c: Context<AppEnv>, scope: ExportScope) => {
    const result = await exportMyData(planDeps, { deviceToken: deviceToken(c), scope });
    if (result.kind === "not_found") return c.notFound();
    const zip = exportZip(result.data, {
      t: c.get("t"),
      language: c.get("language"),
      baseUrl: config.baseUrl,
    });
    const day = result.data.exportedAt.toISOString().slice(0, 10);
    return zipDownload(c, zip, `rendezroute-export-${day}.zip`);
  };

  app.get("/my-data/export.zip", (c) => download(c, { kind: "device" }));
  app.get("/p/:id/host/export.zip", (c) =>
    download(c, { kind: "hosted", planId: c.req.param("id") }),
  );
  app.get("/p/:id/me/export.zip", (c) =>
    download(c, { kind: "response", planId: c.req.param("id") }),
  );
  app.get("/templates/:id/export.zip", (c) =>
    download(c, { kind: "template", templateId: c.req.param("id") }),
  );

  app.get("/my-data/delete", async (c) => {
    const data = await viewMyData(planDeps, { deviceToken: deviceToken(c) });
    c.header("cache-control", "private, no-store");
    return c.render(
      <DeleteMyDataPage t={c.get("t")} data={data} csrfToken={c.get("csrfToken")()} />,
      { title: c.get("t")("myData.deleteHeading") },
    );
  });

  app.post("/my-data/delete", async (c) => {
    await deleteMyData(planDeps, { deviceToken: deviceToken(c) });
    // Also when the device was already gone: the browser should forget it either way.
    clearDeviceToken(c, config);
    return c.redirect("/?dataDeleted", 303);
  });
}
