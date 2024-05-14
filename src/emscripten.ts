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

export interface Stats {
	dev: number;
	ino: number;
	mode: number;
	nlink: number;
	uid: number;
	gid: number;
	rdev: number;
	size: number;
	blksize: number;
	blocks: number;
	atime: Date;
	mtime: Date;
	ctime: Date;
	timestamp?: number;
}

export interface NodeOps {
	getattr(node: FS.FSNode): Stats;
	setattr(node: FS.FSNode, attr: Stats): void;
	lookup(parent: FS.FSNode, name: string): FS.FSNode;
	mknod(parent: FS.FSNode, name: string, mode: number, dev: unknown): FS.FSNode;
	rename(oldNode: FS.FSNode, newDir: FS.FSNode, newName: string): void;
	unlink(parent: FS.FSNode, name: string): void;
	rmdir(parent: FS.FSNode, name: string): void;
	readdir(node: FS.FSNode): string[];
	symlink(parent: FS.FSNode, newName: string, oldPath: string): void;
	readlink(node: FS.FSNode): string;
}

export declare class Node extends FS.FSNode {
	node_ops?: NodeOps;
	stream_ops?: StreamOps;
}

export interface StreamOps {
	open(stream: FS.FSStream): void;
	close(stream: FS.FSStream): void;
	read(stream: FS.FSStream, buffer: Uint8Array, offset: number, length: number, position: number): number;
	write(stream: FS.FSStream, buffer: Uint8Array, offset: number, length: number, position: number): number;
	llseek(stream: FS.FSStream, offset: number, whence: number): number;
}

export declare class Stream extends FS.FSStream {
	fd?: number;
	nfd?: number;
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

export interface Plugin {
	node_ops: NodeOps;
	stream_ops: StreamOps;
	mount(mount: { opts: { root: string } }): FS.FSNode;
	createNode(parent: FS.FSNode, name: string, mode: number, dev?: unknown): FS.FSNode;
	getMode(path: string): number;
	realPath(node: FS.FSNode): string;
}
