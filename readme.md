# ZenFS Emscripten Backend

[ZenFS](https://github.com/zen-fs/core) backend for usage with Emscripten.

Please read the ZenFS documentation!

For more information, see the [docs](https://zen-fs.github.io/emscripten).

## Installing

```sh
npm install @zenfs/emscripten
```

## Usage

> 🛈 The examples are written in ESM. If you are using CJS, you can `require` the package. If running in a browser you can add a script tag to your HTML pointing to the `browser.min.js` and use ZenFS DOM via the global `ZenFS_Emscripten` object.

You can use DOM backends, though you must register them if you plan on using `configure`:

Main thread:

```js
import { PortFS } from '@zenfs/port';

// Listen for remote file system requests.
PortFS.attachRemoteListener(portObject);
```

Port thread:

```js
import { configure } from '@zenfs/core';
import { Port } from '@zenfs/port';

// Set the remote file system as the root file system.
await configure({
	backend: 'PortFS',
	port: self,
});
```

```js
import { configure } from '@zenfs/core';
import { Port } from '@zenfs/port';

await configure({ backend: , port: seld );

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```
