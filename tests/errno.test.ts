// SPDX-License-Identifier: LGPL-3.0-or-later
import { Errno } from 'kerium';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { toEmscriptenErrno } from '@zenfs/emscripten/errno.js';

/** Every distinct value kerium's `Errno` can carry. */
const errnos: number[] = Object.values(Errno).filter(value => typeof value === 'number');

suite('errno translation', () => {
	test('ENOENT becomes the 44 that FS.open looks for', () => {
		assert.equal(toEmscriptenErrno(Errno.ENOENT), 44);
		assert.equal(toEmscriptenErrno(Errno.EACCES), 2);
	});

	test('no errno translates to itself', () => {
		const unchanged = errnos.filter(errno => toEmscriptenErrno(errno) === errno);
		assert.deepEqual(unchanged, []);
	});

	test('translating twice is not translating once', () => {
		const once = toEmscriptenErrno(Errno.EACCES);
		assert.notEqual(toEmscriptenErrno(once), once);
	});

	test('a number that is not an errno is left alone', () => {
		assert.equal(toEmscriptenErrno(9999), 9999);
	});
});
