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
import type {
  FeedAST,
  FeedASTNode,
  FeedDirective,
  FeedElementNode,
  FeedSlotNode,
  FeedTemplateBlockNode,
  FeedSlotPlaceholderNode,
} from '../ast/nodes.js';

const INHERIT_ATTRS = ['inherit', 'extends', 'f:inherit'] as const;

type SlotMap = Map<string, FeedASTNode[]>;

interface LayoutBinding {
  src: string;
  children: FeedASTNode[];
  index: number;
}

/**
 * Detect and resolve layout/inheritance features.
 */
export function resolveLayout(
  ast: FeedAST,
  resolveLayoutFile: (src: string) => string
): FeedAST {
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

function loadTemplate(
  src: string,
  source: string,
  resolveLayoutFile: (src: string) => string
): string {
  try {
    return resolveLayoutFile(src);
  } catch (error) {
    console.error(`Error resolving template file: ${src}`, error);
    throw new CompileError(`Failed to load template file: ${src}`, source);
  }
}

function findLayoutBinding(nodes: FeedASTNode[]): LayoutBinding | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || node.type !== 'Element') continue;

    const src =
      getLayoutSrcFromTag(node) ??
      node.attributes['layout'] ??
      node.attributes['extends'] ??
      node.attributes['f:inherit'];

    if (!src) continue;

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

function isLayoutTag(tag: string): boolean {
  return tag === 'layout' || tag === 'feedjs-layout' || tag === 'extends';
}

function getLayoutSrcFromTag(node: FeedElementNode): string | undefined {
  if (!isLayoutTag(node.tag)) return undefined;
  return node.attributes['src'];
}

function processInherit(
  nodes: FeedASTNode[],
  resolveLayoutFile: (src: string) => string
): FeedASTNode[] {
  return nodes.map((node) => processNodeInherit(node, resolveLayoutFile));
}

function processNodeInherit(
  node: FeedASTNode,
  resolveLayoutFile: (src: string) => string
): FeedASTNode {
  if (node.type !== 'Element') {
    return node;
  }

  const processedChildren = processInherit(node.children || [], resolveLayoutFile);
  const currentNode: FeedElementNode = {
    ...node,
    children: processedChildren,
  };

  const inheritSrc = getInheritSrc(currentNode);
  if (!inheritSrc) {
    return currentNode;
  }

  const inheritedContent = loadTemplate(inheritSrc, '', resolveLayoutFile);
  const inheritedAST = resolveLayout(parseTemplate(inheritedContent), resolveLayoutFile);

  const inheritedRoot =
    inheritedAST.nodes.find((n): n is FeedElementNode => n.type === 'Element' && n.tag === currentNode.tag) ??
    inheritedAST.nodes.find((n): n is FeedElementNode => n.type === 'Element');

  if (!inheritedRoot) {
    throw new CompileError(`Inherited template has no root element: ${inheritSrc}`, '');
  }

  const inheritedProcessed: FeedElementNode = {
    ...inheritedRoot,
    children: processInherit(inheritedRoot.children || [], resolveLayoutFile),
  };

  return mergeInheritedElement(inheritedProcessed, currentNode);
}

function getInheritSrc(node: FeedElementNode): string | undefined {
  for (const attr of INHERIT_ATTRS) {
    const value = node.attributes[attr];
    if (value) return value;
  }
  return undefined;
}

function mergeInheritedElement(base: FeedElementNode, current: FeedElementNode): FeedElementNode {
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

function mergeDirectives(base: FeedDirective[], current: FeedDirective[]): FeedDirective[] {
  const merged = new Map<string, FeedDirective>();

  for (const dir of base) {
    merged.set(dir.name, dir);
  }

  for (const dir of current) {
    merged.set(dir.name, dir);
  }

  return Array.from(merged.values());
}

function collectSlotContent(nodes: FeedASTNode[]): SlotMap {
  const slots: SlotMap = new Map();

  for (const node of nodes) {
    if (node.type === 'TemplateBlock') {
      const block = node as FeedTemplateBlockNode;
      slots.set(block.name || 'default', block.children || []);
      continue;
    }

    if (node.type === 'SlotPlaceholder') {
      const placeholder = node as FeedSlotPlaceholderNode;
      slots.set(placeholder.name || 'default', placeholder.children || []);
    }
  }

  return slots;
}

function stripSlotDeclarationNodes(nodes: FeedASTNode[]): FeedASTNode[] {
  return nodes.filter((node) => node.type !== 'TemplateBlock' && node.type !== 'SlotPlaceholder');
}

function injectSlots(
  layoutNodes: FeedASTNode[],
  slots: SlotMap,
  defaultContent: FeedASTNode[],
  source: string
): FeedASTNode[] {
  const result: FeedASTNode[] = [];

  for (const node of layoutNodes) {
    if (node.type === 'Slot') {
      const slot = node as FeedSlotNode;
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
  constructor(message: string, public source: string) {
    super(message);
    this.name = 'CompileError';
  }
}
