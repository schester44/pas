import { createHmac, randomBytes } from "node:crypto";
import { isRecord } from "@pas/kernel";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface MockRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface MockResponse {
  status: number;
  body: unknown;
  contentType?: string;
}

interface Line {
  coverage: string;
  exposure?: string;
  amount: number;
}

interface Application {
  id: string;
  insured: string;
  lines: Line[];
  decidedAt: number;
  decision: "quoted" | "referred" | "declined";
  callbackUrl: string | null;
  callbackDecision: "quoted" | "declined";
}

interface Bind {
  id: string;
  applicationId: string;
  status: "pending" | "bound" | "voided" | "issued";
  confirmFails: boolean;
}

export const MOCK_CARRIER_API_KEY = "lakeside-test-key";
export const MOCK_CARRIER_CALLBACK_SECRET = "lakeside-callback-secret";

const DECISION_DELAY_MS = 4_000;
const CALLBACK_DELAY_MS = 6_000;
const LOADING = 1.07;
const POLICY_FEE = 35;

const round = (value: number) => Math.round(value * 100) / 100;
const id = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;

const linesOf = (value: unknown): Line[] =>
  (Array.isArray(value) ? value : []).flatMap((line) =>
    isRecord(line) && typeof line.coverage === "string"
      ? [
          {
            coverage: line.coverage,
            ...(typeof line.exposure === "string" && { exposure: line.exposure }),
            amount: Number(line.amount ?? 0),
          },
        ]
      : [],
  );

const priced = (lines: Line[]) => ({
  currency: "USD",
  lines: lines.map((l) => ({ ...l, amount: round(l.amount * LOADING) })),
  fees: [{ code: "LKM_POLICY_FEE", label: "Carrier policy fee", amount: POLICY_FEE }],
});

/**
 * A small multi-step carrier for development and sandboxes (PLAN §12): session token →
 * application decided asynchronously (poll, or a signed callback after a referral) → bind →
 * confirm → issue with a policy number and a declarations PDF; endorsements and cancellations.
 * Insured names steer it: "Refer" refers, "Decline" declines, "Fail bind" fails the bind confirm.
 */
export class MockCarrier {
  private readonly sessions = new Set<string>();
  private readonly applications = new Map<string, Application>();
  private readonly binds = new Map<string, Bind>();
  private readonly policies = new Map<string, { insured: string; applicationId: string }>();
  private sequence = Math.floor(Date.now() / 1000) % 900_000;

  constructor(
    private readonly options: {
      callbackSecret?: string;
      deliver?: (url: string, body: string, signature: string) => Promise<void>;
    } = {},
  ) {}

  async handle(request: MockRequest): Promise<MockResponse> {
    const segments = request.path.replace(/^\/+|\/+$/g, "").split("/");
    const route = `${request.method} /${segments.map((s, i) => (i % 2 === 1 ? ":id" : s)).join("/")}`;
    const first = segments[1];

    if (route === "POST /sessions") return this.session(request);

    if (route.startsWith("GET /documents/")) return this.document(first ?? "");

    if (!this.authorized(request))
      return { status: 401, body: { message: "Session expired or missing" } };

    const body = isRecord(request.body) ? request.body : {};

    switch (route) {
      case "POST /applications":
        return this.submit(body);
      case "GET /applications/:id":
        return this.application(first!);
      case "POST /applications/:id/void":
        return this.applications.delete(first!)
          ? { status: 200, body: { status: "voided" } }
          : this.missing();
      case "POST /applications/:id/binds":
        return this.bind(first!);
      case "POST /binds/:id/confirm":
        return this.confirm(first!);
      case "POST /binds/:id/void":
        return this.voidBind(first!);
      case "POST /binds/:id/issue":
        return this.issue(first!);
      case "POST /policies/:id/endorsements":
        return this.endorse(first!, body);
      case "POST /policies/:id/cancellations":
        return this.cancel(first!, body);
      default:
        return { status: 404, body: { message: `No route ${request.method} ${request.path}` } };
    }
  }

