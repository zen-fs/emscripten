/**
 * Defines an Emscripten file system object for use in the Emscripten virtual
 * filesystem. Allows you to use synchronous BrowserFS file systems from within
 * Emscripten.
 *
 * You can construct a BFSEmscriptenFS, mount it using its mount command,
 * and then mount it into Emscripten.
 *
 * Adapted from Emscripten's NodeFS:
 * https://raw.github.com/kripken/emscripten/master/src/library_nodefs.js
 */
import type { Errno } from '@zenfs/core';
import 'emscripten'; // Note: this is for types only.

export interface Mount extends FS.Mount { 
	opts: { root?: string };
}

export declare class Node extends FS.FSNode {
	node_ops?: FS.NodeOps;
	stream_ops?: FS.StreamOps;
	mount: Mount;
	parent: Node;
}

export interface PATH {
	join(...parts: string[]): string;
	join2(a: string, b: string): string;
}

export interface Module {
	FS: typeof FS;
	PATH: PATH;
	ERRNO_CODES: typeof Errno;
}

export interface FS {
	node_ops: FS.NodeOps;
	stream_ops: FS.StreamOps;
	mount(mount: FS.Mount & { opts: { root: string } }): FS.FSNode;
	createNode(parent: FS.FSNode, name: string, mode: number, dev?: unknown): FS.FSNode;
	getMode(path: string): number;
	realPath(node: FS.FSNode): string;
}
