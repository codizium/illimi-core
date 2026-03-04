/**
 * FeedJS Core - HTML Parser
 *
 * Parses HTML templates into Feed AST nodes.
 * Handles standard HTML elements, text, comments, slots, and template blocks.
 * Supports {{ expression }} interpolation syntax.
 */
import { isDirective, parseDirective } from './directiveParser.js';
/**
 * Parse HTML template string into Feed AST
 */
export function parseTemplate(html) {
    const tokens = tokenize(html);
    const state = { tokens, pos: 0 };
    const nodes = parseNodes(state);
    return {
        type: 'FeedAST',
        nodes,
        source: html,
    };
}
// Simple HTML tokenizer with interpolation support
function tokenize(html) {
    const tokens = [];
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
function splitByInterpolation(html) {
    const segments = [];
    let lastIndex = 0;
    let match;
    const regex = /\{\{([\s\S]*?)\}\}/g;
    while ((match = regex.exec(html)) !== null) {
        const expr = match[1];
        if (!expr)
            continue;
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
function tokenizeHtml(html) {
    const tokens = [];
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
                if (end === -1)
                    break;
                const tagName = html.slice(pos + 2, end).trim().toLowerCase();
                tokens.push({ type: 'tagClose', value: html.slice(pos, end + 1), tagName, attributes: {} });
                pos = end + 1;
                continue;
            }
            // Doctype / declaration
            if (nextChar === '!') {
                const end = html.indexOf('>', pos + 2);
                if (end === -1)
                    break;
                tokens.push({ type: 'doctype', value: html.slice(pos, end + 1), attributes: {} });
                pos = end + 1;
                continue;
            }
            const end = html.indexOf('>', pos + 1);
            if (end === -1)
                break;
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
            if (text)
                tokens.push({ type: 'text', value: text, attributes: {} });
            break;
        }
        const text = html.slice(pos, nextTag);
        if (text)
            tokens.push({ type: 'text', value: text, attributes: {} });
        pos = nextTag;
    }
    return tokens;
}
// Parse HTML attributes string into key-value map
function parseAttributes(attrString) {
    const attributes = {};
    // Supports:
    // - name="value"
    // - name='value'
    // - name=value
    // - bare attributes
    // - directive/modifier names like f-on:click.stop
    // - shorthand slot names like #header
    const attrRegex = /([#@]?[\w:-]+(?:\.[\w:-]+)*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let match;
    while ((match = attrRegex.exec(attrString)) !== null) {
        const name = match[1];
        if (!name)
            continue;
        const doubleQuoted = match[2];
        const singleQuoted = match[3];
        const unquoted = match[4];
        const value = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
        attributes[name] = value;
    }
    return attributes;
}
function isSelfClosingTag(tagName) {
    const selfClosingTags = [
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'
    ];
    return selfClosingTags.includes(tagName.toLowerCase());
}
/**
 * Parse nodes recursively until EOF or matching closing tag.
 */
function parseNodes(state, stopAtTag) {
    const nodes = [];
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
function parseElement(state, token) {
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
function parseSlotElement(state, token) {
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
function parseSlotPlaceholderElement(state, token) {
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
function parseTemplateElement(state, token) {
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
function parseRegularElement(state, token) {
    const tagName = token.tagName ?? '';
    const attributes = token.attributes ?? {};
    const elementAttrs = {};
    const directives = [];
    for (const [key, value] of Object.entries(attributes)) {
        if (isDirective(key)) {
            directives.push(parseDirective(key, value));
            continue;
        }
        // Vue-like shorthand support for developer ergonomics.
        if (key.startsWith(':')) {
            directives.push(parseDirective(`f-bind:${key.slice(1)}`, value));
            continue;
        }
        if (key.startsWith('@')) {
            directives.push(parseDirective(`f-on:${key.slice(1)}`, value));
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
function createInterpolationNode(expression) {
    return {
        type: 'Text',
        value: '',
        interpolation: expression,
    };
}
function createTextNode(value) {
    return {
        type: 'Text',
        value,
    };
}
function createCommentNode(value) {
    return {
        type: 'Comment',
        value,
    };
}
//# sourceMappingURL=htmlParser.js.map