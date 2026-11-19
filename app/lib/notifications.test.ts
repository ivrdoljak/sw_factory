import { describe, expect, it } from "vitest";
import {
  decodeNotificationPosition,
  encodeNotificationPosition,
} from "./notifications";

describe("a Notification's position in the drawer's list", () => {
  it("reads back the same raisedAt and id it was written as", () => {
    const position = { raisedAt: "2026-10-06T12:00:00.000Z", id: 42 };

    expect(
      decodeNotificationPosition(encodeNotificationPosition(position))
    ).toEqual(position);
  });

  it("is not read from a value with no id", () => {
    expect(decodeNotificationPosition("2026-10-06T12:00:00.000Z")).toBeNull();
  });
});
