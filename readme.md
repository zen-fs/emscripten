# ZenFS Emscripten Backend

[ZenFS](https://github.com/zen-fs/core) backend for usage with Emscripten.

> [!IMPORTANT]
> Please read the ZenFS core documentation!

For more information, see the [docs](https://zen-fs.github.io/emscripten).

## Installing

```sh
npm install @zenfs/emscripten
```

## Usage

> [!NOTE]
> The examples are written in ESM.  
> For CJS, you can `require` the package.  
> For a browser environment without support for `type=module` in `script` tags, you can add a `script` tag to your HTML pointing to the `browser.min.js` and use the global `ZenFS_Emscripten` object.

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
