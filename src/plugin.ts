import zfs, { Errno, parseFlag, type Stats } from '@zenfs/core';
import type { EmFS } from './emscripten.js';

interface Mount extends EmFS.Mount {
	opts: { root?: string };
}

interface Node extends EmFS.FSNode {
	node_ops?: EmFS.NodeOps;
	stream_ops?: EmFS.StreamOps;
	mount: Mount;
	parent: Node;
}

interface EmscriptenNodeFS {
	node_ops: EmFS.NodeOps;
	stream_ops: EmFS.StreamOps;
	mount(mount: EmFS.Mount & { opts: { root: string } }): EmFS.FSNode;
	createNode(parent: EmFS.FSNode, name: string, mode: number, dev?: unknown): EmFS.FSNode;
	getMode(path: string): number;
	realPath(node: EmFS.FSNode): string;
}

/**
 * Defines an Emscripten file system object for use in the Emscripten virtual filesystem.
 * Allows you to use synchronous file systems from within Emscripten.
 *
 * You can construct this, mount it using its mount command, and then mount it into Emscripten.
 *
 * Adapted from Emscripten's NodeFS:
 * @see https://github.com/emscripten-core/emscripten/blob/main/src/library_nodefs.js
 */
export default class ZenEmscriptenNodeFS implements EmscriptenNodeFS {
	constructor(
		public readonly fs: typeof zfs = zfs,
		public readonly em_fs: typeof EmFS,
		protected path: {
			join(...parts: string[]): string;
			join2(a: string, b: string): string;
		}
	) {}

	public mount(mount: Mount): Node {
		return this.createNode(null, '/', this.getMode(mount.opts.root!), 0);
	}

	public createNode(parent: Node | null, name: string, mode: number, rdev?: number): Node {
		if (!this.em_fs.isDir(mode) && !this.em_fs.isFile(mode) && !this.em_fs.isLink(mode)) {
			throw new this.em_fs.ErrnoError(Errno.EINVAL);
		}
		const node: Node = new this.em_fs.FSNode(parent!, name, mode, rdev!);
		node.node_ops = this.node_ops;
		node.stream_ops = this.stream_ops;
		return node;
	}

	public getMode(path: string): number {
		let stat: Stats;
		try {
			stat = this.fs.lstatSync(path);
		} catch (e: any) {
			if (!e.code) {
				throw e;
			}
			throw new this.em_fs.ErrnoError(e.errno);
		}
		return stat.mode;
	}

	public realPath(node: Node): string {
		const parts: string[] = [];
		while (node.parent !== node) {
			parts.push(node.name);
			node = node.parent;
		}
		parts.push(node.mount.opts.root!);
		parts.reverse();
		return this.path.join(...parts);
	}