  private authorized(request: MockRequest) {
    const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");

    return this.sessions.has(token);
  }

  private session(request: MockRequest): MockResponse {
    if (request.headers["x-api-key"] !== MOCK_CARRIER_API_KEY) {
      return { status: 403, body: { message: "Unknown API key" } };
    }

    const token = randomBytes(16).toString("hex");

    this.sessions.add(token);

    return { status: 201, body: { sessionToken: token, expiresIn: 1800 } };
  }

  private submit(body: Record<string, unknown>): MockResponse {
    const insured = String(
      (isRecord(body.applicant) ? body.applicant.name : body.insuredName) ?? "",
    );

    const lines = linesOf(body.coverages);

    if (lines.length === 0)
      return { status: 422, body: { message: "Send at least one coverage with a premium" } };

    const lower = insured.toLowerCase();

    const application: Application = {
      id: id("APP"),
      insured,
      lines,
      decidedAt: Date.now() + DECISION_DELAY_MS,
      decision: lower.includes("decline")
        ? "declined"
        : lower.includes("refer")
          ? "referred"
          : "quoted",
      callbackUrl: typeof body.callbackUrl === "string" ? body.callbackUrl : null,
      callbackDecision: lower.includes("refer decline") ? "declined" : "quoted",
    };

    this.applications.set(application.id, application);

    if (application.decision === "referred" && application.callbackUrl)
      this.scheduleCallback(application);

    return { status: 202, body: { applicationId: application.id, status: "pending" } };
  }

  private application(appId: string): MockResponse {
    const app = this.applications.get(appId);

    if (!app) return this.missing();

    if (Date.now() < app.decidedAt)
      return { status: 200, body: { applicationId: app.id, status: "pending" } };

    const premium = app.decision === "quoted" ? priced(app.lines) : null;

    return {
      status: 200,
      body: {
        applicationId: app.id,
        status: app.decision,
        quoteId: app.decision === "quoted" ? `Q-${app.id.slice(4)}` : null,
        premium,
        messages:
          app.decision === "referred"
            ? [
                {
                  code: "UW_REVIEW",
                  text: "Referred to Lakeside underwriting; a decision follows by callback",
                },
              ]
            : app.decision === "declined"
              ? [{ code: "UW_DECLINE", text: "Outside Lakeside's appetite for this risk" }]
              : [],
      },
    };
  }

  private scheduleCallback(app: Application) {
    setTimeout(() => {
      const decision = app.callbackDecision;

      app.decision = decision;

      const payload = JSON.stringify({
        event: "application.decided",
        applicationId: app.id,
        decision,
        quoteId: decision === "quoted" ? `Q-${app.id.slice(4)}` : null,
        premium: decision === "quoted" ? priced(app.lines) : null,
        messages: [
          {
            code: "UW_DECIDED",
            text: `Lakeside underwriting ${decision === "quoted" ? "approved" : "declined"} the referral`,
          },
        ],
      });

      const signature = createHmac(
        "sha256",
        this.options.callbackSecret ?? MOCK_CARRIER_CALLBACK_SECRET,
      )
        .update(payload)
        .digest("hex");

      void this.options.deliver?.(app.callbackUrl!, payload, signature).catch(() => undefined);
    }, CALLBACK_DELAY_MS).unref();
  }

  private bind(appId: string): MockResponse {
    const app = this.applications.get(appId);

    if (!app) return this.missing();

    if (app.decision !== "quoted" || Date.now() < app.decidedAt) {
      return { status: 409, body: { message: `Application ${appId} isn't quoted` } };
    }

    const bind: Bind = {
      id: id("BND"),
      applicationId: app.id,
      status: "pending",
      confirmFails: app.insured.toLowerCase().includes("fail bind"),
    };

    this.binds.set(bind.id, bind);

    return { status: 201, body: { bindId: bind.id, status: "pending" } };
  }

