# ZenFS Emscripten Backend

[ZenFS](https://github.com/zen-fs/core) backend for usage with Emscripten.

For more information, see the [docs](https://zenfs.dev/emscripten/).

Please read the ZenFS core documentation!

## Installing

> [!IMPORTANT]
> This project is licensed under the LGPL (v3+).

```sh
npm install @zenfs/emscripten
```

## Usage

```ts
import { configure, fs } from '@zenfs/core';
import { Emscripten } from '@zenfs/emscripten';

// Note: this assumes you have included Emscripten correctly and have the global `FS` variable available.
await configureSingle({ backend: Emscripten, FS: FS });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This is in the Emscripten file system!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

## License

[@zenfs/emscripten](https://github.com/zen-fs/emscripten) is licensed under the [LGPL 3.0 or later](https://www.gnu.org/licenses/lgpl-3.0.html) and [COPYING.md](https://github.com/zen-fs/emscripten/blob/main/COPYING.md).
Copyright © James Prevett and other ZenFS contributors.
