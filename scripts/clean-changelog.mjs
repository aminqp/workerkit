#!/usr/bin/env node
/**
 * release-it hook: removes git trailers ("Co-Authored-By: …",
 * "Signed-off-by: …") from CHANGELOG.md.
 *
 * The changelog preset treats every line after "BREAKING CHANGE:" as part of
 * the breaking-change note, and git trailers have to come last in a commit
 * message — so without this they would be published in the changelog.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../CHANGELOG.md', import.meta.url);
const text = readFileSync(file, 'utf8');
const cleaned = text.replace(
  /^[ \t]*(Co-Authored-By|Signed-off-by):.*\r?\n/gim,
  '',
);
if (cleaned !== text) writeFileSync(file, cleaned);
