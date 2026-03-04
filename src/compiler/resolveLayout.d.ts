/**
 * FeedJS Core - Layout Resolution
 *
 * Resolves compile-time layout/template inheritance.
 * Supports:
 * - Page level: <layout src="...">, <extends src="...">, and f:inherit/inherit/extends attrs
 * - Element level inheritance: inherit/extends/f:inherit attributes
 * - Slot/template merging via <slot>, <template name="..."> and <template #name>
 */
import type { FeedAST } from '../ast/nodes.js';
/**
 * Detect and resolve layout/inheritance features.
 */
export declare function resolveLayout(ast: FeedAST, resolveLayoutFile: (src: string) => string): FeedAST;
/**
 * Compile error class
 */
export declare class CompileError extends Error {
    source: string;
    constructor(message: string, source: string);
}
//# sourceMappingURL=resolveLayout.d.ts.map