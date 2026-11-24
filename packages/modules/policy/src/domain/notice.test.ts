import { describe, expect, it } from "vitest";
import {
  assertCancellationDate,
  earliestCancellationDate,
  mailsNotice,
  NO_NOTICE,
  type NoticeRule,
  policyAgeDays,
} from "./notice";

const d = (value: string) => Temporal.PlainDate.from(value);
const term = { termStart: d("2027-08-01"), termEnd: d("2028-08-01") };

const rule = (overrides: Partial<NoticeRule> = {}): NoticeRule => ({
  minDaysNotice: 30,
  mailingDaysAdded: 5,
  allowedReasons: [],
  deliveryMethods: ["first_class_mail"],
  recipients: ["insured"],
  ...overrides,
});

describe("earliestCancellationDate", () => {
  it("adds notice days plus mailing days to the notice date", () => {
    const earliest = earliestCancellationDate({
      ...term,
      noticeDate: d("2027-10-10"),
      reason: "underwriting",
      rule: rule(),
    });

    expect(earliest.date.toString()).toBe("2027-11-14");
    expect(earliest.mailingDaysAdded).toBe(5);
    expect(earliest.atInception).toBe(false);
  });

  it("adds no mailing days to an electronic notice and allows immediate insured requests", () => {
    const electronic = rule({ minDaysNotice: 10, deliveryMethods: ["electronic"] });

    expect(
      earliestCancellationDate({
        ...term,
        noticeDate: d("2027-10-10"),
        reason: "nonpayment",
        rule: electronic,
      }).date.toString(),
    ).toBe("2027-10-20");

    const immediate = rule({ minDaysNotice: 0, mailingDaysAdded: 0 });

    expect(
      earliestCancellationDate({
        ...term,
        noticeDate: d("2027-10-10"),
        reason: "insured_request",
        rule: immediate,
      }).date.toString(),
    ).toBe("2027-10-10");
  });

  it("never falls before inception and refuses past expiration", () => {
    const early = earliestCancellationDate({
      ...term,
      noticeDate: d("2027-06-01"),
      reason: "underwriting",
      rule: rule(),
    });

    expect(early.date.toString()).toBe("2027-08-01");
    expect(early.atInception).toBe(true);

    expect(() =>
      earliestCancellationDate({
        ...term,
        noticeDate: d("2028-07-10"),
        reason: "underwriting",
        rule: rule(),
      }),
    ).toThrow(/past the end/);
  });

  it("refuses reasons the jurisdiction doesn't allow and dates before the earliest", () => {
    const limited = rule({ allowedReasons: ["nonpayment", "misrepresentation"] });

    expect(() =>
      earliestCancellationDate({
        ...term,
        noticeDate: d("2027-12-01"),
        reason: "underwriting",
        rule: limited,
      }),
    ).toThrow(/isn't allowed/);

    const earliest = earliestCancellationDate({
      ...term,
      noticeDate: d("2027-10-10"),
      reason: "nonpayment",
      rule: limited,
    });

    expect(() => assertCancellationDate(d("2027-11-13"), earliest)).toThrow(/Nov 14, 2027/);
    expect(() => assertCancellationDate(d("2027-11-14"), earliest)).not.toThrow();
  });

  it("without a notice rule allows any reason on the notice date and sends nothing", () => {
    const earliest = earliestCancellationDate({
      ...term,
      noticeDate: d("2027-10-10"),
      reason: "underwriting",
      rule: null,
    });

    expect(earliest.date.toString()).toBe("2027-10-10");
    expect(earliest.minDaysNotice).toBe(0);
    expect(earliest.mailingDaysAdded).toBe(0);
    expect(earliest.delivery).toBe(NO_NOTICE);
    expect(mailsNotice(earliest.delivery)).toBe(false);

    const beforeInception = earliestCancellationDate({
      ...term,
      noticeDate: d("2027-07-01"),
      reason: "underwriting",
      rule: null,
    });

    expect(beforeInception.date.toString()).toBe("2027-08-01");
    expect(beforeInception.atInception).toBe(true);
  });

  it("counts policy age from inception, zero before it", () => {
    expect(policyAgeDays(d("2027-08-01"), d("2027-09-30"))).toBe(60);
    expect(policyAgeDays(d("2027-08-01"), d("2027-07-01"))).toBe(0);
  });
});
