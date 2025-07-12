"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
function activate(context) {
    console.log('IL-ML Language Support is now active');
    // Register folding provider
    const foldingProvider = vscode.languages.registerFoldingRangeProvider({ language: 'il-ml' }, new ILMLFoldingProvider());
    // Register completion provider
    const completionProvider = vscode.languages.registerCompletionItemProvider({ language: 'il-ml' }, new ILMLCompletionProvider(), '/', '#', '@', '$', '&', '<', '!');
    // Register document formatter
    const documentFormatter = vscode.languages.registerDocumentFormattingEditProvider({ language: 'il-ml' }, new ILMLDocumentFormattingEditProvider());
    context.subscriptions.push(foldingProvider, completionProvider, documentFormatter);
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
function getIndentation(line) {
    const match = line.match(/^\s*/);
    return match ? match[0].length : 0;
}
class ILMLFoldingProvider {
    provideFoldingRanges(document, context, token) {
        const ranges = [];
        const regionStack = [];
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            if (line.isEmptyOrWhitespace)
                continue;
            const text = line.text;
            const trimmedText = text.trim();
            const currentIndentation = getIndentation(text);
            // Block comment start
            const blockCommentStart = trimmedText.startsWith('/*');
            const blockCommentEnd = trimmedText.endsWith('*/') || trimmedText === '*/';
            // Explicit block boundaries
            const isExplicitBlockStart = /^\s*\/# \s*([A-Z]+):\s*(.*)$/.test(text);
            const isExplicitBlockEnd = /^\s*#\/\s*$/.test(text);
            // Sub-blocks with optional conditions
            const isSubBlock = /^\s*##\s+/.test(text);
            // Envelope boundaries
            const envelopeStartMatch = trimmedText.match(/^<-([A-Za-z0-9_]+?)_START->$/);
            const envelopeEndMatch = trimmedText.match(/^<-([A-Za-z0-9_]+?)_END->$/);
            // Handle block comment end
            if (blockCommentEnd) {
                for (let j = regionStack.length - 1; j >= 0; j--) {
                    if (regionStack[j].type === 'block-comment') {
                        const region = regionStack.splice(j, 1)[0];
                        ranges.push(new vscode.FoldingRange(region.line, i));
                        break;
                    }
                }
                continue;
            }
            // Handle explicit block end
            if (isExplicitBlockEnd) {
                for (let j = regionStack.length - 1; j >= 0; j--) {
                    if (regionStack[j].type === 'explicit-block') {
                        const region = regionStack.splice(j, 1)[0];
                        ranges.push(new vscode.FoldingRange(region.line, i));
                        break;
                    }
                }
                continue;
            }
            // Handle envelope end
            if (envelopeEndMatch) {
                const envelopeName = envelopeEndMatch[1];
                for (let j = regionStack.length - 1; j >= 0; j--) {
                    if (regionStack[j].type === 'envelope' && regionStack[j].name === envelopeName) {
                        const region = regionStack.splice(j, 1)[0];
                        ranges.push(new vscode.FoldingRange(region.line, i));
                        break;
                    }
                }
                continue;
            }
            // Handle sub-blocks
            if (isSubBlock) {
                while (regionStack.length > 0) {
                    const topRegion = regionStack[regionStack.length - 1];
                    if (topRegion.type === 'explicit-block' || topRegion.type === 'envelope' || topRegion.type === 'block-comment') {
                        break;
                    }
                    if (topRegion.type === 'sub-block' && currentIndentation <= topRegion.indentation) {
                        const region = regionStack.pop();
                        const endLine = this.findLastNonEmptyLine(document, i - 1);
                        if (endLine > region.line) {
                            ranges.push(new vscode.FoldingRange(region.line, endLine));
                        }
                    }
                    else {
                        break;
                    }
                }
                regionStack.push({
                    line: i,
                    indentation: currentIndentation,
                    type: 'sub-block'
                });
                continue;
            }
            // Handle starts
            if (blockCommentStart && !blockCommentEnd) {
                regionStack.push({
                    line: i,
                    indentation: currentIndentation,
                    type: 'block-comment'
                });
            }
            else if (envelopeStartMatch) {
                const envelopeName = envelopeStartMatch[1];
                regionStack.push({
                    line: i,
                    indentation: currentIndentation,
                    type: 'envelope',
                    name: envelopeName
                });
            }
            else if (isExplicitBlockStart) {
                regionStack.push({
                    line: i,
                    indentation: currentIndentation,
                    type: 'explicit-block'
                });
            }
        }
        // Close remaining regions
        const lastLine = document.lineCount - 1;
        while (regionStack.length > 0) {
            const region = regionStack.pop();
            if (region.type === 'sub-block' && lastLine > region.line) {
                ranges.push(new vscode.FoldingRange(region.line, lastLine));
            }
        }
        return ranges;
    }
    findLastNonEmptyLine(document, beforeLine) {
        for (let i = beforeLine; i >= 0; i--) {
            if (!document.lineAt(i).isEmptyOrWhitespace) {
                return i;
            }
        }
        return beforeLine;
    }
}
class ILMLCompletionProvider {
    provideCompletionItems(document, position, token, context) {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        // Block type completion
        if (linePrefix.match(/^\s*\/# \s*$/)) {
            const blockTypes = [
                { type: 'DIRECTIVE', desc: 'Instruction that defines behavior or operational guidelines' },
                { type: 'PROCESS', desc: 'Definition for a workflow or procedure' },
                { type: 'PROTOCOL', desc: 'Module that defines behaviors for user turn input processing' },
                { type: 'INSIGHT', desc: 'Module that defines reasoning behavior around turn input' },
                { type: 'CANON', desc: 'Module that defines behavior and restrictions for responses' },
                { type: 'DAEMON', desc: 'Persona definition for council representatives' },
                { type: 'ENGRAM', desc: 'Data store for world simulation state recall' }
            ];
            return blockTypes.map(block => {
                const item = new vscode.CompletionItem(`${block.type}:`, vscode.CompletionItemKind.Class);
                item.detail = block.desc;
                item.insertText = new vscode.SnippetString(`${block.type}: $1\n  $0\n#/`);
                return item;
            });
        }
        // Metadata completion
        if (linePrefix.match(/^\s*@$/)) {
            const metadata = [
                'trigger', 'priority', 'forum', 'forums', 'index', 'type', 'access'
            ];
            return metadata.map(meta => {
                const item = new vscode.CompletionItem(meta, vscode.CompletionItemKind.Property);
                item.insertText = new vscode.SnippetString(`${meta}: $1`);
                return item;
            });
        }
        // Envelope completion
        if (linePrefix.match(/^\s*<-\w*$/)) {
            const envelopes = [
                'OUTPUT', 'TRANSCRIPT', 'LOG', 'TURN', 'TEMPLATE', 'SCHEMA'
            ];
            return envelopes.map(env => {
                const item = new vscode.CompletionItem(`${env}_START`, vscode.CompletionItemKind.Snippet);
                item.insertText = new vscode.SnippetString(`${env}_START->\n  $0\n<-${env}_END->`);
                return item;
            });
        }
        // Auto-close blocks
        if (linePrefix.match(/^\s*\/# \s*[A-Z]+:\s*.*$/)) {
            const closeItem = new vscode.CompletionItem('#/', vscode.CompletionItemKind.Snippet);
            closeItem.detail = 'Close IL-ML block';
            closeItem.insertText = new vscode.SnippetString('\n$0\n#/');
            return [closeItem];
        }
        return [];
    }
}
class ILMLDocumentFormattingEditProvider {
    provideDocumentFormattingEdits(document, options, token) {
        const edits = [];
        let insideBlock = false;
        let blockIndentation = 0;
        // Stack to track nested envelopes
        const envelopeStack = [];
        const tabSize = options.insertSpaces ? options.tabSize : 1;
        const indentChar = options.insertSpaces ? ' ' : '\t';
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const text = line.text;
            const trimmedText = text.trim();
            if (line.isEmptyOrWhitespace || trimmedText.startsWith('//') || trimmedText.startsWith('/*')) {
                continue;
            }
            // Block boundaries
            const blockStartMatch = text.match(/^(\s*)\/# \s*([A-Z]+):\s*(.*)$/);
            const isBlockEnd = trimmedText === '#/';
            const envelopeStartMatch = trimmedText.match(/^<-([A-Za-z0-9_]+?)_START->$/);
            const envelopeEndMatch = trimmedText.match(/^<-([A-Za-z0-9_]+?)_END->$/);
            if (blockStartMatch) {
                insideBlock = true;
                blockIndentation = blockStartMatch[1].length;
                const formattedLine = `${blockStartMatch[1]}/# ${blockStartMatch[2]}: ${blockStartMatch[3]}`;
                if (text !== formattedLine) {
                    edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                }
                continue;
            }
            if (isBlockEnd) {
                insideBlock = false;
                const expectedIndentation = indentChar.repeat(blockIndentation);
                const formattedLine = `${expectedIndentation}#/`;
                if (text !== formattedLine) {
                    edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                }
                continue;
            }
            if (envelopeStartMatch) {
                const envelopeName = envelopeStartMatch[1];
                const currentIndent = getIndentation(text);
                // Calculate proper indentation for envelope start
                let expectedIndentation = currentIndent;
                if (insideBlock) {
                    expectedIndentation = blockIndentation + tabSize;
                }
                else if (envelopeStack.length > 0) {
                    expectedIndentation = envelopeStack[envelopeStack.length - 1].indentation + tabSize;
                }
                // Format the envelope start line
                const formattedLine = `${indentChar.repeat(expectedIndentation)}<-${envelopeName}_START->`;
                if (text !== formattedLine) {
                    edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                }
                // Add to stack with the expected indentation
                envelopeStack.push({ name: envelopeName, indentation: expectedIndentation });
                continue;
            }
            if (envelopeEndMatch) {
                const envelopeName = envelopeEndMatch[1];
                // Find and remove the matching envelope from stack
                for (let j = envelopeStack.length - 1; j >= 0; j--) {
                    if (envelopeStack[j].name === envelopeName) {
                        const envelope = envelopeStack.splice(j, 1)[0];
                        const expectedIndentation = indentChar.repeat(envelope.indentation);
                        const formattedLine = `${expectedIndentation}<-${envelopeName}_END->`;
                        if (text !== formattedLine) {
                            edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                        }
                        break;
                    }
                }
                continue;
            }
            // Format content inside structures
            const insideEnvelope = envelopeStack.length > 0;
            if (insideBlock || insideEnvelope) {
                let baseIndentation = 0;
                // Calculate the proper base indentation
                if (insideBlock && insideEnvelope) {
                    // Inside both block and envelope
                    const topEnvelope = envelopeStack[envelopeStack.length - 1];
                    baseIndentation = topEnvelope.indentation + tabSize;
                }
                else if (insideBlock) {
                    baseIndentation = blockIndentation + tabSize;
                }
                else if (insideEnvelope) {
                    const topEnvelope = envelopeStack[envelopeStack.length - 1];
                    baseIndentation = topEnvelope.indentation + tabSize;
                }
                // Format directives and special lines
                if (/^\s*[@+\-~?!]/.test(trimmedText) || /^\s*\$/.test(trimmedText) || /^\s*&/.test(trimmedText)) {
                    const expectedIndentation = indentChar.repeat(baseIndentation);
                    const formattedLine = `${expectedIndentation}${trimmedText}`;
                    if (text !== formattedLine) {
                        edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                    }
                }
                else if (/^\s*##/.test(trimmedText)) {
                    const expectedIndentation = indentChar.repeat(baseIndentation);
                    const formattedLine = `${expectedIndentation}${trimmedText}`;
                    if (text !== formattedLine) {
                        edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                    }
                }
                else if (trimmedText && !text.startsWith(indentChar.repeat(baseIndentation))) {
                    // Format other content (like comments, regular text)
                    const expectedIndentation = indentChar.repeat(baseIndentation);
                    const formattedLine = `${expectedIndentation}${trimmedText}`;
                    edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                }
            }
        }
        return edits;
    }
}
//# sourceMappingURL=extension.js.map