	public node_ops: EmFS.NodeOps = {
		getattr: (node: EmFS.FSNode): Stats => {
			const path = this.realPath(node);
			let stat: Stats;
			try {
				stat = this.fs.lstatSync(path);
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
			return stat;
		},

		setattr: (node: EmFS.FSNode, attr: EmFS.Stats): void => {
			const path = this.realPath(node);
			try {
				if (attr.mode !== undefined) {
					this.fs.chmodSync(path, attr.mode);
					// update the common node structure mode as well
					node.mode = attr.mode;
				}
				if (attr.timestamp !== undefined) {
					const date = new Date(attr.timestamp);
					this.fs.utimesSync(path, date, date);
				}
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				// Ignore not supported errors. Emscripten does utimesSync when it
				// writes files, but never really requires the value to be set.
				if (e.code !== 'ENOTSUP') {
					throw new this.em_fs.ErrnoError(e.errno);
				}
			}
			if (attr.size !== undefined) {
				try {
					this.fs.truncateSync(path, attr.size);
				} catch (e: any) {
					if (!e.code) {
						throw e;
					}
					throw new this.em_fs.ErrnoError(e.errno);
				}
			}
		},

		lookup: (parent: EmFS.FSNode, name: string): EmFS.FSNode => {
			const path = this.path.join2(this.realPath(parent), name);
			const mode = this.getMode(path);
			return this.createNode(parent, name, mode);
		},

		mknod: (parent: EmFS.FSNode, name: string, mode: number, dev: number): EmFS.FSNode => {
			const node = this.createNode(parent, name, mode, dev);
			// create the backing node for this in the fs root as well
			const path = this.realPath(node);
			try {
				if (this.em_fs.isDir(node.mode)) {
					this.fs.mkdirSync(path, node.mode);
				} else {
					this.fs.writeFileSync(path, '', { mode: node.mode });
				}
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
			return node;
		},

		rename: (oldNode: EmFS.FSNode, newDir: EmFS.FSNode, newName: string): void => {
			const oldPath = this.realPath(oldNode);
			const newPath = this.path.join2(this.realPath(newDir), newName);
			try {
				this.fs.renameSync(oldPath, newPath);
				// This logic is missing from the original NodeFS,
				// causing Emscripten's filesystem to think that the old file still exists.
				oldNode.name = newName;
				oldNode.parent = newDir;
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},

		unlink: (parent: EmFS.FSNode, name: string): void => {
			const path = this.path.join2(this.realPath(parent), name);
			try {
				this.fs.unlinkSync(path);
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},

		rmdir: (parent: EmFS.FSNode, name: string) => {
			const path = this.path.join2(this.realPath(parent), name);
			try {
				this.fs.rmdirSync(path);
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},

		readdir: (node: EmFS.FSNode): string[] => {
			const path = this.realPath(node);
			try {
				// Node does not list . and .. in directory listings,
				// but Emscripten expects it.
				const contents = this.fs.readdirSync(path);
				contents.push('.', '..');
				return contents;
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},

		symlink: (parent: EmFS.FSNode, newName: string, oldPath: string): void => {
			const newPath = this.path.join2(this.realPath(parent), newName);
			try {
				this.fs.symlinkSync(oldPath, newPath);
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},

		readlink: (node: EmFS.FSNode): string => {
			const path = this.realPath(node);
			try {
				return this.fs.readlinkSync(path, 'utf8');
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},
	};
	public stream_ops: EmFS.StreamOps = {
		open: (stream: EmFS.FSStream): void => {
			const path = this.realPath(stream.object);
			try {
				if (this.em_fs.isFile(stream.object.mode)) {
					stream.nfd = this.fs.openSync(path, parseFlag(stream.flags));
				}
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},
		close: (stream: EmFS.FSStream): void => {
			try {
				if (this.em_fs.isFile(stream.object.mode) && stream.nfd) {
					this.fs.closeSync(stream.nfd);
				}
			} catch (e: any) {
				if (!e.code) {
					throw e;
				}
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},
		read: (stream: EmFS.FSStream, buffer: Uint8Array, offset: number, length: number, position: number): number => {
			// Avoid copying overhead by reading directly into buffer.
			try {
				return this.fs.readSync(stream.nfd!, Buffer.from(buffer), offset, length, position);
			} catch (e: any) {
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},
		write: (stream: EmFS.FSStream, buffer: Uint8Array, offset: number, length: number, position: number): number => {
			// Avoid copying overhead.
			try {
				return this.fs.writeSync(stream.nfd!, buffer, offset, length, position);
			} catch (e: any) {
				throw new this.em_fs.ErrnoError(e.errno);
			}
		},
		llseek: (stream: EmFS.FSStream, offset: number, whence: number): number => {
			let position = offset;
			if (whence === 1) {
				// SEEK_CUR.
				position += stream.position;
			} else if (whence === 2 && this.em_fs.isFile(stream.object.mode)) {
				// SEEK_END.
				try {
					position += this.fs.fstatSync(stream.nfd!).size;
				} catch (e: any) {
					throw new this.em_fs.ErrnoError(e.errno);
				}
			}

			if (position < 0) {
				throw new this.em_fs.ErrnoError(Errno.EINVAL);
			}

			stream.position = position;
			return position;
		},
	};
}