  private confirm(bindId: string): MockResponse {
    const bind = this.binds.get(bindId);

    if (!bind) return this.missing();

    if (bind.confirmFails) {
      return {
        status: 422,
        body: {
          code: "BIND_REJECTED",
          message: "Lakeside couldn't confirm the binder: inspection hold on this address",
        },
      };
    }

    bind.status = "bound";

    return {
      status: 200,
      body: { bindId, status: "bound", binderNumber: `BDR-${bindId.slice(4)}` },
    };
  }

  private voidBind(bindId: string): MockResponse {
    const bind = this.binds.get(bindId);

    if (!bind) return this.missing();

    bind.status = "voided";

    return { status: 200, body: { bindId, status: "voided" } };
  }

  private issue(bindId: string): MockResponse {
    const bind = this.binds.get(bindId);

    if (!bind) return this.missing();

    if (bind.status !== "bound")
      return { status: 409, body: { message: `Binder ${bindId} is ${bind.status}` } };

    const app = this.applications.get(bind.applicationId)!;
    const policyNumber = `LKM-HO-${String(++this.sequence).padStart(6, "0")}`;

    bind.status = "issued";
    this.policies.set(policyNumber, { insured: app.insured, applicationId: app.id });

    return {
      status: 201,
      body: {
        policyNumber,
        status: "issued",
        documents: [
          {
            title: "Lakeside Mutual declarations",
            type: "declarations",
            href: `/documents/${policyNumber}-dec.pdf`,
          },
        ],
      },
    };
  }

  private endorse(policyNumber: string, body: Record<string, unknown>): MockResponse {
    if (!this.known(policyNumber)) return this.missing();

    const lines = linesOf(body.premiumChange);

    return {
      status: 201,
      body: {
        endorsementId: id("END"),
        status: "processed",
        premium: {
          currency: "USD",
          lines: lines.map((l) => ({ ...l, amount: round(l.amount * LOADING) })),
          fees: [],
        },
      },
    };
  }

  private cancel(policyNumber: string, body: Record<string, unknown>): MockResponse {
    if (!this.known(policyNumber)) return this.missing();

    const lines = linesOf(body.returnPremium);

    return {
      status: 201,
      body: {
        cancellationId: id("CXL"),
        status: "processed",
        returnPremium: {
          currency: "USD",
          lines: lines.map((l) => ({ ...l, amount: round(l.amount * 0.95) })),
          fees: [],
        },
      },
    };
  }

  private async document(file: string): Promise<MockResponse> {
    const policyNumber = file.replace(/-dec\.pdf$/, "");
    const policy = this.policies.get(policyNumber);
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(0.12, 0.14, 0.2);

    page.drawText("Lakeside Mutual Insurance Company", {
      x: 56,
      y: 720,
      size: 18,
      font: bold,
      color: ink,
    });

    page.drawText("Homeowners policy declarations (carrier copy)", {
      x: 56,
      y: 696,
      size: 12,
      font,
      color: ink,
    });

    page.drawText(`Policy number: ${policyNumber}`, { x: 56, y: 650, size: 11, font, color: ink });

    page.drawText(`Named insured: ${policy?.insured ?? "On file"}`, {
      x: 56,
      y: 632,
      size: 11,
      font,
      color: ink,
    });

    page.drawText("Issued by Lakeside Mutual through its program administrator.", {
      x: 56,
      y: 596,
      size: 10,
      font,
      color: ink,
    });

    return { status: 200, body: Buffer.from(await pdf.save()), contentType: "application/pdf" };
  }

  // State is in memory; numbers it issued before a restart still look like its own.
  private known(policyNumber: string) {
    return this.policies.has(policyNumber) || /^LKM-HO-\d{6}$/.test(policyNumber);
  }

  private missing(): MockResponse {
    return { status: 404, body: { message: "Not found" } };
  }
}
