import { FileSystemMetadata, Sync, FileSystem } from '@zenfs/core/filesystem.js';
import { Stats, FileType } from '@zenfs/core/stats.js';
import { File } from '@zenfs/core/file.js';
import { ErrnoError, Errno, errorMessages } from '@zenfs/core/error.js';
import { Cred } from '@zenfs/core/cred.js';
import { Buffer } from 'buffer';
import type { Backend } from '@zenfs/core';
import * as emscripten from './emscripten.js';
import { basename, dirname } from '@zenfs/core/emulation/path.js';

/**
 * @hidden
 */
function convertError(e: FS.ErrnoError & { node?: FS.FSNode }, path: string = ''): ErrnoError {
	const errno = e.errno;
	let parent = e.node;
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

export class EmscriptenFile extends File {
	constructor(
		protected _fs: EmscriptenFS,
		protected _FS: typeof FS,
		public readonly path: string,
		protected _stream: emscripten.Stream
	) {
		super();
	}
	public get position(): number {
		return;
	}
	public async close(): Promise<void> {
		return this.closeSync();
	}
	public closeSync(): void {
		try {
			this._FS.close(this._stream);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}
	public async stat(): Promise<Stats> {
		return this.statSync();
	}
	public statSync(): Stats {
		try {
			return this._fs.statSync(this.path);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}
	public async truncate(len: number): Promise<void> {
		return this.truncateSync(len);
	}
	public truncateSync(len: number): void {
		try {
			this._FS.ftruncate(this._stream.fd, len);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}
	public async write(buffer: Buffer, offset: number, length: number, position: number): Promise<number> {
		return this.writeSync(buffer, offset, length, position);
	}
	public writeSync(buffer: Buffer, offset: number, length: number, position: number | null): number {
		try {
			// Emscripten is particular about what position is set to.
			const emPosition = position === null ? undefined : position;
			return this._FS.write(this._stream, buffer, offset, length, emPosition);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}
	public async read<TBuffer extends ArrayBufferView>(buffer: TBuffer, offset: number, length: number, position: number): Promise<{ bytesRead: number; buffer: TBuffer }> {
		return { bytesRead: this.readSync(buffer, offset, length, position), buffer };
	}
	public readSync(buffer: ArrayBufferView, offset: number, length: number, position: number | null): number {
		try {
			// Emscripten is particular about what position is set to.
			const emPosition = position === null ? undefined : position;
			return this._FS.read(this._stream, buffer, offset, length, emPosition);
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
			this._FS.fchown(this._stream.fd, uid, gid);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}
	public async chmod(mode: number): Promise<void> {
		return this.chmodSync(mode);
	}
	public chmodSync(mode: number): void {
		try {
			this._FS.fchmod(this._stream.fd, mode);
		} catch (e) {
			throw convertError(e, this.path);
		}
	}
	public async utimes(atime: Date, mtime: Date): Promise<void> {
		return this.utimesSync(atime, mtime);
	}
	public utimesSync(atime: Date, mtime: Date): void {
		this._fs.utimesSync(this.path, atime, mtime);
	}
	public async _setType(type: FileType): Promise<void> {
		throw ErrnoError.With('ENOSYS', this.path, '_setType');
	}
	public _setTypeSync(type: FileType): void {
		throw ErrnoError.With('ENOSYS', this.path, '_setType');
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

/**
 * Mounts an Emscripten file system into the BrowserFS file system.
 */
export class EmscriptenFS extends Sync(FileSystem) {
	public constructor(
		/**
		 * The Emscripten FS
		 */
		protected em: typeof FS
	) {
		super();
	}

	public metadata(): FileSystemMetadata {
		const name = 'DB_NAME' in this.em && typeof this.em.DB_NAME == 'function' ? this.em.DB_NAME() : super.metadata().name;
		return {
			...super.metadata(),
			name,
		};
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		try {
			this.em.writeFile(path, data);
			this.em.chmod(path, stats.mode);
		} catch (e) {
			throw convertError(e, path);
		}
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		try {
			this.em.rename(oldPath, newPath);
		} catch (e) {
			throw convertError(e, e.errno != Errno.ENOENT ? '' : this.existsSync(oldPath, cred) ? newPath : oldPath);
		}
	}

	public statSync(path: string): Stats {
		try {
			const stats = this.em.stat(path);
			const itemType = this.modeToFileType(stats.mode);
			return new Stats({
				mode: itemType | stats.mode,
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

	public utimesSync(path: string, atime: Date, mtime: Date): void {
		try {
			this.em.utime(path, atime.getTime(), mtime.getTime());
		} catch (e) {
			throw convertError(e, path);
		}
	}

	private modeToFileType(mode: number): FileType {
		if (this.em.isDir(mode)) {
			return FileType.DIRECTORY;
		} else if (this.em.isFile(mode)) {
			return FileType.FILE;
		} else if (this.em.isLink(mode)) {
			return FileType.SYMLINK;
		} else {
			throw new ErrnoError(Errno.EPERM, 'Invalid mode: ' + mode);
		}
	}
}

export const Emscripten = {
	name: 'EmscriptenFileSystem',

	options: {
		FS: {
			type: 'object',
			required: true,
			description: 'The Emscripten file system to use (the `FS` variable)',
		},
	},

	isAvailable(): boolean {
		return true;
	},

	create(options: EmscriptenOptions) {
		return new EmscriptenFS(options.FS);
	},
} satisfies Backend<EmscriptenFS, EmscriptenOptions>;
