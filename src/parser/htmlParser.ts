/**
 * FeedJS Core - HTML Parser
 *
 * Parses HTML templates into Feed AST nodes.
 * Handles standard HTML elements, text, comments, slots, and template blocks.
 * Supports {{ expression }} interpolation syntax.
 */

import type {
  FeedAST,
  FeedASTNode,
  FeedElementNode,
  FeedTextNode,
  FeedCommentNode,
  FeedDirective,
  FeedSlotNode,
  FeedTemplateBlockNode,
  FeedSlotPlaceholderNode,
} from '../ast/nodes.js';
import { isDirective, parseDirective } from './directiveParser.js';

// Token types for the tokenizer
type TokenType = 'tagOpen' | 'tagClose' | 'tagSelfClosing' | 'text' | 'interpolation' | 'comment' | 'doctype';

interface Token {
  type: TokenType;
  value: string;
  tagName?: string;
  attributes: Record<string, string>;
  selfClosing?: boolean;
}

interface Segment {
  content: string;
  isInterpolation: boolean;
}

// Parser state
interface ParserState {
  tokens: Token[];
  pos: number;
}

/**
 * Parse HTML template string into Feed AST
 */
export function parseTemplate(html: string): FeedAST {
  const tokens = tokenize(html);
  const state: ParserState = { tokens, pos: 0 };
  const nodes = parseNodes(state);

  return {
    type: 'FeedAST',
    nodes,
    source: html,
  };
}

// Simple HTML tokenizer with interpolation support
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const segments = splitByInterpolation(html);

  for (const segment of segments) {
    if (segment.isInterpolation) {
      tokens.push({ type: 'interpolation', value: segment.content, attributes: {} });
      continue;
    }

    tokens.push(...tokenizeHtml(segment.content));
  }

  return tokens;
}

/**
 * Split HTML by interpolation markers {{ }}
 */
function splitByInterpolation(html: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = /\{\{([\s\S]*?)\}\}/g;

  while ((match = regex.exec(html)) !== null) {
    const expr = match[1];
    if (!expr) continue;

    if (match.index > lastIndex) {
      segments.push({
        content: html.slice(lastIndex, match.index),
        isInterpolation: false,
      });
    }

    segments.push({ content: expr.trim(), isInterpolation: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < html.length) {
    segments.push({ content: html.slice(lastIndex), isInterpolation: false });
  }

  if (segments.length === 0 && html.length > 0) {
    segments.push({ content: html, isInterpolation: false });
  }

  return segments;
}

/**
 * Tokenize plain HTML content (without interpolation markers)
 */
function tokenizeHtml(html: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < html.length) {
    // Comment
    if (html.slice(pos, pos + 4) === '<!--') {
      const end = html.indexOf('-->', pos + 4);
      if (end === -1) {
        tokens.push({ type: 'comment', value: html.slice(pos), attributes: {} });
        break;
      }
      tokens.push({ type: 'comment', value: html.slice(pos + 4, end), attributes: {} });
      pos = end + 3;
      continue;
    }

    // Tag
    if (html[pos] === '<') {
      const nextChar = html[pos + 1] ?? '';

      // Closing tag
      if (nextChar === '/') {
        const end = html.indexOf('>', pos + 2);
        if (end === -1) break;
        const tagName = html.slice(pos + 2, end).trim().toLowerCase();
        tokens.push({ type: 'tagClose', value: html.slice(pos, end + 1), tagName, attributes: {} });
        pos = end + 1;
        continue;
      }

      // Doctype / declaration
      if (nextChar === '!') {
        const end = html.indexOf('>', pos + 2);
        if (end === -1) break;
        tokens.push({ type: 'doctype', value: html.slice(pos, end + 1), attributes: {} });
        pos = end + 1;
        continue;
      }

      const end = findTagEnd(html, pos + 1);
      if (end === -1) break;

      const rawTagContent = html.slice(pos + 1, end).trim();
      const selfClosing = rawTagContent.endsWith('/');
      const cleanContent = selfClosing ? rawTagContent.slice(0, -1).trim() : rawTagContent;

      const spaceIndex = cleanContent.search(/\s/);
      const tagName = (spaceIndex === -1 ? cleanContent : cleanContent.slice(0, spaceIndex)).toLowerCase();
      const attrString = spaceIndex === -1 ? '' : cleanContent.slice(spaceIndex + 1);

      if (!tagName) {
        pos = end + 1;
        continue;
      }

      const attributes = parseAttributes(attrString);
      const tokenType = selfClosing || isSelfClosingTag(tagName) ? 'tagSelfClosing' : 'tagOpen';

      tokens.push({
        type: tokenType,
        value: html.slice(pos, end + 1),
        tagName,
        attributes,
        selfClosing: tokenType === 'tagSelfClosing',
      });

      pos = end + 1;
      continue;
    }

    // Text
    const nextTag = html.indexOf('<', pos);
    if (nextTag === -1) {
      const text = html.slice(pos);
      if (text) tokens.push({ type: 'text', value: text, attributes: {} });
      break;
    }

    const text = html.slice(pos, nextTag);
    if (text) tokens.push({ type: 'text', value: text, attributes: {} });
    pos = nextTag;
  }

  return tokens;
}

function findTagEnd(html: string, start: number): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (!ch) continue;

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (ch === '>' && !inSingleQuote && !inDoubleQuote) {
      return i;
    }
  }

  return -1;
}

