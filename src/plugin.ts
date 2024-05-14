import fs, { parseFlag, type Errno, type Stats } from '@zenfs/core';
import * as emscripten from './emscripten.js';
import { assignWithDefaults, pick } from 'utilium';

class StreamOps implements FS.StreamOps {
	get nodefs(): typeof fs {
		return this._fs.nodefs;
	}

	get FS() {
		return this._fs.FS;
	}

	get PATH() {
		return this._fs.PATH;
	}

	get ERRNO_CODES() {
		return this._fs.ERRNO_CODES;
	}

	constructor(protected _fs: ZenFSEmscriptenNodeFS) {}

	public open(stream: FS.FSStream): void {
		const path = this._fs.realPath(stream.object);
		try {
			if (this.FS.isFile(stream.object.mode)) {
				stream.nfd = this.nodefs.openSync(path, parseFlag(stream.flags));
			}
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}

	public close(stream: FS.FSStream): void {
		try {
			if (this.FS.isFile(stream.object.mode) && stream.nfd) {
				this.nodefs.closeSync(stream.nfd);
			}
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}

	public read(stream: FS.FSStream, buffer: Uint8Array, offset: number, length: number, position: number): number {
		// Avoid copying overhead by reading directly into buffer.
		try {
			return this.nodefs.readSync(stream.nfd, Buffer.from(buffer), offset, length, position);
		} catch (e) {
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}

	public write(stream: FS.FSStream, buffer: Uint8Array, offset: number, length: number, position: number): number {
		// Avoid copying overhead.
		try {
			return this.nodefs.writeSync(stream.nfd, buffer, offset, length, position);
		} catch (e) {
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}

	public llseek(stream: FS.FSStream, offset: number, whence: number): number {
		let position = offset;
		if (whence === 1) {
			// SEEK_CUR.
			position += stream.position;
		} else if (whence === 2) {
			// SEEK_END.
			if (this.FS.isFile(stream.object.mode)) {
				try {
					const stat = this.nodefs.fstatSync(stream.nfd);
					position += stat.size;
				} catch (e) {
					throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
				}
			}
		}

		if (position < 0) {
			throw new this.FS.ErrnoError(this.ERRNO_CODES.EINVAL);
		}

		stream.position = position;
		return position;
	}
}

class EntryOps implements FS.NodeOps {
	get nodefs(): typeof fs {
		return this._fs.nodefs;
	}

	get FS() {
		return this._fs.FS;
	}

	get PATH() {
		return this._fs.PATH;
	}

	get ERRNO_CODES() {
		return this._fs.ERRNO_CODES;
	}

	constructor(protected _fs: ZenFSEmscriptenNodeFS) {}

	public getattr(node: FS.FSNode): Stats {
		const path = this._fs.realPath(node);
		let stat: Stats;
		try {
			stat = this.nodefs.lstatSync(path);
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
		return stat;
	}

	public setattr(node: FS.FSNode, attr: FS.Stats): void {
		const path = this._fs.realPath(node);
		try {
			if (attr.mode !== undefined) {
				this.nodefs.chmodSync(path, attr.mode);
				// update the common node structure mode as well
				node.mode = attr.mode;
			}
			if (attr.timestamp !== undefined) {
				const date = new Date(attr.timestamp);
				this.nodefs.utimesSync(path, date, date);
			}
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			// Ignore not supported errors. Emscripten does utimesSync when it
			// writes files, but never really requires the value to be set.
			if (e.code !== 'ENOTSUP') {
				throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
			}
		}
		if (attr.size !== undefined) {
			try {
				this.nodefs.truncateSync(path, attr.size);
			} catch (e) {
				if (!e.code) {
					throw e;
				}
				throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
			}
		}
	}

	public lookup(parent: FS.FSNode, name: string): FS.FSNode {
		const path = this.PATH.join2(this._fs.realPath(parent), name);
		const mode = this._fs.getMode(path);
		return this._fs.createNode(parent, name, mode);
	}

	public mknod(parent: FS.FSNode, name: string, mode: number, dev: number): FS.FSNode {
		const node = this._fs.createNode(parent, name, mode, dev);
		// create the backing node for this in the fs root as well
		const path = this._fs.realPath(node);
		try {
			if (this.FS.isDir(node.mode)) {
				this.nodefs.mkdirSync(path, node.mode);
			} else {
				this.nodefs.writeFileSync(path, '', { mode: node.mode });
			}
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
		return node;
	}

	public rename(oldNode: FS.FSNode, newDir: FS.FSNode, newName: string): void {
		const oldPath = this._fs.realPath(oldNode);
		const newPath = this.PATH.join2(this._fs.realPath(newDir), newName);
		try {
			this.nodefs.renameSync(oldPath, newPath);
			// This logic is missing from the original NodeFS,
			// causing Emscripten's filesystem to think that the old file still exists.
			oldNode.name = newName;
			oldNode.parent = newDir;
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}

	public unlink(parent: FS.FSNode, name: string): void {
		const path = this.PATH.join2(this._fs.realPath(parent), name);
		try {
			this.nodefs.unlinkSync(path);
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}

	public rmdir(parent: FS.FSNode, name: string) {
		const path = this.PATH.join2(this._fs.realPath(parent), name);
		try {
			this.nodefs.rmdirSync(path);
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}

	public readdir(node: FS.FSNode): string[] {
		const path = this._fs.realPath(node);
		try {
			// Node does not list . and .. in directory listings,
			// but Emscripten expects it.
			const contents = this.nodefs.readdirSync(path);
			contents.push('.', '..');
			return contents;
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}

	public symlink(parent: FS.FSNode, newName: string, oldPath: string): void {
		const newPath = this.PATH.join2(this._fs.realPath(parent), newName);
		try {
			this.nodefs.symlinkSync(oldPath, newPath);
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}

	public readlink(node: FS.FSNode): string {
		const path = this._fs.realPath(node);
		try {
			return this.nodefs.readlinkSync(path, 'utf8');
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
	}
}

export default class ZenFSEmscriptenNodeFS implements emscripten.FS {
	public node_ops: FS.NodeOps = new EntryOps(this);
	public stream_ops: FS.StreamOps = new StreamOps(this);

	public readonly FS: typeof FS;
	public readonly PATH: emscripten.PATH;
	public readonly ERRNO_CODES: typeof Errno;

	constructor(
		emscripten: emscripten.Module,
		public readonly nodefs: typeof fs = fs
	) {
		assignWithDefaults(this, pick(emscripten, 'FS', 'PATH', 'ERRNO_CODES'));
	}

	public mount(mount: emscripten.Mount): emscripten.Node {
		return this.createNode(null, '/', this.getMode(mount.opts.root), 0);
	}

	public createNode(parent: emscripten.Node | null, name: string, mode: number, rdev?: number): emscripten.Node {
		if (!this.FS.isDir(mode) && !this.FS.isFile(mode) && !this.FS.isLink(mode)) {
			throw new this.FS.ErrnoError(this.ERRNO_CODES.EINVAL);
		}
		const node: emscripten.Node = new this.FS.FSNode(parent, name, mode, rdev);
		node.node_ops = this.node_ops;
		node.stream_ops = this.stream_ops;
		return node;
	}

	public getMode(path: string): number {
		let stat: Stats;
		try {
			stat = this.nodefs.lstatSync(path);
		} catch (e) {
			if (!e.code) {
				throw e;
			}
			throw new this.FS.ErrnoError(this.ERRNO_CODES[(e as FS.ErrnoError).code]);
		}
		return stat.mode;
	}

	public realPath(node: emscripten.Node): string {
		const parts: string[] = [];
		while (node.parent !== node) {
			parts.push(node.name);
			node = node.parent;
		}
		parts.push(node.mount.opts.root);
		parts.reverse();
		return this.PATH.join(...parts);
	}
}
