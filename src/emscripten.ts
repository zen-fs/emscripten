// SPDX-License-Identifier: LGPL-3.0-or-later
/*
	This is for types only.
	By exporting a named export, and using `import type`, we avoid build errors
*/

import 'emscripten';

import EmFS = FS;

export type { EmFS };
