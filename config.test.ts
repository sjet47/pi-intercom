import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ASK_TIMEOUT_MS,
  getAskTimeoutMs,
} from "./config.ts";

test("getAskTimeoutMs returns the default when unset", () => {
  const previous = process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
  delete process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
  try {
    assert.equal(getAskTimeoutMs(), DEFAULT_ASK_TIMEOUT_MS);
  } finally {
    if (previous === undefined) {
      delete process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
    } else {
      process.env.PI_INTERCOM_ASK_TIMEOUT_MS = previous;
    }
  }
});

test("getAskTimeoutMs reads a positive integer value", () => {
  const previous = process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
  process.env.PI_INTERCOM_ASK_TIMEOUT_MS = "45000";
  try {
    assert.equal(getAskTimeoutMs(), 45000);
  } finally {
    if (previous === undefined) {
      delete process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
    } else {
      process.env.PI_INTERCOM_ASK_TIMEOUT_MS = previous;
    }
  }
});

test("getAskTimeoutMs rejects non-positive values", () => {
  const previous = process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
  process.env.PI_INTERCOM_ASK_TIMEOUT_MS = "0";
  try {
    assert.throws(() => getAskTimeoutMs(), /positive integer/);
  } finally {
    if (previous === undefined) {
      delete process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
    } else {
      process.env.PI_INTERCOM_ASK_TIMEOUT_MS = previous;
    }
  }
});
