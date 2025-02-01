import { Errno, File, FileSystem, ErrnoError, errorMessages, Sync, type Backend, type CreationOptions } from '@zenfs/core';
import { basename, dirname } from '@zenfs/core/vfs/path.js';
import { Stats, type StatsLike } from '@zenfs/core/stats.js';
import type { Buffer } from 'buffer';

/**
 * @hidden
 */
function convertError(e: unknown, path: string = ''): ErrnoError {
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
	return new ErrnoError(errno, errorMessages[errno], paths.length > 0 ? '/' + paths.join('/') : path);
}

export class EmscriptenFile extends File<EmscriptenFS> {
	public constructor(
		public fs: EmscriptenFS,
		protected em: typeof FS,
		public readonly path: string,
		protected stream: FS.FSStream
	) {
		super(fs, path);
	}

	public get position(): number {
		return this.stream.position;
	}

	public async close(): Promise<void> {
		return this.closeSync();
	}

	public closeSync(): void {
		try {
			this.em.close(this.stream);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}

	public async stat(): Promise<Stats> {
		return this.statSync();
	}

	public statSync(): Stats {
		try {
			return this.fs.statSync(this.path);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}

	public async truncate(len: number): Promise<void> {
		return this.truncateSync(len);
	}

	public truncateSync(len: number): void {
		try {
			this.em.ftruncate(this.stream.fd!, len);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}

	public async write(buffer: Buffer, offset: number, length: number, position: number): Promise<number> {
		return this.writeSync(buffer, offset, length, position);
	}

	public writeSync(buffer: Buffer, offset: number, length: number, position?: number): number {
		try {
			// Emscripten is particular about what position is set to.
			return this.em.write(this.stream, buffer, offset, length, position);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}

	public async read<TBuffer extends ArrayBufferView>(buffer: TBuffer, offset: number, length: number, position: number): Promise<{ bytesRead: number; buffer: TBuffer }> {
		return { bytesRead: this.readSync(buffer, offset, length, position), buffer };
	}

	public readSync(buffer: ArrayBufferView, offset: number, length: number, position?: number): number {
		try {
			// Emscripten is particular about what position is set to.
			return this.em.read(this.stream, buffer, offset, length, position);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}

	public async sync(): Promise<void> {
		this.syncSync();
	}

	public syncSync(): void {
		// NOP.
	}

	public async chown(uid: number, gid: number): Promise<void> {
		return this.chownSync(uid, gid);
	}

	public chownSync(uid: number, gid: number): void {
		try {
			this.em.fchown(this.stream.fd!, uid, gid);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}

	public async chmod(mode: number): Promise<void> {
		return this.chmodSync(mode);
	}

	public chmodSync(mode: number): void {
		try {
			this.em.fchmod(this.stream.fd!, mode);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}

	public async utimes(atime: number, mtime: number): Promise<void> {
		return this.utimesSync(atime, mtime);
	}

	public utimesSync(atime: number, mtime: number): void {
		this.fs.utimesSync(this.path, atime, mtime);
	}

	public async _setType(): Promise<void> {
		throw ErrnoError.With('ENOSYS', this.path, '_setType');
	}

	public _setTypeSync(): void {
		throw ErrnoError.With('ENOSYS', this.path, '_setType');
	}
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

	public syncSync(path: string, data?: Uint8Array, stats: Readonly<Partial<Stats>> = {}): void {
		try {
			if (data) this.em.writeFile(path, data);
			if (stats.mode) this.em.chmod(path, stats.mode);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public renameSync(oldPath: string, newPath: string): void {
		try {
			this.em.rename(oldPath, newPath);
		} catch (e: any) {
			throw convertError(e, e.errno != Errno.ENOENT ? '' : this.existsSync(oldPath) ? newPath : oldPath);
		}
	}

	public statSync(path: string): Stats {
		try {
			const stats = this.em.stat(path);
			return new Stats({
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

	public createFileSync(path: string): EmscriptenFile {
		try {
			const node = this.em.createDataFile(dirname(path), basename(path), new Uint8Array(), true, true, true);
			const stream = new this.em.FSStream();
			stream.object = node;
			return new EmscriptenFile(this, this.em, path, stream);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public openFileSync(path: string, flag: string): EmscriptenFile {
		try {
			const stream = this.em.open(path, flag);
			return new EmscriptenFile(this, this.em, path, stream);
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

	public mkdirSync(path: string, mode: number): void {
		try {
			this.em.mkdir(path, mode);
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
