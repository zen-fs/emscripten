# ZenFS Emscripten Backend

> [!WARNING]
> This package has not been extensively tested and may not be stable.
>
> If you find a bug, please report it. Thanks!

[ZenFS](https://github.com/zen-fs/core) backend for usage with Emscripten.

For more information, see the [docs](https://zen-fs.github.io/emscripten).

> [!IMPORTANT]
> Please read the ZenFS core documentation!

## Installing

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
