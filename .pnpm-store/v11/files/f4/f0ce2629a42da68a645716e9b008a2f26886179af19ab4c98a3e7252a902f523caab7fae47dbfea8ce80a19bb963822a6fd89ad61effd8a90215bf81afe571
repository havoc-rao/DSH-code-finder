export * from "./types";
export type Target = {
    url: string;
    label: string;
};
export type Targets = {
    [k: string]: Target;
};
export declare const allTargets: Targets;
export declare const isMac: boolean;
export declare const altTitle: string;
export declare const shiftTitle: string;
export declare const ctrlTitle: string;
export declare const metaTitle: string;
export declare const modifiersTitles: {
    alt: string;
    ctrl: string;
    meta: string;
    shift: string;
};
export declare function getModifiersMap(modifiersString: string): {
    [key: string]: true;
};
export declare function getModifiersString(modifiersMap: {
    [key: string]: true;
}): string;
export declare function detectSvelte(): boolean;
export declare function detectVue(): boolean;
export declare function detectJSX(): boolean;
export declare function detectReact(): boolean;
export type SourceLocation = {
    start: {
        line: number;
        column: number;
    };
    end: {
        line: number;
        column: number;
    };
};
export type ComponentInfo = {
    name: string;
    loc: SourceLocation | null;
};
export type ExpressionInfo = {
    name: string;
    loc: SourceLocation;
    wrappingComponentId: number | null;
};
export type StyledDefinitionInfo = {
    name: string | null;
    loc: SourceLocation;
    htmlTag: string;
};
export type FileStorage = {
    filePath: string;
    projectPath: string;
    expressions: ExpressionInfo[];
    styledDefinitions: StyledDefinitionInfo[];
    components: ComponentInfo[];
};
export * from "./sharedOptionsStore";
//# sourceMappingURL=index.d.ts.map