import type { NodePath, Visitor } from "@babel/traverse";
import type * as BabelTypes from "@babel/types";
export interface PluginOptions {
    opts?: {
        env?: string;
        target?: string;
        runtime?: string;
        ignoreComponentNames?: string[];
        dataAttribute?: "id" | "path";
    };
    file: {
        path: NodePath;
    };
    filename: string;
    cwd: string;
}
export interface Babel {
    types: typeof BabelTypes;
    env: () => string;
}
export default function transformLocatorJsComponents(babel: Babel): {
    visitor?: Visitor<PluginOptions>;
};
//# sourceMappingURL=index.d.ts.map