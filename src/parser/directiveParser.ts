/**
 * Illimi Core - Directive Parser
 *
 * Parses and normalizes directives from HTML attributes.
 * Preferred prefix: x- (f- accepted for backward compatibility).
 */

import type {
  FeedDirective,
  DirectiveType,
  ForLoopData,
  IfData,
  IfBranch,
  KeyData,
  TextData,
  HtmlData,
  BindData,
  OnData
} from '../ast/nodes.js';

const DIRECTIVE_PREFIXES = ['x-', 'f-'];
const DEFAULT_PREFIX = 'x-';

/**
 * Check if an attribute name is a framework directive.
 */
export function isDirective(attrName: string): boolean {
  return DIRECTIVE_PREFIXES.some((prefix) => attrName.startsWith(prefix));
}

function getPrefix(attrName: string): string {
  return DIRECTIVE_PREFIXES.find((prefix) => attrName.startsWith(prefix)) || DEFAULT_PREFIX;
}

/**
 * Parse a directive attribute name and value into a normalized directive.
 */
export function parseDirective(attrName: string, attrValue: string): FeedDirective {
  const prefix = getPrefix(attrName);
  const nameWithoutPrefix = attrName.slice(prefix.length);

  if (nameWithoutPrefix.startsWith('bind:')) {
    return parseBindDirective(nameWithoutPrefix, attrValue, prefix);
  }

  if (nameWithoutPrefix.startsWith('on:')) {
    return parseEventDirective(nameWithoutPrefix, attrValue, prefix);
  }

  return parseSimpleDirective(nameWithoutPrefix, attrValue, prefix);
}

function parseSimpleDirective(name: string, value: string, prefix: string): FeedDirective {
  const type = getDirectiveType(name);

  return {
    type,
    name: `${prefix}${name}`,
    value,
    expression: value,
  };
}

function parseBindDirective(name: string, value: string, prefix: string): FeedDirective {
  return {
    type: 'bind',
    name: `${prefix}${name}`,
    value,
    expression: value,
    modifiers: [],
  };
}

function parseEventDirective(name: string, value: string, prefix: string): FeedDirective {
  const event = name.slice(3); // remove on:
  const parts = event.split('.');
  const eventName = parts[0] || '';
  const modifiers = parts.slice(1);

  return {
    type: 'on',
    name: `${prefix}on:${eventName}`,
    value,
    expression: value,
    modifiers,
  };
}

function getDirectiveType(name: string): DirectiveType {
  switch (name) {
    case 'if':
      return 'if';
    case 'else-if':
      return 'else-if';
    case 'else':
      return 'else';
    case 'for':
      return 'for';
    case 'items':
      return 'items';
    case 'key':
      return 'key';
    case 'text':
      return 'text';
    case 'html':
      return 'html';
    case 'show':
      return 'show';
    case 'model':
      return 'model';
    default:
      if (name.startsWith('bind:')) return 'bind';
      if (name.startsWith('on:')) return 'on';
      throw new Error(`Unknown directive: ${name}`);
  }
}

/**
 * Parse for loop expression.
 *
 * Format: "item in items" or "(item, index) in items"
 */
export function parseForLoop(expression: string): ForLoopData {
  const match = expression.match(/^\s*(?:(\w+),\s*)?(\w+)\s+in\s+(\S+)\s*$/);

  if (!match) {
    throw new Error(`Invalid for loop expression: ${expression}`);
  }

  const [, indexName, item, collection] = match;

  if (!item || !collection) {
    throw new Error(`Invalid for loop expression: ${expression}`);
  }

  return {
    item,
    index: indexName ?? '',
    collection,
  };
}

/**
 * Parse if/else-if/else expression.
 */
export function parseIfExpression(expression: string): string {
  return expression.trim();
}

/**
 * Check if an element has conditional rendering directives.
 */
export function hasConditionalDirectives(directives: FeedDirective[]): boolean {
  return directives.some((d) => d.type === 'if' || d.type === 'else-if' || d.type === 'else');
}

/**
 * Check if an element has list rendering directives.
 */
export function hasListDirectives(directives: FeedDirective[]): boolean {
  return directives.some((d) => d.type === 'for' || d.type === 'items');
}
