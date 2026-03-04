/**
 * FeedJS Core - Layout Resolution
 *
 * Resolves compile-time layout/template inheritance.
 * Supports:
 * - Page level: <layout src="...">, <extends src="...">, and f:inherit/inherit/extends attrs
 * - Element level inheritance: inherit/extends/f:inherit attributes
 * - Slot/template merging via <slot>, <template name="..."> and <template #name>
 */
import { parseTemplate } from '../parser/htmlParser.js';
const INHERIT_ATTRS = ['inherit', 'extends', 'f:inherit'];
/**
 * Detect and resolve layout/inheritance features.
 */
export function resolveLayout(ast, resolveLayoutFile) {
    const inheritedNodes = processInherit(ast.nodes, resolveLayoutFile);
    const binding = findLayoutBinding(inheritedNodes);
    if (!binding) {
        return {
            type: 'FeedAST',
            nodes: inheritedNodes,
            source: ast.source,
        };
    }
    const layoutContent = loadTemplate(binding.src, ast.source, resolveLayoutFile);
    const parsedLayout = parseTemplate(layoutContent);
    // Resolve nested layout chains in the base layout itself.
    const resolvedBase = resolveLayout(parsedLayout, resolveLayoutFile);
    const siblingContent = inheritedNodes.filter((_, i) => i !== binding.index);
    const slotMap = collectSlotContent(binding.children);
    const defaultContent = [
        ...siblingContent,
        ...stripSlotDeclarationNodes(binding.children),
    ];
    const mergedNodes = injectSlots(resolvedBase.nodes, slotMap, defaultContent, ast.source);
    return {
        type: 'FeedAST',
        nodes: mergedNodes,
        source: ast.source,
    };
}
function loadTemplate(src, source, resolveLayoutFile) {
    try {
        return resolveLayoutFile(src);
    }
    catch (error) {
        console.error(`Error resolving template file: ${src}`, error);
        throw new CompileError(`Failed to load template file: ${src}`, source);
    }
}
function findLayoutBinding(nodes) {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node || node.type !== 'Element')
            continue;
        const src = getLayoutSrcFromTag(node) ??
            node.attributes['layout'] ??
            node.attributes['extends'] ??
            node.attributes['f:inherit'];
        if (!src)
            continue;
        if (isLayoutTag(node.tag) || node.attributes['layout'] || node.attributes['extends'] || node.attributes['f:inherit']) {
            return {
                src,
                children: node.children || [],
                index: i,
            };
        }
    }
    return null;
}
function isLayoutTag(tag) {
    return tag === 'layout' || tag === 'feedjs-layout' || tag === 'extends';
}
function getLayoutSrcFromTag(node) {
    if (!isLayoutTag(node.tag))
        return undefined;
    return node.attributes['src'];
}
function processInherit(nodes, resolveLayoutFile) {
    return nodes.map((node) => processNodeInherit(node, resolveLayoutFile));
}
function processNodeInherit(node, resolveLayoutFile) {
    if (node.type !== 'Element') {
        return node;
    }
    const processedChildren = processInherit(node.children || [], resolveLayoutFile);
    const currentNode = {
        ...node,
        children: processedChildren,
    };
    const inheritSrc = getInheritSrc(currentNode);
    if (!inheritSrc) {
        return currentNode;
    }
    const inheritedContent = loadTemplate(inheritSrc, '', resolveLayoutFile);
    const inheritedAST = resolveLayout(parseTemplate(inheritedContent), resolveLayoutFile);
    const inheritedRoot = inheritedAST.nodes.find((n) => n.type === 'Element' && n.tag === currentNode.tag) ??
        inheritedAST.nodes.find((n) => n.type === 'Element');
    if (!inheritedRoot) {
        throw new CompileError(`Inherited template has no root element: ${inheritSrc}`, '');
    }
    const inheritedProcessed = {
        ...inheritedRoot,
        children: processInherit(inheritedRoot.children || [], resolveLayoutFile),
    };
    return mergeInheritedElement(inheritedProcessed, currentNode);
}
function getInheritSrc(node) {
    for (const attr of INHERIT_ATTRS) {
        const value = node.attributes[attr];
        if (value)
            return value;
    }
    return undefined;
}
function mergeInheritedElement(base, current) {
    const attributes = {
        ...base.attributes,
        ...current.attributes,
    };
    for (const attr of INHERIT_ATTRS) {
        delete attributes[attr];
    }
    const directives = mergeDirectives(base.directives || [], current.directives || []);
    const providedSlots = collectSlotContent(current.children || []);
    const defaultContent = stripSlotDeclarationNodes(current.children || []);
    let children = injectSlots(base.children || [], providedSlots, defaultContent, '');
    if (children.length === 0) {
        children = defaultContent.length > 0 ? defaultContent : (base.children || []);
    }
    return {
        type: 'Element',
        tag: base.tag,
        attributes,
        directives,
        children,
    };
}
function mergeDirectives(base, current) {
    const merged = new Map();
    for (const dir of base) {
        merged.set(dir.name, dir);
    }
    for (const dir of current) {
        merged.set(dir.name, dir);
    }
    return Array.from(merged.values());
}
function collectSlotContent(nodes) {
    const slots = new Map();
    for (const node of nodes) {
        if (node.type === 'TemplateBlock') {
            const block = node;
            slots.set(block.name || 'default', block.children || []);
            continue;
        }
        if (node.type === 'SlotPlaceholder') {
            const placeholder = node;
            slots.set(placeholder.name || 'default', placeholder.children || []);
        }
    }
    return slots;
}
function stripSlotDeclarationNodes(nodes) {
    return nodes.filter((node) => node.type !== 'TemplateBlock' && node.type !== 'SlotPlaceholder');
}
function injectSlots(layoutNodes, slots, defaultContent, source) {
    const result = [];
    for (const node of layoutNodes) {
        if (node.type === 'Slot') {
            const slot = node;
            const slotName = slot.name || 'default';
            if (slots.has(slotName)) {
                result.push(...(slots.get(slotName) || []));
                continue;
            }
            if (slotName === 'default' && defaultContent.length > 0) {
                result.push(...defaultContent);
                continue;
            }
            if (slot.fallback && slot.fallback.length > 0) {
                result.push(...slot.fallback);
                continue;
            }
            if (slotName !== 'default') {
                throw new CompileError(`Missing slot content for: ${slotName}`, source);
            }
            continue;
        }
        if (node.type === 'Element') {
            result.push({
                ...node,
                children: injectSlots(node.children || [], slots, defaultContent, source),
            });
            continue;
        }
        result.push(node);
    }
    return result;
}
/**
 * Compile error class
 */
export class CompileError extends Error {
    constructor(message, source) {
        super(message);
        this.source = source;
        this.name = 'CompileError';
    }
}
//# sourceMappingURL=resolveLayout.js.map