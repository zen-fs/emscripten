// SPDX-License-Identifier: LGPL-3.0-or-later
import { InMemory, fs, mount } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import type { EmFS } from '@zenfs/emscripten/emscripten.js';
import EmscriptenPlugin from '@zenfs/emscripten/plugin.js';

// Simulate some of the stuff from emscripten so we don't have to do some weird extraction

class ErrnoError extends Error {
	public errno: number;

	public constructor(errno: number) {
		super('errno ' + errno);
		this.errno = errno;
	}
}

let nextId = 0;

class FSNode {
	public id = ++nextId;
	public mount?: { opts: { root: string } };
	public parent: FSNode;
	public name: string;
	public mode: number;
	public rdev: number;

	public constructor(parent: FSNode, name: string, mode: number, rdev: number) {
		this.parent = parent ?? this;
		this.name = name;
		this.mode = mode;
		this.rdev = rdev;
	}
}

const hashed: EmFS.FSNode[] = [];

// FS.nameTable and friends, straight out of emscripten's src/lib/libfs.js, since
// what the cache is worth can't be seen without the thing that reads it.
type Cached = EmFS.FSNode & { name_next?: Cached; id: number };
const nameTable: (Cached | undefined)[] = new Array(4096);

function hashName(parentid: number, name: string): number {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
	}
	return ((parentid + hash) >>> 0) % nameTable.length;
}

const em_fs = {
	ErrnoError,
	FSNode,
	isDir: (mode: number) => (mode & 0o170000) === 0o040000,
	isFile: (mode: number) => (mode & 0o170000) === 0o100000,
	isLink: (mode: number) => (mode & 0o170000) === 0o120000,
	hashAddNode: (node: EmFS.FSNode) => {
		hashed.push(node);
		const cached = node as Cached;
		const hash = hashName(cached.parent.id as unknown as number, cached.name);
		cached.name_next = nameTable[hash];
		nameTable[hash] = cached;
	},
} as unknown as typeof EmFS;

mount('/zen', InMemory.create({ label: 'plugin-test' }));
fs.mkdirSync('/zen/root');
fs.writeFileSync('/zen/root/present.txt', 'hello');

const plugin = new EmscriptenPlugin(fs, em_fs);

/** The mounted root, wired the way `FS.mount()` wires it. */
function rooted(): EmFS.FSNode {
	const node = plugin.mount({ opts: { root: '/zen/root' } } as EmFS.Mount & { opts: { root: string } });
	(node as unknown as FSNode).mount = { opts: { root: '/zen/root' } };
	return node;
}

/** The errno an operation raised, or `undefined` if it did not raise one. */
function errnoOf(fn: () => unknown): number | undefined {
	try {
		fn();
	} catch (e) {
		assert.ok(e instanceof ErrnoError, 'expected an Emscripten ErrnoError, got ' + String(e));
		return e.errno;
	}
	return undefined;
}

suite('errnos crossing into Emscripten', () => {
	test('a missing path is 44, which is what Emscripten calls ENOENT', () => {
		assert.equal(
			errnoOf(() => plugin.getMode('/zen/root/absent.txt')),
			44
		);
	});

	test('a mount root that is not there says so', () => {
		assert.equal(
			errnoOf(() => plugin.mount({ opts: { root: '/zen/absent' } } as EmFS.Mount & { opts: { root: string } })),
			44
		);
	});

	test('looking up a name that is not there is 44 as well', () => {
		const root = rooted();
		assert.equal(
			errnoOf(() => plugin.node_ops.lookup(root, 'absent.txt')),
			44
		);
	});

	test('an unusable mode is 28, which is what Emscripten calls EINVAL', () => {
		assert.equal(
			errnoOf(() => plugin.createNode(null, 'odd', 0)),
			28
		);
	});

	test('and a file that is there still resolves', () => {
		const root = rooted();
		const node = plugin.node_ops.lookup(root, 'present.txt');
		assert.equal(plugin.node_ops.getattr(node).size, 5);
	});
});

/** FS.lookupNode: the table first, node_ops.lookup only when it misses. */
function lookupNode(parent: Cached, name: string): Cached {
	for (let node = nameTable[hashName(parent.id, name)]; node; node = node.name_next) {
		if ((node.parent as unknown as Cached).id === parent.id && node.name === name) return node;
	}
	return plugin.node_ops.lookup(parent, name) as Cached;
}

/** And FS.lookupPath, for a path with no symlinks or mounts in it. */
function resolve(root: Cached, path: string): Cached {
	let current = root;
	for (const part of path.split('/')) current = lookupNode(current, part);
	return current;
}

suite("Emscripten's lookup cache", () => {
	test('a created node is hashed into it #7', () => {
		const node = plugin.createNode(null, 'hashed.txt', 0o100644);
		assert.ok(hashed.includes(node));
	});

	test('a resolved path is resolved once, not once per resolution #7', () => {
		fs.mkdirSync('/zen/root/a/b/c/d', { recursive: true });
		fs.writeFileSync('/zen/root/a/b/c/d/leaf.txt', 'x');

		const root = rooted() as Cached;
		(root as unknown as FSNode).mount = { opts: { root: '/zen/root' } };

		let lookups = 0;
		const real = plugin.node_ops.lookup;
		plugin.node_ops.lookup = (parent: EmFS.FSNode, name: string) => {
			lookups++;
			return real.call(plugin.node_ops, parent, name);
		};

		try {
			for (let i = 0; i < 100; i++) resolve(root, 'a/b/c/d/leaf.txt');
		} finally {
			plugin.node_ops.lookup = real;
		}

		assert.equal(lookups, 5, '5 components, resolved once each — not 500');
	});
});
