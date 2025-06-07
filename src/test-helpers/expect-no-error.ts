import { expect } from "vitest";
import type { Ok, Result } from "../config";

export function expectNoError<T, U>(
  value: Result<T, U>,
): asserts value is Ok<T> {
  if (!value.ok) {
    console.error(`Expected to be OK, got ${JSON.stringify(value.error)}`);
  }
  expect(value.ok).toBeTruthy();
}
