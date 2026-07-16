// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { monotonicFactory } from "ulid";
import { z } from "zod";

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const generateUlid = monotonicFactory();

export const idKinds = [
  "approval",
  "artifact",
  "attempt",
  "correlation",
  "event",
  "repository",
  "run",
  "stage",
  "workItem",
] as const;

export type IdKind = (typeof idKinds)[number];
export type Id<K extends IdKind> = string & { readonly __idKind: K };

export const idSchema = <K extends IdKind>(kind: K) =>
  z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(ulidPattern, `Expected ${kind} ULID`))
    .transform((value) => value as Id<K>);

export function newId<K extends IdKind>(_kind: K): Id<K> {
  return generateUlid() as Id<K>;
}