// Parse HTML attributes string into key-value map
function parseAttributes(attrString: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  // Supports:
  // - name="value"
  // - name='value'
  // - name=value
  // - bare attributes
  // - directive/modifier names like x-on:click.stop
  // - shorthand slot names like #header
  const attrRegex = /([#@]?[\w:-]+(?:\.[\w:-]+)*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const name = match[1];
    if (!name) continue;

    const doubleQuoted = match[2];
    const singleQuoted = match[3];
    const unquoted = match[4];
    const value = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
    attributes[name] = value;
  }

  return attributes;
}

function isSelfClosingTag(tagName: string): boolean {
  const selfClosingTags = [
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ];
  return selfClosingTags.includes(tagName.toLowerCase());
}

/**
 * Parse nodes recursively until EOF or matching closing tag.
 */
function parseNodes(state: ParserState, stopAtTag?: string): FeedASTNode[] {
  const nodes: FeedASTNode[] = [];

  while (state.pos < state.tokens.length) {
    const token = state.tokens[state.pos];
    if (!token) {
      state.pos++;
      continue;
    }

    if (token.type === 'tagClose') {
      if (!stopAtTag || token.tagName === stopAtTag) {
        break;
      }
      state.pos++;
      continue;
    }

    if (token.type === 'doctype') {
      state.pos++;
      continue;
    }

    if (token.type === 'interpolation') {
      nodes.push(createInterpolationNode(token.value));
      state.pos++;
      continue;
    }

    if (token.type === 'text') {
      nodes.push(createTextNode(token.value));
      state.pos++;
      continue;
    }

    if (token.type === 'comment') {
      nodes.push(createCommentNode(token.value));
      state.pos++;
      continue;
    }

    if (token.type === 'tagOpen' || token.type === 'tagSelfClosing') {
      nodes.push(parseElement(state, token));
      continue;
    }

    state.pos++;
  }

  return nodes;
}

function parseElement(state: ParserState, token: Token): FeedASTNode {
  const tagName = token.tagName ?? '';

  if (tagName === 'slot') {
    return parseSlotElement(state, token);
  }

  if (tagName === 'slot-placeholder') {
    return parseSlotPlaceholderElement(state, token);
  }

  if (tagName === 'template') {
    return parseTemplateElement(state, token);
  }

  return parseRegularElement(state, token);
}

function parseSlotElement(state: ParserState, token: Token): FeedSlotNode {
  const attributes = token.attributes ?? {};
  const name = attributes['name'] || 'default';

  state.pos++;
  const fallback = token.selfClosing ? [] : parseNodes(state, 'slot');

  if (!token.selfClosing && state.tokens[state.pos]?.type === 'tagClose') {
    state.pos++;
  }

  return {
    type: 'Slot',
    name,
    fallback,
  };
}

function parseSlotPlaceholderElement(state: ParserState, token: Token): FeedSlotPlaceholderNode {
  const attributes = token.attributes ?? {};
  const name = attributes['name'] || 'default';

  state.pos++;
  const children = token.selfClosing ? [] : parseNodes(state, 'slot-placeholder');

  if (!token.selfClosing && state.tokens[state.pos]?.type === 'tagClose') {
    state.pos++;
  }

  return {
    type: 'SlotPlaceholder',
    name,
    children,
  };
}

function parseTemplateElement(state: ParserState, token: Token): FeedTemplateBlockNode {
  const attributes = token.attributes ?? {};
  const hashSlot = Object.keys(attributes).find((key) => key.startsWith('#'));
  const name = attributes['name'] || attributes['slot'] || (hashSlot ? hashSlot.slice(1) : '') || 'default';

  state.pos++;
  const children = token.selfClosing ? [] : parseNodes(state, 'template');

  if (!token.selfClosing && state.tokens[state.pos]?.type === 'tagClose') {
    state.pos++;
  }

  return {
    type: 'TemplateBlock',
    name,
    children,
  };
}

function parseRegularElement(state: ParserState, token: Token): FeedElementNode {
  const tagName = token.tagName ?? '';
  const attributes = token.attributes ?? {};

  const elementAttrs: Record<string, string> = {};
  const directives: FeedDirective[] = [];

  for (const [key, value] of Object.entries(attributes)) {
    if (isDirective(key)) {
      directives.push(parseDirective(key, value));
      continue;
    }

    // Vue-like shorthand support for developer ergonomics.
    if (key.startsWith(':')) {
      directives.push(parseDirective(`x-bind:${key.slice(1)}`, value));
      continue;
    }

    if (key.startsWith('@')) {
      directives.push(parseDirective(`x-on:${key.slice(1)}`, value));
      continue;
    }

    elementAttrs[key] = value;
  }

  state.pos++;
  const children = token.selfClosing ? [] : parseNodes(state, tagName);

  if (!token.selfClosing && state.tokens[state.pos]?.type === 'tagClose') {
    state.pos++;
  }

  return {
    type: 'Element',
    tag: tagName,
    attributes: elementAttrs,
    children,
    directives,
  };
}

function createInterpolationNode(expression: string): FeedTextNode {
  return {
    type: 'Text',
    value: '',
    interpolation: expression,
  };
}

function createTextNode(value: string): FeedTextNode {
  return {
    type: 'Text',
    value,
  };
}

function createCommentNode(value: string): FeedCommentNode {
  return {
    type: 'Comment',
    value,
  };
}
