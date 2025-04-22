import type { Backend, CreationOptions, InodeLike } from '@zenfs/core';
import { FileSystem, Inode, Sync } from '@zenfs/core';
import { basename, dirname } from '@zenfs/core/path.js';
import { S_IFDIR, S_IFREG } from '@zenfs/core/vfs/constants.js';
import { Errno, Exception, strerror } from 'kerium';

/**
 * @hidden
 */
function convertError(e: unknown, path: string = ''): Exception {
	const error = e as FS.ErrnoError & { node?: FS.FSNode };
	const errno = error.errno as Errno;
	let parent = error.node;
	const paths: string[] = [];
	while (parent) {
		paths.unshift(parent.name);
		if (parent === parent.parent) {
			break;
		}
		parent = parent.parent;
	}
	return new Exception(errno, strerror(errno));
}

/**
 * Mounts an Emscripten file system into the ZenFS file system.
 */
export class EmscriptenFS extends Sync(FileSystem) {
	public constructor(
		/**
		 * The Emscripten FS
		 */
		protected em: typeof FS
	) {
		super(0x7761736d, 'wasmfs');
		this.label = 'DB_NAME' in this.em && typeof this.em.DB_NAME == 'function' ? this.em.DB_NAME() : this.name;
	}

	public touchSync(path: string, inode: Partial<InodeLike>): void {
		try {
			const existing = this.em.stat(path);
			if (inode.mode) this.em.chmod(path, inode.mode);
			if (inode.atimeMs) this.em.utime(path, inode.atimeMs, existing.mtime.getTime());
			if (inode.mtimeMs) this.em.utime(path, existing.atime.getTime(), inode.mtimeMs);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public syncSync(): void {}

	public renameSync(oldPath: string, newPath: string): void {
		try {
			this.em.rename(oldPath, newPath);
		} catch (e: any) {
			throw convertError(e, e.errno != Errno.ENOENT ? '' : this.existsSync(oldPath) ? newPath : oldPath);
		}
	}

	public statSync(path: string): Inode {
		try {
			const stats = this.em.stat(path);
			return new Inode({
				mode: stats.mode,
				size: stats.size,
				atimeMs: stats.atime.getTime(),
				mtimeMs: stats.mtime.getTime(),
				ctimeMs: stats.ctime.getTime(),
			});
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public createFileSync(path: string, options: CreationOptions): Inode {
		try {
			const node = this.em.createDataFile(dirname(path), basename(path), new Uint8Array(), true, true, true);
			const stream = new this.em.FSStream();
			stream.object = node;
			return new Inode({ mode: options.mode | S_IFREG });
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public unlinkSync(path: string): void {
		try {
			this.em.unlink(path);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public rmdirSync(path: string): void {
		try {
			this.em.rmdir(path);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public mkdirSync(path: string, options: CreationOptions): Inode {
		try {
			this.em.mkdir(path, options.mode);
			return new Inode({ mode: options.mode | S_IFDIR });
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public readdirSync(path: string): string[] {
		try {
			// Emscripten returns items for '.' and '..'. Node does not.
			return this.em.readdir(path).filter((p: string) => p !== '.' && p !== '..');
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public truncateSync(path: string, len: number): void {
		try {
			this.em.truncate(path, len);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public chmodSync(path: string, mode: number) {
		try {
			this.em.chmod(path, mode);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public chownSync(path: string, new_uid: number, new_gid: number): void {
		try {
			this.em.chown(path, new_uid, new_gid);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public symlinkSync(srcpath: string, dstpath: string): void {
		try {
			this.em.symlink(srcpath, dstpath);
		} catch (e) {
			throw convertError(e);
		}
	}

	/**
	 * Right now this method is just a mask for symlinks
	 * @todo track hard links
	 */
	public linkSync(srcpath: string, dstpath: string): void {
		try {
			this.em.symlink(srcpath, dstpath);
		} catch (e) {
			throw convertError(e);
		}
	}

	public readlinkSync(path: string): string {
		try {
			return this.em.readlink(path);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public utimesSync(path: string, atime: number, mtime: number): void {
		try {
			this.em.utime(path, atime, mtime);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		try {
			const stream = this.em.open(path, 'r');
			this.em.read(stream, buffer, offset, end - offset);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public writeSync(path: string, buffer: Uint8Array, offset: number): void {
		try {
			const stream = this.em.open(path, 'r');
			this.em.write(stream, buffer, offset, buffer.byteLength);
		} catch (e) {
			throw convertError(e, path);
		}
	}
}

/**
 * Configuration options for Emscripten file system.
 */
export interface EmscriptenOptions {
	/**
	 * The Emscripten file system to use
	 */
	FS: typeof FS;
}

const _Emscripten = {
	name: 'Emscripten',

	options: {
		FS: { type: 'object', required: true },
	},

	isAvailable(): boolean {
		return true;
	},

	create(options: EmscriptenOptions) {
		return new EmscriptenFS(options.FS);
	},
} satisfies Backend<EmscriptenFS, EmscriptenOptions>;
type _Emscripten = typeof _Emscripten;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Emscripten extends _Emscripten {}
export const Emscripten: Emscripten = _Emscripten;
